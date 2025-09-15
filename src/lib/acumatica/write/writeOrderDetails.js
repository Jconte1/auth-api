// src/lib/acumatica/write/writeOrderDetails.js
import prisma from "@/lib/prisma/prisma";

function nowMs() { return Number(process.hrtime.bigint() / 1_000_000n); }

/** Extract Acumatica field that may be raw, { value }, empty object, or null. */
const getRaw = (obj, key) => {
  const v = obj?.[key];
  if (v == null) return null;
  if (typeof v === "object") {
    if ("value" in v) return v.value ?? null;
    return null; // treat bare objects like {} as null
  }
  return v;
};
/** Extract custom attribute from row.Document or flat, respecting { value } shape. */
const getCustom = (row, attr) => {
  const fromDoc = row?.Document?.[attr];
  if (fromDoc != null) {
    if (typeof fromDoc === "object") return ("value" in fromDoc ? fromDoc.value ?? null : null);
    return fromDoc;
  }
  const flat = row?.[attr];
  if (flat != null) {
    if (typeof flat === "object") return ("value" in flat ? flat.value ?? null : null);
    return flat;
  }
  return null;
};
/** Coerce to trimmed string; empty string → null. Non-primitive → null. */
const toStr = (v) => {
  if (v == null || typeof v === "object") return null;
  const s = String(v).trim();
  return s.length ? s : null;
};
/** Decimals as strings for Prisma Decimal. Objects/empty → null. */
const toDec = (v) => {
  if (v == null || typeof v === "object") return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

const isAllNull = (obj) => Object.values(obj).every(v => v == null);
const neq = (a, b) => (a ?? null) !== (b ?? null);

function diffAddress(newRow, existing) {
  if (!existing) return !isAllNull(newRow) ? { changed: true, delete: false, create: true } : { changed: false, delete: false, create: false };
  const changed =
    neq(newRow.addressLine1, existing.addressLine1) ||
    neq(newRow.addressLine2, existing.addressLine2) ||
    neq(newRow.city, existing.city) ||
    neq(newRow.state, existing.state) ||
    neq(newRow.postalCode, existing.postalCode);
  if (!changed) return { changed: false, delete: false, create: false };
  if (isAllNull(newRow)) return { changed: true, delete: true, create: false }; // clear it
  return { changed: true, delete: true, create: true };
}
function diffContact(newRow, existing) {
  if (!existing) return !isAllNull(newRow) ? { changed: true, delete: false, create: true } : { changed: false, delete: false, create: false };
  const changed =
    neq(newRow.deliveryEmail, existing.deliveryEmail) ||
    neq(newRow.siteNumber, existing.siteNumber) ||
    neq(newRow.osContact, existing.osContact);
  if (!changed) return { changed: false, delete: false, create: false };
  if (isAllNull(newRow)) return { changed: true, delete: true, create: false };
  return { changed: true, delete: true, create: true };
}
function diffPayment(newRow, existing) {
  if (!existing) return !isAllNull(newRow) ? { changed: true, delete: false, create: true } : { changed: false, delete: false, create: false };
  const changed =
    neq(newRow.orderTotal, existing.orderTotal) ||
    neq(newRow.unpaidBalance, existing.unpaidBalance);
  if (!changed) return { changed: false, delete: false, create: false };
  if (isAllNull(newRow)) return { changed: true, delete: true, create: false };
  return { changed: true, delete: true, create: true };
}

/**
 * Bulk reconcile Address, Contact, and Payment (1:1 tables) for a BAID — with change detection.
 * - Only delete+create rows for orders whose values actually changed.
 * - If new values are all null and a row exists, we delete it (to reflect clearing).
 * - If new values are all null and no row exists, we skip (no-op).
 */
export async function upsertOrderDetailsForBAID(
  baid,
  keptOrders,
  rawRows,
  { chunkSize = 2000 } = {}
) {
  const t0 = nowMs();

  // 1) Build kept set and normalize per order
  const keptSet = new Set((keptOrders || []).map(o => String(o.orderNbr)));
  if (!keptSet.size) {
    return { processedOrders: 0, addressUpserts: 0, contactUpserts: 0, paymentUpserts: 0, ms: 0 };
  }

  const byNbr = new Map();
  for (const row of Array.isArray(rawRows) ? rawRows : []) {
    const orderNbr = toStr(getRaw(row, "OrderNbr"));
    if (!orderNbr || !keptSet.has(orderNbr)) continue;

    byNbr.set(orderNbr, {
      address: {
        addressLine1: toStr(getRaw(row, "AddressLine1")),
        addressLine2: toStr(getRaw(row, "AddressLine2")),
        city:         toStr(getRaw(row, "City")),
        state:        toStr(getRaw(row, "State")),
        postalCode:   toStr(getRaw(row, "PostalCode")),
      },
      contact: {
        deliveryEmail: toStr(getRaw(row, "DeliveryEmail")),
        siteNumber:    toStr(getCustom(row, "AttributeSITENUMBER")),
        osContact:     toStr(getCustom(row, "AttributeOSCONTACT")),
      },
      payment: {
        orderTotal:    toDec(getRaw(row, "OrderTotal")),
        unpaidBalance: toDec(getRaw(row, "UnpaidBalance")),
      },
    });
  }

  // 2) Resolve orderSummaryId for kept orders
  const orderNbrs = Array.from(keptSet);
  const summaries = await prisma.erpOrderSummary.findMany({
    where: { baid, orderNbr: { in: orderNbrs } },
    select: { id: true, orderNbr: true },
  });
  const idByNbr = new Map(summaries.map(s => [s.orderNbr, s.id]));

  const affected = [];
  for (const nbr of orderNbrs) {
    const id = idByNbr.get(nbr);
    if (id) affected.push({ orderNbr: nbr, orderSummaryId: id });
  }
  if (!affected.length) {
    return { processedOrders: 0, addressUpserts: 0, contactUpserts: 0, paymentUpserts: 0, ms: +(nowMs() - t0).toFixed(1) };
  }

  // 3) Read existing rows for diffing (only those orderSummaryIds)
  const ids = affected.map(a => a.orderSummaryId);

  const [addrExisting, contactExisting, payExisting] = await Promise.all([
    prisma.erpOrderAddress.findMany({
      where: { orderSummaryId: { in: ids } },
      select: { orderSummaryId: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true },
    }),
    prisma.erpOrderContact.findMany({
      where: { orderSummaryId: { in: ids } },
      select: { orderSummaryId: true, deliveryEmail: true, siteNumber: true, osContact: true },
    }),
    prisma.erpOrderPayment.findMany({
      where: { orderSummaryId: { in: ids } },
      select: { orderSummaryId: true, orderTotal: true, unpaidBalance: true },
    }),
  ]);

  const addrById = new Map(addrExisting.map(r => [r.orderSummaryId, r]));
  const contactById = new Map(contactExisting.map(r => [r.orderSummaryId, r]));
  const payById = new Map(payExisting.map(r => [r.orderSummaryId, r]));

  // 4) Compute per-table change sets
  const toDeleteAddr = new Set();
  const toCreateAddr = [];
  const toDeleteContact = new Set();
  const toCreateContact = [];
  const toDeletePayment = new Set();
  const toCreatePayment = [];

  for (const { orderNbr, orderSummaryId } of affected) {
    const extra = byNbr.get(orderNbr) || { address: {}, contact: {}, payment: {} };

    // Address
    const newAddr = extra.address;
    const addrDiff = diffAddress(newAddr, addrById.get(orderSummaryId));
    if (addrDiff.changed) {
      if (addrDiff.delete) toDeleteAddr.add(orderSummaryId);
      if (addrDiff.create) {
        toCreateAddr.push({
          orderSummaryId,
          baid,
          orderNbr,
          addressLine1: newAddr.addressLine1 ?? null,
          addressLine2: newAddr.addressLine2 ?? null,
          city:         newAddr.city ?? null,
          state:        newAddr.state ?? null,
          postalCode:   newAddr.postalCode ?? null,
        });
      }
    }

    // Contact
    const newContact = extra.contact;
    const contactDiff = diffContact(newContact, contactById.get(orderSummaryId));
    if (contactDiff.changed) {
      if (contactDiff.delete) toDeleteContact.add(orderSummaryId);
      if (contactDiff.create) {
        toCreateContact.push({
          orderSummaryId,
          baid,
          orderNbr,
          deliveryEmail: newContact.deliveryEmail ?? null,
          siteNumber:    newContact.siteNumber ?? null,
          osContact:     newContact.osContact ?? null,
        });
      }
    }

    // Payment
    const newPayment = extra.payment;
    const payDiff = diffPayment(newPayment, payById.get(orderSummaryId));
    if (payDiff.changed) {
      if (payDiff.delete) toDeletePayment.add(orderSummaryId);
      if (payDiff.create) {
        toCreatePayment.push({
          orderSummaryId,
          baid,
          orderNbr,
          orderTotal:    newPayment.orderTotal ?? null,
          unpaidBalance: newPayment.unpaidBalance ?? null,
        });
      }
    }
  }

  // 5) Apply changes in a single transaction (delete changed rows, then create changed rows)
  let addressUpserts = 0;
  let contactUpserts = 0;
  let paymentUpserts = 0;

  await prisma.$transaction(async (tx) => {
    if (toDeleteAddr.size) {
      await tx.erpOrderAddress.deleteMany({ where: { orderSummaryId: { in: Array.from(toDeleteAddr) } } });
    }
    if (toCreateAddr.length) {
      // chunking not usually needed here, but keep it consistent
      const chunk = 2000;
      for (let i = 0; i < toCreateAddr.length; i += chunk) {
        const { count } = await tx.erpOrderAddress.createMany({
          data: toCreateAddr.slice(i, i + chunk),
          skipDuplicates: true,
        });
        addressUpserts += count;
      }
    }

    if (toDeleteContact.size) {
      await tx.erpOrderContact.deleteMany({ where: { orderSummaryId: { in: Array.from(toDeleteContact) } } });
    }
    if (toCreateContact.length) {
      const chunk = 2000;
      for (let i = 0; i < toCreateContact.length; i += chunk) {
        const { count } = await tx.erpOrderContact.createMany({
          data: toCreateContact.slice(i, i + chunk),
          skipDuplicates: true,
        });
        contactUpserts += count;
      }
    }

    if (toDeletePayment.size) {
      await tx.erpOrderPayment.deleteMany({ where: { orderSummaryId: { in: Array.from(toDeletePayment) } } });
    }
    if (toCreatePayment.length) {
      const chunk = 2000;
      for (let i = 0; i < toCreatePayment.length; i += chunk) {
        const { count } = await tx.erpOrderPayment.createMany({
          data: toCreatePayment.slice(i, i + chunk),
          skipDuplicates: true,
        });
        paymentUpserts += count;
      }
    }
  });

  const ms = +(nowMs() - t0).toFixed(1);
  return {
    processedOrders: affected.length, // orders considered
    addressUpserts,
    contactUpserts,
    paymentUpserts,
    ms,
  };
}

export default { upsertOrderDetailsForBAID };
