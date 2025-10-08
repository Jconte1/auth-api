import prisma from "@/lib/prisma/prisma";

export default async function writeDailyDetailSync(baid, detailRows) {
  const affected = new Set();
  const lines = [];

  for (const row of Array.isArray(detailRows) ? detailRows : []) {
    const orderNbr = getVal(row, "OrderNbr");
    if (!orderNbr) continue;
    affected.add(orderNbr);

    const details = Array.isArray(row?.Details) ? row.Details : [];
    for (const d of details) {
      const lt = (getVal(d, "LineType") || "").toString().trim().toLowerCase();
      if (lt !== "goods for inventory") continue;

      lines.push({
        baid,
        orderNbr,
        lineDescription: optStr(getVal(d, "LineDescription")),
        warehouse: optStr(getVal(d, "WarehouseID")),
        inventoryId: optStr(getVal(d, "InventoryID")),
        lineType: optStr(getVal(d, "LineType")),
        openQty: optDec(getVal(d, "OpenQty"), 4),
        unitPrice: optDec(getVal(d, "UnitPrice"), 2),
        usrETA: toDate(getVal(d, "UsrETA")),
        here: optStr(getVal(d, "Here")),
      });
    }
  }

  const orderNbrs = Array.from(affected);
  if (!orderNbrs.length) return { ordersAffected: 0, linesInserted: 0, linesDeleted: 0 };

  // link orderSummaryId
  const summaries = await prisma.erpOrderSummary.findMany({
    where: { baid, orderNbr: { in: orderNbrs } },
    select: { id: true, orderNbr: true },
  });
  const idByNbr = new Map(summaries.map(s => [s.orderNbr, s.id]));

  // wipe old
  const { count: linesDeleted } = await prisma.erpOrderLine.deleteMany({
    where: { baid, orderNbr: { in: orderNbrs } },
  });

  // insert fresh
  const data = lines
    .map(l => {
      const orderSummaryId = idByNbr.get(l.orderNbr);
      if (!orderSummaryId) return null;
      return { orderSummaryId, ...l };
    })
    .filter(Boolean);

  let linesInserted = 0;
  if (data.length) {
    const res = await prisma.erpOrderLine.createMany({ data, skipDuplicates: true });
    linesInserted = res.count;
  }

  return { ordersAffected: orderNbrs.length, linesInserted, linesDeleted };
}

/* helpers */
function getVal(obj, key) {
  const v = obj?.[key];
  if (v && typeof v === "object" && "value" in v) return v.value;
  return v ?? null;
}
function optStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function optDec(v, scale = 2) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Number(n.toFixed(scale));
}
function toDate(v) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(+d) ? d : null;
}
