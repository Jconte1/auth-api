// src/lib/acumatica/write/writeOrders.js
import prisma from "@/lib/prisma/prisma";

function nowMs() { return Number(process.hrtime.bigint() / 1_000_000n); }

/**
 * Upsert summaries for a BAID with "fast insert, update only if changed".
 * - Reads existing rows within the window
 * - createMany (skipDuplicates) for new rows
 * - per-row updates only when status/locationId/deliveryDate/shipVia/jobName changed
 * - marks missing as inactive (same logic as before)
 *
 * @param {string} baid
 * @param {Array<{orderNbr:string,status:string,locationId:string,requestedOn:string}>} orders
 * @param {Date} cutoff  Only affect rows with deliveryDate >= cutoff
 * @param {{concurrency?: number, extrasByNbr?: Record<string, { shipVia?: string|null, jobName?: string|null }>}} opts
 *    extrasByNbr is optional. If provided, we will also write shipVia & jobName.
 * @returns {{inserted:number,updated:number,inactivated:number}}
 */
export async function upsertOrderSummariesForBAID(
  baid,
  orders,
  cutoff,
  { concurrency = 10, extrasByNbr = undefined } = {}
) {
  const now = new Date();
  const t0 = nowMs();

  // Build a lookup from incoming payload; normalize types once here
  const incoming = orders.map(o => {
    const orderNbr = String(o.orderNbr);
    const extra = extrasByNbr?.[orderNbr];
    return {
      orderNbr,
      status: String(o.status),
      locationId: o.locationId != null ? String(o.locationId) : null,
      deliveryDate: new Date(o.requestedOn), // from requestedOn ISO
      shipVia: extra?.shipVia != null ? String(extra.shipVia) : null,
      jobName:  extra?.jobName  != null ? String(extra.jobName)  : null,
    };
  });

  // 1) Read existing rows for this BAID within the window
  const tR1 = nowMs();
  const existing = await prisma.ErpOrderSummary.findMany({
    where: { baid, deliveryDate: { gte: cutoff } },
    select: { orderNbr: true, status: true, locationId: true, deliveryDate: true, shipVia: true, jobName: true },
  });
  const tR2 = nowMs();
  console.log(`[timing] db_read_existing: ${(tR2 - tR1).toFixed(1)} ms (rows=${existing.length})`);

  const existingByNbr = new Map(existing.map(r => [r.orderNbr, r]));

  // 2) Partition into inserts vs updates-needed
  const toInsert = [];
  const toUpdate = [];

  for (const row of incoming) {
    const prev = existingByNbr.get(row.orderNbr);
    if (!prev) {
      toInsert.push(row);
    } else {
      const changed =
        row.status !== prev.status ||
        row.locationId !== prev.locationId ||
        // Compare date value (normalize to ms)
        new Date(row.deliveryDate).getTime() !== new Date(prev.deliveryDate).getTime() ||
        // New fields:
        (row.shipVia ?? null) !== (prev.shipVia ?? null) ||
        (row.jobName ?? null)  !== (prev.jobName ?? null);

      if (changed) toUpdate.push(row);
    }
  }

  // 3) Fast insert for new rows
  let inserted = 0;
  if (toInsert.length) {
    const tI1 = nowMs();
    const { count } = await prisma.ErpOrderSummary.createMany({
      data: toInsert.map(r => ({
        baid,
        orderNbr: r.orderNbr,
        status: r.status,
        locationId: r.locationId,
        jobName: r.jobName ?? null,
        shipVia: r.shipVia ?? null,
        deliveryDate: r.deliveryDate,
        lastSeenAt: now,
        isActive: true,
      })),
      skipDuplicates: true,
    });
    const tI2 = nowMs();
    inserted = count;
    console.log(`[timing] db_createMany: ${(tI2 - tI1).toFixed(1)} ms (inserted=${count})`);
  } else {
    console.log(`[timing] db_createMany: 0 ms (inserted=0)`);
  }

  // 4) Update only changed rows (limited concurrency)
  let updated = 0;
  if (toUpdate.length) {
    const tU1 = nowMs();

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

    await runWithConcurrency(toUpdate, concurrency, async (r) => {
      await prisma.ErpOrderSummary.update({
        where: { baid_orderNbr: { baid, orderNbr: r.orderNbr } },
        data: {
          status: r.status,
          locationId: r.locationId,
          jobName: r.jobName ?? null,
          shipVia: r.shipVia ?? null,
          deliveryDate: r.deliveryDate,
          lastSeenAt: now,
          isActive: true,
        },
      });
      updated += 1;
    });

    const tU2 = nowMs();
    console.log(`[timing] db_updates_changed: ${(tU2 - tU1).toFixed(1)} ms (updated=${updated}, concurrency=${concurrency})`);
  } else {
    console.log(`[timing] db_updates_changed: 0 ms (updated=0)`);
  }

  // 5) Mark missing as inactive (same as before)
  const seenOrderNbrs = incoming.map(r => r.orderNbr);
  const safeNotIn = seenOrderNbrs.length ? seenOrderNbrs : ["__none__"];

  const tM1 = nowMs();
  const { count: inactivated } = await prisma.ErpOrderSummary.updateMany({
    where: {
      baid,
      isActive: true,
      deliveryDate: { gte: cutoff },
      orderNbr: { notIn: safeNotIn },
    },
    data: { isActive: false, updatedAt: now },
  });
  const tM2 = nowMs();
  console.log(`[timing] db_inactivate: ${(tM2 - tM1).toFixed(1)} ms (inactivated=${inactivated})`);

  console.log(
    `[timing] db_total: ${(nowMs() - t0).toFixed(1)} ms ` +
    `(inserted=${inserted}, updated=${updated}, inactivated=${inactivated})`
  );

  return { inserted, updated, inactivated };
}

/**
 * Hard-delete anything older than the cutoff (1-year retention).
 */
export async function purgeOldOrders(cutoff) {
  const t1 = nowMs();
  const { count } = await prisma.ErpOrderSummary.deleteMany({
    where: {
      deliveryDate: { lt: cutoff },
      OR: [
        { status: "Cancelled" },
        { status: "On Hold" },
        { orderNbr: { startsWith: "QT" } },
      ],
    },
  });
  const t2 = nowMs();
  console.log(`[timing] db_purge: ${(t2 - t1).toFixed(1)} ms (deleted=${count})`);
  return count;
}
