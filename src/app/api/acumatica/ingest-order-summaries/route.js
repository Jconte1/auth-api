// src/app/api/acumatica/ingest-order-summaries/route.js
import { NextResponse } from "next/server";
import AcumaticaService from "@/lib/acumatica/acumaticaService";
import fetchOrders from "@/lib/acumatica/fetchOrders";
import shapeAndFilter from "@/lib/acumatica/shapeAndFilter";
import { isCronAuthorized } from "@/lib/cron/auth";
import { upsertOrderSummariesForBAID, purgeOldOrders } from "@/lib/acumatica/orderSummaryWriter";
import { createStopwatch } from "@/lib/metrics/stopwatch";

// POST — manual/admin-triggered
export async function POST(req) {
  try {
    const body = await req.json();
    const baid = typeof body?.baid === "string" ? body.baid.trim() : "";
    if (!baid) {
      return NextResponse.json({ message: "Provide { baid: 'BA0001225' }" }, { status: 400 });
    }

    const sw = createStopwatch(`POST ${baid}`);

    const restService = new AcumaticaService(
      process.env.ACUMATICA_BASE_URL,
      process.env.ACUMATICA_CLIENT_ID,
      process.env.ACUMATICA_CLIENT_SECRET,
      process.env.ACUMATICA_USERNAME,
      process.env.ACUMATICA_PASSWORD
    );

    const rawRows = await fetchOrders(restService, baid);
    const tFetch = sw.lap("erp_fetch");

    const { kept, counts, cutoff } = shapeAndFilter(rawRows);
    const tShape = sw.lap("shape_filter_dedupe");

    const { upserted, inactivated } = await upsertOrderSummariesForBAID(baid, kept, cutoff);
    const tWrites = sw.lap("db_upserts_and_inactivate");

    const purged = await purgeOldOrders(cutoff);
    const tPurge = sw.lap("db_purge");
    const tTotal = sw.total();


    return NextResponse.json({
      baid,
      erp: counts,
      db: {
        upserted, inactivated, purged
      },
      timing: {
        erpFetchMs: Number(tFetch.toFixed ? tFetch.toFixed(1) : tFetch),
        shapeMs: Number(tShape.toFixed ? tShape.toFixed(1) : tShape),
        dbWritesMs: Number(tWrites.toFixed ? tWrites.toFixed(1) : tWrites),
        purgeMs: Number(tPurge.toFixed ? tPurge.toFixed(1) : tPurge),
        totalMs: Number(tTotal.toFixed ? tTotal.toFixed(1) : tTotal),
      },
    });
  } catch (e) {
    console.error("ingest-order-summaries POST error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}

// GET — for Vercel Cron (Authorization header) or manual (?token=)
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const baid = (searchParams.get("baid") || "").trim();

    if (!isCronAuthorized(req, searchParams)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    if (!baid) {
      return NextResponse.json({ message: "Provide ?baid=..." }, { status: 400 });
    }

    const sw = createStopwatch(`GET ${baid}`);

    const restService = new AcumaticaService(
      process.env.ACUMATICA_BASE_URL,
      process.env.ACUMATICA_CLIENT_ID,
      process.env.ACUMATICA_CLIENT_SECRET,
      process.env.ACUMATICA_USERNAME,
      process.env.ACUMATICA_PASSWORD
    );

    const rawRows = await fetchOrders(restService, baid);
    const tFetch = sw.lap("erp_fetch");

    const { kept, counts, cutoff } = shapeAndFilter(rawRows);
    const tShape = sw.lap("shape_filter_dedupe");

    const { upserted, inactivated } = await upsertOrderSummariesForBAID(baid, kept, cutoff);
    const tWrites = sw.lap("db_upserts_and_inactivate");

    const purged = await purgeOldOrders(cutoff);
    const tPurge = sw.lap("db_purge");
    const tTotal = sw.total();

    return NextResponse.json({
      baid,
      erp: counts,
      db: {
        upserted, inactivated, purged
      },
      timing: {
        erpFetchMs: Number(tFetch.toFixed ? tFetch.toFixed(1) : tFetch),
        shapeMs: Number(tShape.toFixed ? tShape.toFixed(1) : tShape),
        dbWritesMs: Number(tWrites.toFixed ? tWrites.toFixed(1) : tWrites),
        purgeMs: Number(tPurge.toFixed ? tPurge.toFixed(1) : tPurge),
        totalMs: Number(tTotal.toFixed ? tTotal.toFixed(1) : tTotal),
      },
    });
  } catch (e) {
    console.error("ingest-order-summaries GET error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}
