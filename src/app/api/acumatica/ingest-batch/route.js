// src/app/api/acumatica/ingest-batch/route.js
import { NextResponse } from "next/server";
import AcumaticaService from "@/lib/acumatica/auth/acumaticaService";
import fetchOrdersWithDetails from "@/lib/acumatica/fetch/fetchOrdersWithDetails";
import filterOrders from "@/lib/acumatica/filter/filterOrders";
import { upsertOrderSummariesForBAID, purgeOldOrders } from "@/lib/acumatica/write/writeOrders.js";
import OrderDetails from "@/lib/acumatica/write/writeOrderDetails";
import writeOrderLinesBulk from "@/lib/acumatica/write/writeOrderLinesBulk";
import { isCronAuthorized } from "@/lib/cron/auth";

function nowMs() { return Number(process.hrtime.bigint() / 1_000_000n); }

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

async function runForBAID(restService, baid) {
  const t0 = nowMs();

  // 1) Fetch (batched)
  const tF1 = nowMs();
  const rawRows = await fetchOrdersWithDetails(restService, baid);
  const tF2 = nowMs();

  // 2) Shape summaries
  const tS1 = nowMs();
  const { kept, counts, cutoff } = filterOrders(rawRows);
  const tS2 = nowMs();

  // 3) Upsert summaries (extras)
  const tW1 = nowMs();
  const extrasByNbr = buildExtrasByNbr(rawRows);
  const { inserted, updated, inactivated } = await upsertOrderSummariesForBAID(
    baid, kept, cutoff, { extrasByNbr }
  );
  const tW2 = nowMs();

  // 4) 1:1 details
  const tD1 = nowMs();
  const detailsRes = await OrderDetails.upsertOrderDetailsForBAID(
    baid, kept, rawRows, { concurrency: 10 }
  );
  const tD2 = nowMs();

  // 5) 1:M lines (bulk)
  const tL1 = nowMs();
  const linesRes = await writeOrderLinesBulk(baid, rawRows, { chunkSize: 5000 });
  const tL2 = nowMs();

  // 6) Purge
  const tP1 = nowMs();
  const purged = await purgeOldOrders(cutoff);
  const tP2 = nowMs();

  return {
    baid,
    erp: counts,
    db: {
      summaries: { inserted, updated, inactivated },
      details: detailsRes,
      lines: linesRes,
      purged,
    },
    timing: {
      erpFetchMs: +(tF2 - tF1).toFixed(1),
      shapeMs: +(tS2 - tS1).toFixed(1),
      summariesMs: +(tW2 - tW1).toFixed(1),
      detailsMs: +(tD2 - tD1).toFixed(1),
      linesMs: +(tL2 - tL1).toFixed(1),
      purgeMs: +(tP2 - tP1).toFixed(1),
      totalMs: +(nowMs() - t0).toFixed(1),
    },
  };
}

// simple bounded concurrency runner with tiny jitter
async function runWithConcurrency(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 250)));
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

function resolveBAIDs(body, req) {
  if (Array.isArray(body?.baids) && body.baids.length) {
    return body.baids.map(s => String(s).trim()).filter(Boolean);
  }
  const { searchParams } = new URL(req.url);
  const qs = searchParams.get("baids");
  if (qs) return qs.split(",").map(s => s.trim()).filter(Boolean);

  const envList = process.env.SYNC_BAIDS || "";
  const fromEnv = envList.split(",").map(s => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : ["BA0001225","BA0002473"];
}

// POST — manual/admin-triggered
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const baids = resolveBAIDs(body, req);
    if (!baids.length) {
      return NextResponse.json(
        { message: "Provide { baids: [...] } or SYNC_BAIDS/baids=..." },
        { status: 400 }
      );
    }

    const restService = new AcumaticaService(
      process.env.ACUMATICA_BASE_URL,
      process.env.ACUMATICA_CLIENT_ID,
      process.env.ACUMATICA_CLIENT_SECRET,
      process.env.ACUMATICA_USERNAME,
      process.env.ACUMATICA_PASSWORD
    );
    await restService.getToken();

    const limit = Math.max(1, Number(process.env.BATCH_CONCURRENCY || 3));
    const results = [];
    await runWithConcurrency(baids, limit, async (baid) => {
      const r = await runForBAID(restService, baid);
      results.push(r);
    });

    results.sort((a, b) => baids.indexOf(a.baid) - baids.indexOf(b.baid));
    const totalMs = results.reduce((acc, r) => acc + r.timing.totalMs, 0);
    return NextResponse.json({ count: results.length, concurrency: limit, totalMs, results });
  } catch (e) {
    console.error("ingest-batch POST error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}

// GET — for Vercel Cron (x-vercel-cron) or manual (?token= / Bearer)
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    if (!isCronAuthorized(req, searchParams)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const qs = searchParams.get("baids");
    const body = qs ? { baids: qs.split(",") } : {};
    // Reuse POST implementation for GET
    return POST(new Request(req.url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: req.headers
    }));
  } catch (e) {
    console.error("ingest-batch GET error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}
