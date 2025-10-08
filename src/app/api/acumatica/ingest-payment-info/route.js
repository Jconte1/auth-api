// src/app/api/acumatica/ingest-payment-info/route.js
import { NextResponse } from "next/server";
import AcumaticaService from "@/lib/acumatica/auth/acumaticaService";
import fetchPaymentInfo from "@/lib/acumatica/fetch/fetchPaymentInfo";
import writePaymentInfo from "@/lib/acumatica/write/writePaymentInfo";
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

  // 0) Get order numbers from summaries (active, last 1 year)
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const summaries = await prisma.erpOrderSummary.findMany({
    where: { baid, isActive: true, deliveryDate: { gte: cutoff } },
    select: { orderNbr: true },
  });
  const orderNbrs = summaries.map(s => s.orderNbr);
  console.log(`[ingest-payment-info] baid=${baid} activeSummaries=${orderNbrs.length}`);

  if (!orderNbrs.length) {
    console.log(`[ingest-payment-info] baid=${baid} skip (no active orders)`);
    return {
      baid,
      erp: { totalFromERP: 0 },
      db: { processedOrders: 0, paymentUpserts: 0, ms: 0 },
      inspectedOrders: 0,
      timing: { erpFetchMs: 0, dbWritesMs: 0, totalMs: +(nowMs() - t0).toFixed(1) },
      note: "No active orders in the last year — nothing to fetch.",
    };
  }

  // 1) Fetch payment fields
  const tF1 = nowMs();
  const rows = await fetchPaymentInfo(restService, baid, { orderNbrs });
  const tF2 = nowMs();
  console.log(`[ingest-payment-info] baid=${baid} fetchedRows=${Array.isArray(rows) ? rows.length : 0} inspectedOrders=${orderNbrs.length}`);

  // 2) Upsert into DB
  const tW1 = nowMs();
  const result = await writePaymentInfo(baid, rows, { concurrency: 10 });
  const tW2 = nowMs();
  console.log(`[ingest-payment-info] baid=${baid} wrote paymentUpserts=${result.paymentUpserts ?? 0}`);

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
    console.error("ingest-payment-info POST error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    if (!authOk(req)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    return POST(new Request(req.url, { method: "POST", headers: req.headers }));
  } catch (e) {
    console.error("ingest-payment-info GET error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}
