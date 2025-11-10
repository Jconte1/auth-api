// src/lib/acumatica/write/writeOrderSummaries.js
import prisma from "@/lib/prisma/prisma";

/**
 * Upsert ErpOrderSummary rows from summaries-only payload.
 * - Keeps 1-year window logic external (you pass cutoff).
 * - Sets shipVia & jobName when present.
 * - Fast insert via createMany; minimal per-row updates.
 */

// TODO
// ADD 6 WEEK CONFIRM AND 2 WEEK CONFIRM BOOLEAN 
export async function upsertOrderSummariesForBAID(
  baid,
  rawRows,
  cutoff,
  { concurrency = 10 } = {}
) {
  const now = new Date();

  // Normalize incoming rows (support ERP keys AND normalized camelCase)
  const incoming = [];
  for (const row of Array.isArray(rawRows) ? rawRows : []) {
    const orderNbr = firstVal(row, ["OrderNbr", "orderNbr", "nbr"]);
    const status = firstVal(row, ["Status", "status"]);
    const locationId = firstVal(row, ["LocationID", "locationId"]);
    const requested = firstVal(row, ["RequestedOn", "requestedOn", "deliveryDate"]);
    const shipVia = firstVal(row, ["ShipVia", "shipVia"]);
    const jobName = firstVal(row, ["JobName", "jobName"]);
    const customerName = firstVal(row, ["CustomerName", "customerName"]);
    const buyerGroup = firstVal(row, 
      ["custom.Document.AttributeBUYERGROUP",
        "Document.AttributeBUYERGROUP",
        "buyerGroup",
        "BuyerGroup"
      ]);
    const noteId = firstVal(row, ["NoteID", "noteId", "noteID"]);

    const requestedOn = toDate(requested);
    if (!orderNbr || !status || !requestedOn) continue;

    incoming.push({
      orderNbr: String(orderNbr),
      status: String(status),
      locationId: locationId != null ? String(locationId) : null,
      deliveryDate: requestedOn,                // maps RequestedOn/requestedOn -> deliveryDate
      shipVia: optStr(shipVia),
      jobName: optStr(jobName),
      customerName: optStr(customerName),
      buyerGroup: optStr(buyerGroup),
      noteId: optStr(noteId),
    });
  }
  console.log(`[upsertOrderSummaries] baid=${baid} incoming=${incoming.length}`);
  
  // Read existing within window
  const existing = await prisma.erpOrderSummary.findMany({
    where: { baid, deliveryDate: { gte: cutoff } },
    select: {
      orderNbr: true,
      status: true,
      locationId: true,
      deliveryDate: true,
      shipVia: true,
      jobName: true,
      customerName: true,
      buyerGroup: true,
      noteId: true,
    },
  });
  const byNbr = new Map(existing.map(r => [r.orderNbr, r]));

  // Partition
  const toInsert = [];
  const toUpdate = [];
  for (const r of incoming) {
    const prev = byNbr.get(r.orderNbr);
    if (!prev) {
      toInsert.push(r);
    } else {
      const changed =
        r.status !== prev.status ||
        (r.locationId || null) !== (prev.locationId || null) ||
        +new Date(r.deliveryDate) !== +new Date(prev.deliveryDate) ||
        (r.shipVia || null) !== (prev.shipVia || null) ||
        (r.jobName || null) !== (prev.jobName || null) ||
        (r.customerName || null) !== (prev.customerName || null) ||
        (r.buyerGroup || null) !== (prev.buyerGroup || null) ||
        (r.noteId || null) !== (prev.noteId || null);
      if (changed) toUpdate.push(r);
    }
  }

  // Inserts
  let inserted = 0;
  if (toInsert.length) {
    const { count } = await prisma.erpOrderSummary.createMany({
      data: toInsert.map(r => ({
        baid,
        orderNbr: r.orderNbr,
        status: r.status,
        locationId: r.locationId,
        jobName: r.jobName ?? null,
        customerName: r.customerName ?? "",
        shipVia: r.shipVia ?? null,
        deliveryDate: r.deliveryDate,
        lastSeenAt: now,
        isActive: true,
        buyerGroup: r.buyerGroup?? "",
        noteId: r.noteId?? "",
      })),
      skipDuplicates: true,
    });
    inserted = count;
    console.log(`[upsertOrderSummaries] inserted=${inserted} baid=${baid}`);
  }

  // Updates (bounded concurrency)
  let updated = 0;
  if (toUpdate.length) {
    await runWithConcurrency(toUpdate, concurrency, async (r) => {
      await prisma.erpOrderSummary.update({
        where: { baid_orderNbr: { baid, orderNbr: r.orderNbr } },
        data: {
          status: r.status,
          locationId: r.locationId,
          jobName: r.jobName ?? null,
          customerName: r.customerName ?? "",
          shipVia: r.shipVia ?? null,
          deliveryDate: r.deliveryDate,
          buyerGroup: r.buyerGroup ?? "",
          noteId: r.noteId ?? "",
          lastSeenAt: now,
          isActive: true,
        },
      });
      updated += 1;
    });
    console.log(`[upsertOrderSummaries] updated=${updated} baid=${baid}`);
  }

  // Inactivate missing within window
  const seen = incoming.map(r => r.orderNbr);
  const { count: inactivated } = await prisma.erpOrderSummary.updateMany({
    where: {
      baid,
      isActive: true,
      deliveryDate: { gte: cutoff },
      orderNbr: { notIn: seen.length ? seen : ["__none__"] },
    },
    data: { isActive: false, updatedAt: now },
  });

  return { inserted, updated, inactivated };
}

export async function purgeOldOrders(cutoff) {
  const { count } = await prisma.erpOrderSummary.deleteMany({
    where: {
      deliveryDate: { lt: cutoff },
      OR: [
        { status: "Cancelled" }, // note: ERP may use "Canceled" or "Cancelled"
        { status: "Canceled" },
        { status: "On Hold" },
        { orderNbr: { startsWith: "QT" } },
      ],
    },
  });
  return count;
}

/* ----------------- helpers ----------------- */
function val(row, key) {
  const v = row?.[key];
  if (v && typeof v === "object" && "value" in v) return v.value;
  return v;
}
function firstVal(row, keys) {
  for (const k of keys) {
    const v = val(row, k);
    if (v != null) return v;
  }
  return null;
}
function toDate(v) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(+d) ? d : null;
}
function optStr(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return String(v);
}
async function runWithConcurrency(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}
