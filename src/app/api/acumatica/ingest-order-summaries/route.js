// src/app/api/acumatica/ingest-order-summaries/route.js
import { NextResponse } from "next/server";
import AcumaticaService from "@/lib/acumatica/auth/acumaticaService";
import fetchOrderSummaries from "@/lib/acumatica/fetch/fetchOrderSummaries";
import filterOrders from "@/lib/acumatica/filter/filterOrders";
import { upsertOrderSummariesForBAID, purgeOldOrders } from "@/lib/acumatica/write/writeOrderSummaries";
import prisma from "@/lib/prisma/prisma";

// TODO
// ADD 6 WEEK CONFIRM AND 2 WEEK CONFIRM BOOLEAN

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

async function handleOne(restService, baid) {
  const t0 = nowMs();

  // 1) Fetch summaries (paged, no Details)
  const tF1 = nowMs();
  const rawRows = await fetchOrderSummaries(restService, baid);
  const tF2 = nowMs();

  // 2) Filter/dedupe/1-year window
  const tS1 = nowMs();
  const { kept, counts, cutoff } = filterOrders(rawRows);
  const tS2 = nowMs();

  // 3) Upsert summaries (with shipVia/jobName)
  const tW1 = nowMs();
  const { inserted, updated, inactivated } = await upsertOrderSummariesForBAID(baid, kept, cutoff, { concurrency: 10 });
  const tW2 = nowMs();

  // 4) Purge outside window / cancelled etc.
  const tP1 = nowMs();
  const purged = await purgeOldOrders(cutoff);
  const tP2 = nowMs();

  return {
    baid,
    erp: counts,
    db: { inserted, updated, inactivated, purged },
    timing: {
      erpFetchMs: +(tF2 - tF1).toFixed(1),
      shapeMs: +(tS2 - tS1).toFixed(1),
      dbWritesMs: +(tW2 - tW1).toFixed(1),
      purgeMs: +(tP2 - tP1).toFixed(1),
      totalMs: +(nowMs() - t0).toFixed(1),
    },
  };
}

async function resolveSingleBAID(req) {
  const body = await req.json().catch(() => ({}));
  const { searchParams } = new URL(req.url);
  const userId = (body.userId ?? searchParams.get("userId")) || null;
  const email  = (body.email  ?? searchParams.get("email"))  || null;
  const baidIn = (body.baid   ?? searchParams.get("baid"))   || null;

  // If baid provided, optionally validate against email/userId if present
  if (baidIn && (userId || email)) {
    const user = userId
      ? await prisma.users.findUnique({ where: { id: userId }, select: { baid: true } })
      : await prisma.users.findUnique({ where: { email }, select: { baid: true } });
    if (!user?.baid) throw new Error("User not found or has no BAID.");
    if (user.baid !== baidIn) throw new Error("Provided BAID does not match user’s BAID.");
    return baidIn;
  }

  if (baidIn) return baidIn;

  // No baid provided → resolve from userId/email
  if (userId || email) {
    const user = userId
      ? await prisma.users.findUnique({ where: { id: userId }, select: { baid: true } })
      : await prisma.users.findUnique({ where: { email }, select: { baid: true } });
    if (!user?.baid) throw new Error("No BAID found for the given userId/email.");
    return user.baid;
  }

  throw new Error("Provide baid or a resolvable userId/email.");
}

export async function POST(req) {
  try {
    if (!authOk(req)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // REQUIRE exactly one user (no "all users" fallback)
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
    console.error("ingest-order-summaries POST error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    if (!authOk(req)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    // Proxy to POST; still requires baid or userId/email
    return POST(new Request(req.url, { method: "POST", headers: req.headers }));
  } catch (e) {
    console.error("ingest-order-summaries GET error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}
