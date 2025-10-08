import prisma from "@/lib/prisma/prisma";

/**
 * Upsert into 4 tables: ErpOrderSummary, ErpOrderAddress, ErpOrderContact, ErpOrderPayment.
 * Assumes each ERP row is HEADER-LEVEL (one per order).
 */
export default async function writeDailySync(baid, rows) {
  let summaries = 0, addresses = 0, contacts = 0, payments = 0;

  for (const r of rows) {
    const get = k => r?.[k]?.value ?? null;

    const orderNbr = get("OrderNbr");
    if (!orderNbr) continue;

    // 1) summary (LocationID + JobName already supported)
    const summary = await prisma.erpOrderSummary.upsert({
      where: { baid_orderNbr: { baid, orderNbr } },
      create: {
        baid,
        customerName: get("CustomerID") || "", // using CustomerID since CustomerName not in select
        orderNbr,
        locationId: get("LocationID") || null,
        jobName: get("JobName") || null,
        status: get("Status") || "",
        deliveryDate: get("RequestedOn") ? new Date(get("RequestedOn")) : null,
        shipVia: get("ShipVia") || null,
        lastSeenAt: new Date(),
        isActive: true,
      },
      update: {
        status: get("Status") || "",
        deliveryDate: get("RequestedOn") ? new Date(get("RequestedOn")) : null,
        shipVia: get("ShipVia") || null,
        lastSeenAt: new Date(),
        isActive: true,
      },
      select: { id: true }
    });
    summaries++;

    // 2) address (Country fetched but not stored; schema has no country column)
    await prisma.erpOrderAddress.upsert({
      where: { orderSummaryId: summary.id },
      create: {
        orderSummaryId: summary.id,
        baid, orderNbr,
        addressLine1: get("AddressLine1"),
        addressLine2: get("AddressLine2"),
        city: get("City"),
        state: get("State"),
        postalCode: get("PostalCode"),
      },
      update: {
        addressLine1: get("AddressLine1"),
        addressLine2: get("AddressLine2"),
        city: get("City"),
        state: get("State"),
        postalCode: get("PostalCode"),
      }
    });
    addresses++;

    // 3) contact (DeliveryEmail + custom attrs)
    const siteNumber = r?.custom?.Document_AttributeSITENUMBER ?? null;
    const osContact  = r?.custom?.Document_AttributeOSCONTACT ?? null;

    await prisma.erpOrderContact.upsert({
      where: { orderSummaryId: summary.id },
      create: {
        orderSummaryId: summary.id,
        baid, orderNbr,
        deliveryEmail: get("DeliveryEmail"),
        siteNumber,
        osContact,
      },
      update: {
        deliveryEmail: get("DeliveryEmail"),
        siteNumber,
        osContact,
      }
    });
    contacts++;

    // 4) payment (map Terms now)
    await prisma.erpOrderPayment.upsert({
      where: { orderSummaryId: summary.id },
      create: {
        orderSummaryId: summary.id,
        baid, orderNbr,
        orderTotal: get("OrderTotal"),
        unpaidBalance: get("UnpaidBalance"),
        terms: get("Terms") || "",
      },
      update: {
        orderTotal: get("OrderTotal"),
        unpaidBalance: get("UnpaidBalance"),
        terms: get("Terms") || "",
      }
    });
    payments++;
  }

  return { db: { summaries, addresses, contacts, payments } };
}
