// src/lib/acumatica/write/writeVerifiedBaid.js
import prisma from "@/lib/prisma/prisma";

/**
 * Given the raw ERP rows from fetchVerifiedData and a userId,
 * write the found CustomerID into users.baid. Will NOT overwrite if already set.
 *
 * @param {string} userId - Prisma users.id
 * @param {Array<any>} rows - Raw array returned by Acumatica
 * @returns {Promise<{ok:boolean, baid?:string, reason?:string}>}
 */
export default async function writeVerifiedBaid(userId, rows) {
  if (!userId) return { ok: false, reason: "missing-userId" };
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, reason: "empty-response" };
  }

  // Ensure user exists and BAID is not already set
  const user = await prisma.users.findUnique({
    where: { id: String(userId) },
    select: { id: true, baid: true },
  });
  if (!user) return { ok: false, reason: "user-not-found" };
  if (user.baid) return { ok: false, reason: "already-set" };

  // Find the first row that has a CustomerID in either shape
  const rec = rows.find(
    (r) => r?.CustomerID?.value || typeof r?.CustomerID === "string"
  );
  if (!rec) return { ok: false, reason: "no-customerid-in-rows" };

  // Normalize CustomerID from either { value } or direct string
  const baid = rec?.CustomerID?.value ?? rec?.CustomerID ?? null;
  if (!baid) return { ok: false, reason: "customerid-null" };

  // Idempotent first-time update
  await prisma.users.update({
    where: { id: String(userId) },
    data: { baid: String(baid) },
  });

  return { ok: true, baid: String(baid) };
}
