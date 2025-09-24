// src/app/api/acumatica/ingest-address-contact/route.js
import { NextResponse } from "next/server";
import AcumaticaService from "@/lib/acumatica/auth/acumaticaService";
import fetchAddressContact from "@/lib/acumatica/fetch/fetchAddressContact";
import writeAddressContact from "@/lib/acumatica/write/writeAddressContact";
import prisma from "@/lib/prisma/prisma";
import { oneYearAgoDenver, toDenverDateTimeOffsetLiteral } from "@/lib/time/denver"; 

function nowMs() { return Number(process.hrtime.bigint() / 1_000_000n); }

function authOk(req) {
  const headerAuth = req.headers.get("authorization") || "";
  const { searchParams } = new URL(req.url);
  const queryToken = searchParams.get("token") || "";
  return (
    headerAuth === `Bearer ${process.env.CRON_SECRET}` ||
    (queryToken && queryToken === process.env.CRON_SECRET)
  );
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
  return fromEnv.length ? fromEnv : [];
}

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

async function handleOne(restService, baid) {
  const t0 = nowMs();

  // 0) Determine which orders to fetch (active, last 1 year — use Denver cutoff like summaries)
  const cutoffDenver = oneYearAgoDenver(new Date());                                    // ⬅️ add
  const cutoffLiteral = toDenverDateTimeOffsetLiteral(cutoffDenver);                    // ⬅️ add

  const summaries = await prisma.erpOrderSummary.findMany({
    where: { baid, isActive: true, deliveryDate: { gte: cutoffDenver } },               // ⬅️ use cutoffDenver
    select: { orderNbr: true },
  });
  const orderNbrs = summaries.map(s => s.orderNbr);

  if (!orderNbrs.length) {
    return {
      baid,
      erp: { totalFromERP: 0 },
      db: { addressesUpserted: 0, contactsUpserted: 0 },
      inspectedOrders: 0,
      timing: { erpFetchMs: 0, dbWritesMs: 0, totalMs: +(nowMs() - t0).toFixed(1) },
      note: "No active orders in the last year — nothing to fetch.",
    };
  }

  // 1) Fetch address/contact for those orders (tell fetch about the cutoff)
  const tF1 = nowMs();
  const rows = await fetchAddressContact(restService, baid, { orderNbrs, cutoffLiteral }); // ⬅️ pass cutoffLiteral
  const tF2 = nowMs();

  // 2) Write
  const tW1 = nowMs();
  const result = await writeAddressContact(baid, rows, { concurrency: 10 });
  const tW2 = nowMs();

  return {
    baid,
    erp: { totalFromERP: Array.isArray(rows) ? rows.length : 0 },
    db: result,
    inspectedOrders: orderNbrs.length,
    timing: {
      erpFetchMs: +(tF2 - tF1).toFixed(1),
      dbWritesMs: +(tW2 - tW1).toFixed(1),
      totalMs: +(nowMs() - t0).toFixed(1),
    },
  };
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const baids = resolveBAIDs(body, req);
    if (!baids.length) {
      return NextResponse.json(
        { message: "Provide { baids:[...] } or SYNC_BAIDS/baids=..." },
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
      const r = await handleOne(restService, baid);
      results.push(r);
    });
    results.sort((a, b) => baids.indexOf(a.baid) - baids.indexOf(b.baid));
    const totalMs = results.reduce((acc, r) => acc + r.timing.totalMs, 0);

    return NextResponse.json({ count: results.length, concurrency: limit, totalMs, results });
  } catch (e) {
    console.error("ingest-address-contact POST error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    if (!authOk(req)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const qs = searchParams.get("baids");
    const body = qs ? { baids: qs.split(",") } : {};
    return POST(new Request(req.url, { method: "POST", body: JSON.stringify(body), headers: req.headers }));
  } catch (e) {
    console.error("ingest-address-contact GET error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}
