// src/app/api/acumatica/ingest-inventory-details/route.js
import { NextResponse } from "next/server";
import AcumaticaService from "@/lib/acumatica/auth/acumaticaService";
import fetchInventoryDetails from "@/lib/acumatica/fetch/fetchInventoryDetails";
import writeInventoryDetails from "@/lib/acumatica/write/writeInventoryDetails";
import prisma from "@/lib/prisma/prisma";

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

async function resolveSingleBAID(req) {
  const body = await req.json().catch(() => ({}));
  const { searchParams } = new URL(req.url);
  const userId = (body.userId ?? searchParams.get("userId")) || null;
  const email  = (body.email  ?? searchParams.get("email"))  || null;
  const baidIn = (body.baid   ?? searchParams.get("baid"))   || null;

  if (baidIn && (userId || email)) {
    const user = userId
      ? await prisma.users.findUnique({ where: { id: userId }, select: { baid: true } })
      : await prisma.users.findUnique({ where: { email }, select: { baid: true } });
    if (!user?.baid) throw new Error("User not found or has no BAID.");
    if (user.baid !== baidIn) throw new Error("Provided BAID does not match user’s BAID.");
    return baidIn;
  }
  if (baidIn) return baidIn;

  if (userId || email) {
    const user = userId
      ? await prisma.users.findUnique({ where: { id: userId }, select: { baid: true } })
      : await prisma.users.findUnique({ where: { email }, select: { baid: true } });
    if (!user?.baid) throw new Error("No BAID found for the given userId/email.");
    return user.baid;
  }

  throw new Error("Provide baid or a resolvable userId/email.");
}

async function handleOne(restService, baid) {
  const t0 = nowMs();

  // pick candidate orders from summaries (active within 1y)
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const summaries = await prisma.erpOrderSummary.findMany({
    where: { baid, isActive: true, deliveryDate: { gte: cutoff } },
    select: { orderNbr: true },
  });
  const orderNbrs = summaries.map(s => s.orderNbr);
  console.log(`[inventoryRoute] baid=${baid} candidateOrders=${orderNbrs.length}`);

  if (!orderNbrs.length) {
    return {
      baid,
      erp: { totalFromERP: 0 },
      db: {
        ordersConsidered: 0,
        ordersAffected: 0,
        linesKept: 0,
        linesDeleted: 0,
        linesInserted: 0,
        scan: { ordersScanned: 0, ordersWithoutNbr: 0, ordersWithNoDetails: 0, linesKept: 0, linesDroppedEmpty: 0 },
      },
      inspectedOrders: 0,
      timing: { erpFetchMs: 0, dbLinesMs: 0, totalMs: +(nowMs() - t0).toFixed(1) },
      note: "No active orders in the last year — nothing to fetch.",
    };
  }

  let rows = [];
  let fetchErr = null;
  const tF1 = nowMs();
  try {
    rows = await fetchInventoryDetails(
      restService,
      baid,
      orderNbrs,
      {
        batchSize: Number(process.env.LINES_BATCH_SIZE || 24),
        pool: Number(process.env.LINES_POOL || 12),
        maxSockets: Number(process.env.LINES_MAX_SOCKETS || 16),
        maxUrl: Number(process.env.ACUMATICA_MAX_URL || 7000),
        retries: Number(process.env.LINES_RETRIES || 3),
      }
    );
  } catch (e) {
    fetchErr = String(e?.message || e);
    console.error(`[inventoryRoute] fetch error baid=${baid}:`, fetchErr);
  }
  const tF2 = nowMs();

  if (fetchErr) {
    return {
      baid,
      error: fetchErr,
      erp: { totalFromERP: 0 },
      db: null,
      inspectedOrders: orderNbrs.length,
      timing: { erpFetchMs: +(tF2 - tF1).toFixed(1), dbLinesMs: 0, totalMs: +(nowMs() - t0).toFixed(1) },
    };
  }

  const tW1 = nowMs();
  const result = await writeInventoryDetails(baid, rows, { chunkSize: 5000 });
  const tW2 = nowMs();

  return {
    baid,
    erp: { totalFromERP: Array.isArray(rows) ? rows.length : 0 },
    db: result,
    inspectedOrders: orderNbrs.length,
    timing: {
      erpFetchMs: +(tF2 - tF1).toFixed(1),
      dbLinesMs: +(tW2 - tW1).toFixed(1),
      totalMs: +(nowMs() - t0).toFixed(1),
    },
  };
}

export async function POST(req) {
  try {
    if (!authOk(req)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    let baid;
    try {
      baid = await resolveSingleBAID(req);
    } catch (err) {
      return NextResponse.json({ message: String(err.message || err) }, { status: 400 });
    }

    const restService = new AcumaticaService(
      process.env.ACUMATICA_BASE_URL,
      process.env.ACUMATICA_CLIENT_ID,
      process.env.ACUMATICA_CLIENT_SECRET,
      process.env.ACUMATICA_USERNAME,
      process.env.ACUMATICA_PASSWORD
    );
    await restService.getToken();

    const results = [];
    const r = await handleOne(restService, baid);
    results.push(r);

    return NextResponse.json({ count: 1, results });
  } catch (e) {
    console.error("ingest-inventory-details POST error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    if (!authOk(req)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    return POST(new Request(req.url, { method: "POST", headers: req.headers }));
  } catch (e) {
    console.error("ingest-inventory-details GET error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}
