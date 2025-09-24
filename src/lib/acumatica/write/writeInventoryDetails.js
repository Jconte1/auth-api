import prisma from "@/lib/prisma/prisma";

/**
 * Bulk reconcile ErpOrderLine for a BAID from inventory detail payload (with Details[]).
 */
export default async function writeInventoryDetails(
  baid,
  detailRows,
  { chunkSize = 5000 } = {}
) {
  const lines = [];
  const affectedNbrs = new Set();

  for (const row of Array.isArray(detailRows) ? detailRows : []) {
    const orderNbr = str(val(row, "OrderNbr"));
    if (!orderNbr) continue;
    affectedNbrs.add(orderNbr);

    const details = Array.isArray(row?.Details) ? row.Details : [];
    for (const d of details) {
      const lt = optStr(val(d, "LineType"));
      if (!lt || lt.trim().toLowerCase() !== "goods for inventory") continue;
      lines.push({
        orderNbr,
        baid,
        lineDescription: optStr(val(d, "LineDescription")),
        warehouse: optStr(val(d, "WarehouseID")),
        inventoryId: optStr(val(d, "InventoryID")),
        lineType: optStr(val(d, "LineType")),
        openQty: optDec(val(d, "OpenQty"), 4),
        unitPrice: optDec(val(d, "UnitPrice"), 2),
        usrETA: toDate(val(d, "UsrETA")),
        here: optStr(val(d, "Here")),
      });
    }
  }

  const orderNbrList = Array.from(affectedNbrs);
  if (!orderNbrList.length) {
    return {
      ordersConsidered: Array.isArray(detailRows) ? detailRows.length : 0,
      ordersAffected: 0,
      linesKept: 0,
      linesDeleted: 0,
      linesInserted: 0,
      scan: {
        ordersScanned: Array.isArray(detailRows) ? detailRows.length : 0,
        ordersWithoutNbr: 0,
        ordersWithNoDetails: 0,
        linesKept: 0,
        linesDroppedEmpty: 0,
      },
    };
  }

  const summaries = await prisma.erpOrderSummary.findMany({
    where: { baid, orderNbr: { in: orderNbrList } },
    select: { id: true, orderNbr: true },
  });
  const idByNbr = new Map(summaries.map(s => [s.orderNbr, s.id]));

  const { count: deleted } = await prisma.erpOrderLine.deleteMany({
    where: { baid, orderNbr: { in: orderNbrList } },
  });

  let inserted = 0;
  if (lines.length) {
    const mapped = lines
      .map((l) => {
        const orderSummaryId = idByNbr.get(l.orderNbr);
        if (!orderSummaryId) return null;
        return {
          orderSummaryId,
          baid: l.baid,
          orderNbr: l.orderNbr,
          lineDescription: l.lineDescription,
          warehouse: l.warehouse,
          inventoryId: l.inventoryId,
          lineType: l.lineType,
          openQty: l.openQty,
          unitPrice: l.unitPrice,
          usrETA: l.usrETA,
          here: l.here,                        
        };
      })
      .filter(Boolean);


    for (let i = 0; i < mapped.length; i += chunkSize) {
      const slice = mapped.slice(i, i + chunkSize);
      if (!slice.length) continue;
      const { count } = await prisma.erpOrderLine.createMany({
        data: slice,
        skipDuplicates: true,
      });
      inserted += count;
    }
  }

  return {
    ordersConsidered: Array.isArray(detailRows) ? detailRows.length : 0,
    ordersAffected: orderNbrList.length,
    linesKept: lines.length,
    linesDeleted: deleted,
    linesInserted: inserted,
    scan: {
      ordersScanned: Array.isArray(detailRows) ? detailRows.length : 0,
      ordersWithoutNbr: 0,
      ordersWithNoDetails: 0,
      linesKept: lines.length,
      linesDroppedEmpty: 0,
    },
  };
}

/* ----------------- helpers ----------------- */
function val(obj, key) {
  const v = obj?.[key];
  if (v && typeof v === "object" && "value" in v) return v.value;
  return v;
}
function toDate(v) {
  const d = v ? new Date(v) : null;
  return d && !isNaN(+d) ? d : null;
}
function str(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
function optStr(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  if (typeof v === "object") return null; // ← prevents "[object Object]"
  const s = String(v).trim();
  return s ? s : null;
}
function optDec(v, scale = 2) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  return Number(n.toFixed(scale));
}
