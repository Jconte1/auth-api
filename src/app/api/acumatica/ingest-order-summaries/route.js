import { NextResponse } from "next/server";
import prisma from "@/lib/prisma/prisma";
import AcumaticaService from "@/lib/acumatica/auth/acumaticaService";
import fetchOrdersWithDetails from "@/lib/acumatica/fetch/fetchOrdersWithDetails";
import filterOrders from "@/lib/acumatica/filter/filterOrders";
import { isCronAuthorized } from "@/lib/cron/auth";
import { upsertOrderSummariesForBAID, purgeOldOrders } from "@/lib/acumatica/write/writeOrders.js";
import OrderDetails from "@/lib/acumatica/write/writeOrderDetails";
import writeOrderLinesBulk from "@/lib/acumatica/write/writeOrderLinesBulk";
import { createStopwatch } from "@/lib/metrics/stopwatch";

function buildExtrasByNbr(rawRows) {
  const map = Object.create(null);
  for (const row of Array.isArray(rawRows) ? rawRows : []) {
    const orderNbr = String(row?.OrderNbr?.value ?? row?.OrderNbr ?? "");
    if (!orderNbr) continue;
    const shipVia = row?.ShipVia?.value ?? row?.ShipVia ?? null;
    const jobName = row?.JobName?.value ?? row?.JobName ?? null;
    map[orderNbr] = {
      shipVia: shipVia != null ? String(shipVia) : null,
      jobName: jobName != null ? String(jobName) : null,
    };
  }
  return map;
}

async function getSinceForBAID(baid) {
  // last successful run finish time for this BAID
  const last = await prisma.erpSyncRun.findFirst({
    where: { baid, ok: true, finishedAt: { not: null } },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true },
  });
  return last?.finishedAt ?? null;
}

async function createRun(baid) {
  return prisma.erpSyncRun.create({
    data: { baid, startedAt: new Date(), ok: null, note: null },
  });
}

async function finishRun(id, ok, noteObj) {
  const note = noteObj ? JSON.stringify(noteObj).slice(0, 1000) : null; // keep it compact
  return prisma.erpSyncRun.update({
    where: { id },
    data: { ok, finishedAt: new Date(), note },
  });
}

async function handleOne(restService, baid) {
  const sw = createStopwatch(`SYNC ${baid}`);
  const run = await createRun(baid);
  try {
    // 0) incremental window
    const since = await getSinceForBAID(baid);

    // 1) Single batched fetch (summaries + Details[]) with since
    const rawRows = await fetchOrdersWithDetails(restService, baid, {
      pageSize: 1000,
      useOrderBy: false,
      since, // << incremental
    });
    const tFetch = sw.lap("erp_fetch_batched");

    // 2) Summaries filter
    const { kept, counts, cutoff } = filterOrders(rawRows);
    const tShape = sw.lap("shape_filter_dedupe");

    // 3) Upsert summaries (+ shipVia/jobName)
    const extrasByNbr = buildExtrasByNbr(rawRows);
    const { inserted, updated, inactivated } = await upsertOrderSummariesForBAID(
      baid,
      kept,
      cutoff,
      { extrasByNbr }
    );
    const tSummaries = sw.lap("db_upsert_summaries");

    // 4) 1:1 details
    const detailsRes = await OrderDetails.upsertOrderDetailsForBAID(baid, kept, rawRows, { concurrency: 10 });
    const tDetails = sw.lap("db_upsert_details");

    // 5) 1:M lines (bulk)
    const linesRes = await writeOrderLinesBulk(baid, rawRows, { chunkSize: 5000 });
    const tLines = sw.lap("db_bulk_lines");

    // 6) Purge
    const purged = await purgeOldOrders(cutoff);
    const tPurge = sw.lap("db_purge");
    const tTotal = sw.total();

    const res = {
      baid,
      erp: counts,
      db: {
        summaries: { inserted, updated, inactivated },
        details: detailsRes,
        lines: linesRes,
        purged,
      },
      timing: {
        erpFetchMs: Number(tFetch.toFixed ? tFetch.toFixed(1) : tFetch),
        shapeMs: Number(tShape.toFixed ? tShape.toFixed(1) : tShape),
        summariesMs: Number(tSummaries.toFixed ? tSummaries.toFixed(1) : tSummaries),
        detailsMs: Number(tDetails.toFixed ? tDetails.toFixed(1) : tDetails),
        linesMs: Number(tLines.toFixed ? tLines.toFixed(1) : tLines),
        purgeMs: Number(tPurge.toFixed ? tPurge.toFixed(1) : tPurge),
        totalMs: Number(tTotal.toFixed ? tTotal.toFixed(1) : tTotal),
      },
    };

    await finishRun(run.id, true, {
      since,
      erp: counts,
      timings: res.timing,
      wrote: {
        summaries: { inserted, updated, inactivated },
        details: res.db.details,
        lines: res.db.lines,
        purged,
      },
    });

    return res;
  } catch (e) {
    await finishRun(run.id, false, { error: String(e?.message || e) });
    throw e;
  }
}

function parseBAIDs(value) {
  if (!value) return [];
  return value.split(",").map(s => s.trim()).filter(Boolean);
}

async function runWithConcurrency(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 200)));
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

// POST — manual/admin-triggered
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const bodyBaid = typeof body?.baid === "string" ? body.baid.trim() : "";
    const bodyBaids = Array.isArray(body?.baids) ? body.baids.map(s => String(s).trim()).filter(Boolean) : [];
    const baids = bodyBaids.length ? bodyBaids : parseBAIDs(bodyBaid);
    if (!baids.length) {
      return NextResponse.json({ message: "Provide { baid: 'BA1,BA2' } or { baids: ['BA1','BA2'] }" }, { status: 400 });
    }

    const restService = new AcumaticaService(
      process.env.ACUMATICA_BASE_URL,
      process.env.ACUMATICA_CLIENT_ID,
      process.env.ACUMATICA_CLIENT_SECRET,
      process.env.ACUMATICA_USERNAME,
      process.env.ACUMATICA_PASSWORD
    );
    await restService.getToken();

    if (baids.length === 1) {
      const res = await handleOne(restService, baids[0]);
      return NextResponse.json(res);
    }

    const limit = Math.max(1, Number(process.env.BATCH_CONCURRENCY || 3));
    const results = [];
    await runWithConcurrency(baids, limit, async (b) => {
      const r = await handleOne(restService, b);
      results.push(r);
    });

    results.sort((a, b) => baids.indexOf(a.baid) - baids.indexOf(b.baid));
    const totalMs = results.reduce((acc, r) => acc + (r?.timing?.totalMs || 0), 0);
    return NextResponse.json({ count: results.length, concurrency: limit, totalMs, results });
  } catch (e) {
    console.error("ingest-order-summaries POST error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}

// GET — for Vercel Cron (Authorization header) or manual (?token=)
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    if (!isCronAuthorized(req, searchParams)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    const qsBaid = (searchParams.get("baid") || "").trim();
    const qsBaids = (searchParams.get("baids") || "").trim();
    const baids = parseBAIDs(qsBaids || qsBaid);
    if (!baids.length) return NextResponse.json({ message: "Provide ?baid=BA1,BA2 or ?baids=BA1,BA2" }, { status: 400 });

    const restService = new AcumaticaService(
      process.env.ACUMATICA_BASE_URL,
      process.env.ACUMATICA_CLIENT_ID,
      process.env.ACUMATICA_CLIENT_SECRET,
      process.env.ACUMATICA_USERNAME,
      process.env.ACUMATICA_PASSWORD
    );
    await restService.getToken();

    if (baids.length === 1) {
      const res = await handleOne(restService, baids[0]);
      return NextResponse.json(res);
    }

    const limit = Math.max(1, Number(process.env.BATCH_CONCURRENCY || 3));
    const results = [];
    await runWithConcurrency(baids, limit, async (b) => {
      const r = await handleOne(restService, b);
      results.push(r);
    });

    results.sort((a, b) => baids.indexOf(a.baid) - baids.indexOf(b.baid));
    const totalMs = results.reduce((acc, r) => acc + (r?.timing?.totalMs || 0), 0);
    return NextResponse.json({ count: results.length, concurrency: limit, totalMs, results });
  } catch (e) {
    console.error("ingest-order-summaries GET error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}
