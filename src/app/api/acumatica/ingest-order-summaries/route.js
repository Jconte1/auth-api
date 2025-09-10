// src/app/api/acumatica/ingest-order-summaries/route.js
import { NextResponse } from "next/server";
import AcumaticaService from "@/lib/acumatica/acumaticaService";
import { upsertOrderSummariesForBAID, purgeOldOrders } from "@/lib/acumatica/orderSummaryWriter";

// ---- helpers (same as before) ----
function startOfDayDenver(d = new Date()) {
  const local = new Date(d.toLocaleString("en-US", { timeZone: "America/Denver" }));
  local.setHours(0, 0, 0, 0);
  return local;
}
function oneYearAgoDenver(d = new Date()) {
  const s = startOfDayDenver(d);
  s.setFullYear(s.getFullYear() - 1);
  return s;
}
async function fetchOrders(restService, baid) {
  const token = await restService.getToken();
  const url = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001//SalesOrder?$filter=CustomerID eq '${baid}'&$select=OrderNbr,Status,LocationID,RequestedOn`;


  const resp = await fetch(encodeURI(url), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const raw = await resp.text();
  if (!resp.ok) throw new Error(raw || `ERP error for ${baid}`);

  const parsed = raw ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed : [];
}
function shapeAndFilter(rawRows) {
  const cutoff = oneYearAgoDenver(new Date());

  const normalized = [];
  let droppedMissing = 0;
  for (const row of rawRows) {
    const orderNbr = row?.OrderNbr?.value ?? row?.OrderNbr ?? null;
    const status = row?.Status?.value ?? row?.Status ?? null;
    const locationId = row?.LocationID?.value ?? row?.LocationID ?? null;
    const requestedOnRaw = row?.RequestedOn?.value ?? row?.RequestedOn ?? null;
    if (!orderNbr || !status || !locationId || !requestedOnRaw) {
      droppedMissing++; continue;
    }
    const requestedOn = new Date(requestedOnRaw);
    if (Number.isNaN(requestedOn.getTime())) { droppedMissing++; continue; }
    normalized.push({
      orderNbr: String(orderNbr),
      status: String(status),
      locationId: String(locationId),
      requestedOn: requestedOn.toISOString(),
    });
  }

  // 1-year window
  const cutoffISO = cutoff.toISOString();
  const withinWindow = [];
  let droppedOld = 0;
  for (const item of normalized) {
    if (item.requestedOn >= cutoffISO) withinWindow.push(item);
    else droppedOld++;
  }

  // dedupe by orderNbr (keep most recent requestedOn)
  const byNbr = new Map();
  for (const item of withinWindow) {
    const prev = byNbr.get(item.orderNbr);
    if (!prev || item.requestedOn > prev.requestedOn) byNbr.set(item.orderNbr, item);
  }
  const deduped = Array.from(byNbr.values());

  return {
    kept: deduped,
    counts: {
      totalFromERP: rawRows.length,
      droppedMissing,
      droppedOld,
      kept: deduped.length,
    },
    cutoff,
  };
}

// ✅ Named export for POST — no default export in this file
export async function POST(req) {
  try {
    const body = await req.json();
    const baid = typeof body?.baid === "string" ? body.baid.trim() : "";
    if (!baid) {
      return NextResponse.json({ message: "Provide { baid: 'BA0001225' }" }, { status: 400 });
    }

    const restService = new AcumaticaService(
      process.env.ACUMATICA_BASE_URL,
      process.env.ACUMATICA_CLIENT_ID,
      process.env.ACUMATICA_CLIENT_SECRET,
      process.env.ACUMATICA_USERNAME,
      process.env.ACUMATICA_PASSWORD
    );

    // 1) fetch
    const rawRows = await fetchOrders(restService, baid);

    // 2) shape + filter
    const { kept, counts, cutoff } = shapeAndFilter(rawRows);

    // 3) write
    const { upserted, inactivated } = await upsertOrderSummariesForBAID(baid, kept, cutoff);

    // 4) purge >1y
    const purged = await purgeOldOrders(cutoff);

    return NextResponse.json({
      baid,
      erp: counts,
      db: { upserted, inactivated, purged },
    });
  } catch (e) {
    console.error("ingest-order-summaries POST error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }

  export async function GET(req) {
    try {
      const { searchParams } = new URL(req.url);
      const baid = (searchParams.get("baid") || "").trim();
      const token = searchParams.get("token") || "";

      // 1) protect with secret
      if (!token || token !== process.env.CRON_SECRET) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      }
      if (!baid) {
        return NextResponse.json({ message: "Provide ?baid=..." }, { status: 400 });
      }

      // 2) same flow as POST
      const restService = new AcumaticaService(
        process.env.ACUMATICA_BASE_URL,
        process.env.ACUMATICA_CLIENT_ID,
        process.env.ACUMATICA_CLIENT_SECRET,
        process.env.ACUMATICA_USERNAME,
        process.env.ACUMATICA_PASSWORD
      );

      const rawRows = await fetchOrders(restService, baid);
      const { kept, counts, cutoff } = shapeAndFilter(rawRows);
      const { upserted, inactivated } = await upsertOrderSummariesForBAID(baid, kept, cutoff);
      const purged = await purgeOldOrders(cutoff);

      return NextResponse.json({
        baid,
        erp: counts,
        db: { upserted, inactivated, purged },
      });
    } catch (e) {
      console.error("ingest-order-summaries GET error:", e);
      return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
    }
  }
}
