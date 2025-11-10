// src/lib/db/writeConfirmOrder.js
import prisma from "@/lib/prisma/prisma";

/**
 * Write "confirmed via / confirmed with" for a given order number
 * into the contact table.
 *
 * Assumptions:
 * - Model name is `erpOrderContact`
 * - It has a field `orderNbr` (string) that identifies the order's contact row
 * - Fields to write are `confirmedVia` and `confirmedWith` (strings, nullable)
 *
 * @param {object} args
 * @param {string} args.orderNbr
 * @param {string} args.confirmedVia
 * @param {string} args.confirmedWith
 * @returns {Promise<{ok: boolean, reason?: string, updated?: number, created?: boolean}>}
 */
export default async function writeConfirmOrder({ orderNbr, confirmedVia, confirmedWith }) {
  // Basic validation
  const nbr = String(orderNbr || "").trim();
  const via = String(confirmedVia || "").trim();
  const wth = String(confirmedWith || "").trim();

  if (!nbr) return { ok: false, reason: "missing-orderNbr" };
  if (!wth) return { ok: false, reason: "missing-confirmedWith" };
  // `via` can be defaulted upstream to "email response"; still guard the empty case:
  if (!via) return { ok: false, reason: "missing-confirmedVia" };

  // 1) Try to update an existing contact row for this order
  // If your model is named differently, change `erpOrderContact` here.
  const result = await prisma.erpOrderContact.updateMany({
    where: { orderNbr: nbr }, // If your unique key differs, adjust this predicate
    data: {
      confirmedVia: via,
      confirmedWith: wth,
      updatedAt: new Date(),
    },
  });

  if (result.count > 0) {
    return { ok: true, updated: result.count };
  }

  // 2) If nothing updated, upsert/create a minimal row
  // If `orderNbr` is UNIQUE in Prisma, you can use upsert; otherwise create.
  // Here we do a safe "create if none" fallback:
  try {
    await prisma.erpOrderContact.create({
      data: {
        orderNbr: nbr,
        confirmedVia: via,
        confirmedWith: wth,
      },
    });
    return { ok: true, created: true };
  } catch (err) {
    // If your schema requires additional fields on create, this will throw.
    // Add any required fields to the `data` above.
    return { ok: false, reason: "create-failed:" + (err?.message || "unknown") };
  }
}
