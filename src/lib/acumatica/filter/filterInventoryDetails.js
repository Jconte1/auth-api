// src/lib/acumatica/filter/filterInventoryDetails.js

// Safe extractor for Acumatica fields that may be raw or { value }
function get(obj, key) {
  const v = obj?.[key];
  if (v == null) return null;
  if (typeof v === "object" && "value" in v) return v.value ?? null;
  return v;
}

function toStr(v) {
  if (v == null) return null;
  return String(v);
}

// Keep decimals as strings for Prisma Decimal compatibility
function toDecStr(v) {
  if (v == null) return null;
  return typeof v === "string" ? v : String(v);
}

function toIsoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Normalize expanded SalesOrder -> Details[] response(s) into flat line DTOs.
 *
 * Input shape (each element typically has):
 * {
 *   OrderNbr: "C104750" | { value: "C104750" },
 *   Details: [
 *     {
 *       LineDescription, InventoryID, LineType, OpenQty, UnitPrice, UsrETA
 *     },
 *     ...
 *   ]
 * }
 *
 * Output:
 * {
 *   lines: Array<{
 *     orderNbr: string,
 *     lineIndex: number,                // 0-based per-order index (stable within a run)
 *     lineDescription: string|null,
 *     inventoryId: string|null,
 *     lineType: string|null,
 *     openQty: string|null,             // decimal as string
 *     unitPrice: string|null,           // decimal as string
 *     usrETA: string|null               // ISO datetime
 *   }>,
 *   counts: {
 *     ordersScanned: number,
 *     ordersWithoutNbr: number,
 *     ordersWithNoDetails: number,
 *     linesKept: number,
 *     linesDroppedEmpty: number
 *   }
 * }
 */
export default function filterInventoryDetails(rawOrders) {
  const lines = [];
  let ordersScanned = 0;
  let ordersWithoutNbr = 0;
  let ordersWithNoDetails = 0;
  let linesDroppedEmpty = 0;

  const rows = Array.isArray(rawOrders) ? rawOrders : (rawOrders ? [rawOrders] : []);
  for (const row of rows) {
    ordersScanned += 1;

    const orderNbr = toStr(get(row, "OrderNbr"));
    if (!orderNbr) {
      ordersWithoutNbr += 1;
      continue;
    }

    const details = Array.isArray(row?.Details) ? row.Details : [];
    if (details.length === 0) {
      ordersWithNoDetails += 1;
      continue;
    }

    let lineIndex = 0;
    for (const d of details) {
      // Pull each field with null-guards
      const lineDescription = toStr(get(d, "LineDescription"));
      const inventoryId     = toStr(get(d, "InventoryID"));
      const lineType        = toStr(get(d, "LineType"));
      const openQty         = toDecStr(get(d, "OpenQty"));
      const unitPrice       = toDecStr(get(d, "UnitPrice"));
      const usrETA          = toIsoOrNull(get(d, "UsrETA"));

      // If the line is completely empty, skip it
      const allEmpty =
        lineDescription == null &&
        inventoryId == null &&
        lineType == null &&
        openQty == null &&
        unitPrice == null &&
        usrETA == null;

      if (allEmpty) {
        linesDroppedEmpty += 1;
        continue;
      }

      lines.push({
        orderNbr,
        lineIndex: lineIndex++,
        lineDescription,
        inventoryId,
        lineType,
        openQty,
        unitPrice,
        usrETA,
      });
    }
  }

  return {
    lines,
    counts: {
      ordersScanned,
      ordersWithoutNbr,
      ordersWithNoDetails,
      linesKept: lines.length,
      linesDroppedEmpty,
    },
  };
}
