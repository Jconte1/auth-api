import prisma from "@/lib/prisma/prisma";
import deriveOrderPmAssignment from "@/services/assignment/deriveOrderPmAssignment";

export default async function writeAddressContact(
  baid,
  rows,
  { concurrency = 10 } = {}
) {
  const now = new Date();
  let addressUpserts = 0;
  let contactUpserts = 0;

  const safeRows = Array.isArray(rows) ? rows : [];
  console.log(`[upsertAddressContact] baid=${baid} incoming=${safeRows.length}`);

  // Collect order numbers
  const orderNbrs = [];
  for (const row of safeRows) {
    const orderNbr = firstVal(row, ["OrderNbr", "orderNbr", "nbr"]);
    const nbr = str(orderNbr);
    if (nbr) orderNbrs.push(nbr);
  }
  const uniqueNbrs = Array.from(new Set(orderNbrs));
  console.log(`[upsertAddressContact] baid=${baid} uniqueOrderNbrs=${uniqueNbrs.length}`);

  if (!uniqueNbrs.length) {
    console.log(`[upsertAddressContact] baid=${baid} nothing-to-map`);
    return { processedOrders: 0, addressUpserts: 0, contactUpserts: 0, ms: 0 };
  }

  const summaries = await prisma.erpOrderSummary.findMany({
    where: { baid, orderNbr: { in: uniqueNbrs } },
    select: { id: true, orderNbr: true },
  });
  const idByNbr = new Map(summaries.map(s => [s.orderNbr, s.id]));
  console.log(`[upsertAddressContact] baid=${baid} mappedSummaries=${summaries.length}`);

  const tasks = [];
  const mappedOrderNbrs = new Set();

  for (const row of safeRows) {
    const orderNbrStr = str(firstVal(row, ["OrderNbr", "orderNbr", "nbr"]));
    if (!orderNbrStr) continue;

    const orderSummaryId = idByNbr.get(orderNbrStr);
    if (!orderSummaryId) continue;
    mappedOrderNbrs.add(orderNbrStr);

    const address = {
      addressLine1: optStr(firstVal(row, ["AddressLine1", "addressLine1"])),
      addressLine2: optStr(firstVal(row, ["AddressLine2", "addressLine2"])),
      city: optStr(firstVal(row, ["City", "city"])),
      state: optStr(firstVal(row, ["State", "state"])),
      postalCode: optStr(firstVal(row, ["PostalCode", "postalCode"])),
    };
    const contact = {
      deliveryEmail: optStr(firstVal(row, ["DeliveryEmail", "deliveryEmail"])),
      siteNumber: optStr(firstVal(row, [
        "custom.Document.AttributeSITENUMBER",
        "Document.AttributeSITENUMBER",
        "siteNumber",
        "SiteNumber",
      ])),
      osContact: optStr(firstVal(row, [
        "custom.Document.AttributeOSCONTACT",
        "Document.AttributeOSCONTACT",
        "osContact",
        "OsContact",
        "OSCONTACT",
      ])),
      confirmedVia: optStr(firstVal(row, [
        "custom.Document.AttributeCONFIRMVIA",
        "Document.AttributeCONFIRMVIA",
        "confirmVia",
        "CONFIRMVIA",
      ])),
      confirmedWith: optStr(firstVal(row, [
        "custom.Document.AttributeCONFIRMWTH",
        "Document.AttributeCONFIRMWTH",
        "confirmWith",
        "CONFIRMWITH",
      ])),
      threeDaySent: optBool(firstVal(row, [
        "custom.Document.AttributeTHREEDAY",
        "Document.AttributeTHREEDAY",
        "threeDay",
        "ThreeDay",
        "THREEDAY",
      ])),
      tenDaySent: optBool(firstVal(row, [
        "custom.Document.AttributeTWOWEEK",
        "Document.AttributeTWOWEEK",
        "twoWeek",
        "TwoWeek",
        "TWOWEEK",
      ])),
      sixWeekFailed: optBool(firstVal(row, [
        "custom.Document.AttributeSIXWEEKFF",
        "Document.AttributeSIXWEEKFF",
        "sixWeek",
        "SixWeek",
        "SIXWEEK",
      ])),
    };

    if (Object.values(address).some(v => v !== null)) {
      tasks.push(async () => {
        await prisma.erpOrderAddress.upsert({
          where: { orderSummaryId },
          create: { orderSummaryId, baid, orderNbr: orderNbrStr, ...address },
          update: { baid, orderNbr: orderNbrStr, ...address, updatedAt: now },
        });
        addressUpserts += 1;
      });
    }
    if (Object.values(contact).some(v => v !== null)) {
      tasks.push(async () => {
        await prisma.erpOrderContact.upsert({
          where: { orderSummaryId },
          create: { orderSummaryId, baid, orderNbr: orderNbrStr, ...contact },
          update: { baid, orderNbr: orderNbrStr, ...contact, updatedAt: now },
        });
        contactUpserts += 1;

        // fire-and-forget: derive PM assignment from deliveryEmail after contact is saved
        deriveOrderPmAssignment(orderSummaryId).catch(() => {});
      });
    }
  }

  if (!tasks.length) {
    console.log(`[upsertAddressContact] baid=${baid} mappedOrders=${mappedOrderNbrs.size} no-upserts`);
    return { processedOrders: mappedOrderNbrs.size, addressUpserts: 0, contactUpserts: 0, ms: 0 };
  }

  const t0 = Date.now();
  await runWithConcurrency(tasks, concurrency, (fn) => fn());
  const ms = Date.now() - t0;

  console.log(
    `[upsertAddressContact] baid=${baid} processedOrders=${mappedOrderNbrs.size} ` +
    `addressUpserts=${addressUpserts} contactUpserts=${contactUpserts} ms=${ms}`
  );

  return { processedOrders: mappedOrderNbrs.size, addressUpserts, contactUpserts, ms };
}

/* helpers (unchanged) ... */


/* ----------------- helpers ----------------- */
function val(obj, key) {
  const v = obj?.[key];
  if (v && typeof v === "object" && "value" in v) return v.value;
  return v;
}
function getPath(obj, dotted) {
  // supports dotted paths like "Document.AttributeSITENUMBER"
  if (!dotted || typeof dotted !== "string" || dotted.indexOf(".") === -1) {
    return val(obj, dotted);
  }
  const parts = dotted.split(".");
  let cur = obj;
  for (const p of parts) {
    cur = cur?.[p];
    if (cur && typeof cur === "object" && "value" in cur) cur = cur.value;
    if (cur == null) break;
  }
  return cur;
}
function firstVal(obj, keys) {
  for (const k of keys) {
    const v = k.includes(".") ? getPath(obj, k) : val(obj, k);
    if (v != null) return v;
  }
  return null;
}
function str(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function optStr(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  if (typeof v === "object") return null; // avoid "[object Object]"
  const s = String(v).trim();
  return s ? s : null;
}
function optBool(v) {
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(s)) return true;
  if (["false", "no", "n", "0"].includes(s)) return false;
  // Acumatica sometimes returns empty string for unchecked
  if (s === "") return false;
  return null; // if it’s some unexpected value, don’t write junk
}
async function runWithConcurrency(items, limit, worker) {
  let i = 0;
  const n = Math.min(limit, items.length);
  const runners = Array.from({ length: n }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}
