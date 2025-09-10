// /lib/orderSummaryWriter.js
import prisma from "../prisma";

/**
 * Upsert summaries for a BAID and mark missing (within window) as inactive.
 * @param {string} baid
 * @param {Array<{orderNbr:string,status:string,locationId:string,requestedOn:string}>} orders
 * @param {Date} cutoff - only affect rows with deliveryDate >= cutoff
 * @returns {{upserted:number,inactivated:number}}
 */
export async function upsertOrderSummariesForBAID(baid, orders, cutoff) {
  const now = new Date();

  // Build upsert ops
  const upserts = orders.map(o =>
    prisma.ErpOrderSummary.upsert({
      where: { baid_orderNbr: { baid, orderNbr: o.orderNbr } },
      create: {
        baid,
        orderNbr: o.orderNbr,
        status: o.status,
        locationId: o.locationId ?? null,
        locationName: null,
        deliveryDate: new Date(o.requestedOn),
        lastSeenAt: now,
        isActive: true,
      },
      update: {
        status: o.status,
        locationId: o.locationId ?? null,
        deliveryDate: new Date(o.requestedOn),
        lastSeenAt: now,
        isActive: true,
      },
    })
  );

  const seenOrderNbrs = orders.map(o => o.orderNbr);
  const safeNotIn = seenOrderNbrs.length ? seenOrderNbrs : ["__none__"];

  const results = await prisma.$transaction([
    ...upserts,
    prisma.ErpOrderSummary.updateMany({
      where: {
        baid,
        isActive: true,
        deliveryDate: { gte: cutoff },
        orderNbr: { notIn: safeNotIn },
      },
      data: { isActive: false, updatedAt: now },
    }),
  ]);

  // Last element in the transaction is the updateMany result
  const inactivated = results[results.length - 1].count ?? 0;
  return { upserted: upserts.length, inactivated };
}

/**
 * Hard-delete anything older than the cutoff (1-year retention).
 * @param {Date} cutoff
 * @returns {number} count deleted
 */
export async function purgeOldOrders(cutoff) {
  const { count } = await prisma.ErpOrderSummary.deleteMany({
    where: { deliveryDate: { lt: cutoff } },
  });
  return count;
}
