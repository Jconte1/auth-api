// src/lib/acumatica/write/writeOrderLinesBulk.js
import prisma from "@/lib/prisma/prisma";
import filterInventoryDetails from "@/lib/acumatica/filter/filterInventoryDetails";

/**
 * Bulk-reconcile 1:M lines for a BAID using a single transaction.
 * Input is the expanded SalesOrder array (with Details[]) you fetched in Phase 1.
 *
 * Strategy (Phase 2: no change detection yet):
 *  - Normalize all lines once.
 *  - Lookup orderSummaryId for each line via (baid, orderNbr).
 *  - DELETE all existing lines for the affected orders (IN (...) set).
 *  - CREATE all new lines in chunked batches (createMany).
 *
 * Returns timing + counts for observability.
 */
export default async function writeOrderLinesBulk(baid, rawExpandedOrders, { chunkSize = 5000 } = {}) {
  const t0 = Number(process.hrtime.bigint() / 1_000_000n);

  // 1) Normalize all lines from expanded payload
  const { lines, counts: scan } = filterInventoryDetails(rawExpandedOrders);

  // If nothing to write, quick exit
  if (!lines.length) {
    return {
      ordersConsidered: scan.ordersScanned,
      ordersAffected: 0,
      linesKept: 0,
      linesDeleted: 0,
      linesInserted: 0,
      ms: +(Number(process.hrtime.bigint() / 1_000_000n) - t0).toFixed(1),
      scan,
    };
  }

  // 2) Resolve orderSummaryId for each orderNbr under this BAID
  const orderNbrs = Array.from(new Set(lines.map(l => l.orderNbr)));
  const summaries = await prisma.erpOrderSummary.findMany({
    where: { baid, orderNbr: { in: orderNbrs } },
    select: { id: true, orderNbr: true },
  });
  const idByNbr = new Map(summaries.map(s => [s.orderNbr, s.id]));

  // Keep only lines that map to a known summary (defensive)
  const mapped = lines
    .map(l => ({ ...l, orderSummaryId: idByNbr.get(l.orderNbr) }))
    .filter(l => !!l.orderSummaryId);

  if (!mapped.length) {
    return {
      ordersConsidered: scan.ordersScanned,
      ordersAffected: 0,
      linesKept: 0,
      linesDeleted: 0,
      linesInserted: 0,
      ms: +(Number(process.hrtime.bigint() / 1_000_000n) - t0).toFixed(1),
      scan,
    };
  }

  // Prepare createMany rows
  const createRows = mapped.map(l => ({
    orderSummaryId: l.orderSummaryId,
    baid,
    orderNbr: l.orderNbr,
    lineDescription: l.lineDescription ?? null,
    inventoryId: l.inventoryId ?? null,
    lineType: l.lineType ?? null,
    openQty: l.openQty ?? null,       // Prisma Decimal accepts string
    unitPrice: l.unitPrice ?? null,   // Prisma Decimal accepts string
    usrETA: l.usrETA ? new Date(l.usrETA) : null,
  }));

  // Set of affected orderSummaryIds for targeted delete
  const affectedOrderIds = Array.from(new Set(mapped.map(l => l.orderSummaryId)));

  let linesDeleted = 0;
  let linesInserted = 0;

  // 3) Single transaction: delete all existing lines for affected orders, then insert all new lines
  await prisma.$transaction(async (tx) => {
    const delRes = await tx.erpOrderLine.deleteMany({
      where: { orderSummaryId: { in: affectedOrderIds } },
    });
    linesDeleted = delRes.count;

    // Chunk large inserts to keep payload sizes sane
    if (createRows.length) {
      for (let i = 0; i < createRows.length; i += chunkSize) {
        const slice = createRows.slice(i, i + chunkSize);
        const { count } = await tx.erpOrderLine.createMany({
          data: slice,
          skipDuplicates: true,
        });
        linesInserted += count;
      }
    }
  });

  const ms = +(Number(process.hrtime.bigint() / 1_000_000n) - t0).toFixed(1);

  return {
    ordersConsidered: scan.ordersScanned,
    ordersAffected: affectedOrderIds.length,
    linesKept: mapped.length,
    linesDeleted,
    linesInserted,
    ms,
    scan, // normalization stats for visibility
  };
}
