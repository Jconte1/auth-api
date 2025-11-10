import prisma from "@/lib/prisma/prisma";

/**
 * Upsert into 4 tables: ErpOrderSummary, ErpOrderAddress, ErpOrderContact, ErpOrderPayment.
 * Assumes each ERP row is HEADER-LEVEL (one per order).
 */
export default async function writeDailySync(baid, rows) {
  let summaries = 0, addresses = 0, contacts = 0, payments = 0;

  const safeRows = Array.isArray(rows) ? rows : [];

  for (const r of safeRows) {
    // Prefer resilient accessors (match your ingest-address-contact pattern)
    const get = (k) => firstVal(r, [k, k?.toLowerCase(), k?.toUpperCase()]);

    const orderNbr = optStr(firstVal(r, ["OrderNbr", "orderNbr", "nbr"]));
    if (!orderNbr) continue;

    // 1) summary (LocationID + JobName already supported)
    const requestedOn = firstVal(r, ["RequestedOn", "requestedOn"]);
    const deliveryDate = requestedOn ? new Date(requestedOn) : null;

    // NEW: map noteId + buyerGroup
    const noteId = optStr(firstVal(r, ["NoteID", "noteId", "NOTEID"]));
    const buyerGroup = optStr(firstVal(r, [
      "custom.Document.AttributeBUYERGROUP",
      "Document.AttributeBUYERGROUP",
      "buyerGroup",
      "BuyerGroup",
      "BUYERGROUP",
    ]));

    const summary = await prisma.erpOrderSummary.upsert({
      where: { baid_orderNbr: { baid, orderNbr } },
      create: {
        baid,
        customerName: optStr(firstVal(r, ["CustomerID", "customerId"])) || "",
        orderNbr,
        locationId: optStr(firstVal(r, ["LocationID", "locationId"])) || null,
        jobName: optStr(firstVal(r, ["JobName", "jobName"])) || null,
        status: optStr(firstVal(r, ["Status", "status"])) || "",
        deliveryDate,
        shipVia: optStr(firstVal(r, ["ShipVia", "shipVia"])) || null,
        // NEW
        buyerGroup: buyerGroup ?? "",
        noteId: noteId ?? null,
        lastSeenAt: new Date(),
        isActive: true,
      },
      update: {
        status: optStr(firstVal(r, ["Status", "status"])) || "",
        deliveryDate,
        shipVia: optStr(firstVal(r, ["ShipVia", "shipVia"])) || null,
        // NEW
        buyerGroup: buyerGroup ?? "",
        noteId: noteId ?? null,
        lastSeenAt: new Date(),
        isActive: true,
      },
      select: { id: true }
    });
    summaries++;

    // 2) address (Country fetched but not stored; schema has no country column)
    const addressPayload = {
      addressLine1: optStr(firstVal(r, ["AddressLine1", "addressLine1"])),
      addressLine2: optStr(firstVal(r, ["AddressLine2", "addressLine2"])),
      city: optStr(firstVal(r, ["City", "city"])),
      state: optStr(firstVal(r, ["State", "state"])),
      postalCode: optStr(firstVal(r, ["PostalCode", "postalCode"])),
    };

    if (Object.values(addressPayload).some(v => v !== null)) {
      await prisma.erpOrderAddress.upsert({
        where: { orderSummaryId: summary.id },
        create: {
          orderSummaryId: summary.id,
          baid,
          orderNbr,
          ...addressPayload,
        },
        update: {
          ...addressPayload,
        }
      });
      addresses++;
    }

    // 3) contact (DeliveryEmail + custom attrs) — robust like your ingest route
    const toBool = (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === "boolean") return v;
      const s = String(v).trim().toLowerCase();
      if (["true", "t", "yes", "y", "1"].includes(s)) return true;
      if (["false", "f", "no", "n", "0"].includes(s)) return false;
      // Acumatica sometimes returns empty string for unchecked
      if (s === "") return false;
      return null;
    };

    const contactPayload = {
      deliveryEmail: optStr(firstVal(r, ["DeliveryEmail", "deliveryEmail"])),
      siteNumber: optStr(firstVal(r, [
        "custom.Document.AttributeSITENUMBER",
        "Document.AttributeSITENUMBER",
        "siteNumber",
        "SiteNumber",
      ])),
      osContact: optStr(firstVal(r, [
        "custom.Document.AttributeOSCONTACT",
        "Document.AttributeOSCONTACT",
        "osContact",
        "OsContact",
        "OSCONTACT",
      ])),
      confirmedVia: optStr(firstVal(r, [
        "custom.Document.AttributeCONFIRMVIA",
        "Document.AttributeCONFIRMVIA",
        "confirmVia",
        "CONFIRMVIA",
      ])),
      confirmedWith: optStr(firstVal(r, [
        "custom.Document.AttributeCONFIRMWTH",
        "Document.AttributeCONFIRMWTH",
        "confirmWith",
        "CONFIRMWITH",
      ])),
      threeDaySent: toBool(firstVal(r, [
        "custom.Document.AttributeTHREEDAYSENT",
        "Document.AttributeTHREEDAYSENT",
        "custom.Document.AttributeTHREEDAY",
        "Document.AttributeTHREEDAY",
        "threeDay",
        "ThreeDay",
        "THREEDAY",
      ])),
      tenDaySent: toBool(firstVal(r, [
        "custom.Document.AttributeTENDAYSENT",
        "Document.AttributeTENDAYSENT",
        "custom.Document.AttributeTWOWEEK",
        "Document.AttributeTWOWEEK",
        "twoWeek",
        "TwoWeek",
        "TWOWEEK",
      ])),
      sixWeekFailed: toBool(firstVal(r, [
        "custom.Document.AttributeSIXWEEKFF",
        "Document.AttributeSIXWEEKFF",
        "sixWeek",
        "SixWeek",
        "SIXWEEK",
      ])),
    };

    if (Object.values(contactPayload).some(v => v !== null)) {
      await prisma.erpOrderContact.upsert({
        where: { orderSummaryId: summary.id },
        create: {
          orderSummaryId: summary.id,
          baid,
          orderNbr,
          ...contactPayload,
        },
        update: {
          ...contactPayload,
        }
      });
      contacts++;
    }

    // 4) payment (map Terms now)
    const paymentPayload = {
      orderTotal: firstVal(r, ["OrderTotal", "orderTotal"]),
      unpaidBalance: firstVal(r, ["UnpaidBalance", "unpaidBalance"]),
      terms: optStr(firstVal(r, ["Terms", "terms"])) || "",
    };

    await prisma.erpOrderPayment.upsert({
      where: { orderSummaryId: summary.id },
      create: {
        orderSummaryId: summary.id,
        baid,
        orderNbr,
        ...paymentPayload,
      },
      update: {
        ...paymentPayload,
      }
    });
    payments++;
  }

  return { db: { summaries, addresses, contacts, payments } };
}

/* ----------------- helpers ----------------- */
function val(obj, key) {
  const v = obj?.[key];
  if (v && typeof v === "object" && "value" in v) return v.value;
  return v;
}
function getPath(obj, dotted) {
  // supports dotted paths like "custom.Document.AttributeSITENUMBER"
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
    const v = k && k.includes(".") ? getPath(obj, k) : val(obj, k);
    if (v != null) return v;
  }
  return null;
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
