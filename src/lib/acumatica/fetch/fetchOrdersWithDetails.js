// src/lib/acumatica/fetch/fetchOrdersWithDetails.js
import { oneYearAgoDenver, toDenverDateTimeOffsetLiteral } from "@/lib/time/denver";
import https from "node:https";

/**
 * Batched SalesOrder fetch (summaries + Details) with:
 *  - 1-year RequestedOn window
 *  - optional incremental window via LastModifiedDateTime >= since (fallback-safe)
 *  - sequential paging with $top / $skip
 *  - HTTPS keep-alive
 */
export default async function fetchOrdersWithDetails(
  restService,
  baid,
  {
    pageSize: pageSizeArg,
    maxPages: maxPagesArg,
    since = null,        // Date | string | null
    useOrderBy = false,  // off by default (can be slow)
  } = {}
) {
  const token = await restService.getToken();

  // Paging controls (env overrides)
  const envPage = Number(process.env.ACU_PAGE_SIZE || "");
  const pageSize = Number.isFinite(envPage) && envPage > 0 ? envPage : (pageSizeArg || 250);
  const envMax = Number(process.env.ACU_MAX_PAGES || "");
  const maxPages = Number.isFinite(envMax) && envMax > 0 ? envMax : (maxPagesArg || 50);

  const cutoffDenver = oneYearAgoDenver(new Date());
  const cutoffLiteral = toDenverDateTimeOffsetLiteral(cutoffDenver);
  const sinceLiteral = since ? toDenverDateTimeOffsetLiteral(new Date(since)) : null;

  const base = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001/SalesOrder`;
  const custom = "Document.AttributeSITENUMBER,Document.AttributeOSCONTACT";
  const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });

  // Build one page request; select is computed based on useSince
  const fetchPage = async (useSince, page) => {
    const selectFields = [
      "OrderNbr","Status","LocationID","RequestedOn","Terms","OrderTotal","UnpaidBalance",
      "ShipVia","AddressLine1","AddressLine2","City","State","PostalCode","JobName","DeliveryEmail",
      "Details/LineDescription","Details/InventoryID","Details/LineType","Details/OpenQty","Details/UnitPrice","Details/UsrETA",
    ];
    if (useSince && sinceLiteral) {
      // only expose when we actually use it in filter
      selectFields.push("LastModifiedDateTime");
    }

    const filterParts = [
      `CustomerID eq '${baid}'`,
      `RequestedOn ge ${cutoffLiteral}`,
      `Status ne 'Canceled'`,
      `Status ne 'On Hold'`,
    ];
    if (useSince && sinceLiteral) {
      filterParts.push(`LastModifiedDateTime ge ${sinceLiteral}`);
    }

    const params = new URLSearchParams();
    params.set("$filter", filterParts.join(" and "));
    params.set("$select", selectFields.join(","));
    params.set("$custom", custom);
    if (useOrderBy) params.set("$orderby", "RequestedOn desc");
    params.set("$top", String(pageSize));
    params.set("$skip", String(page * pageSize));
    params.set("$expand", "Details");

    const url = `${base}?${params.toString()}`;
    const t0 = Date.now();
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      agent,
    });
    const dt = Date.now() - t0;

    const bodyText = await resp.text();
    let json;
    try { json = bodyText ? JSON.parse(bodyText) : []; } catch { json = []; }
    return { ok: resp.ok, status: resp.status, bodyText, json, ms: dt };
  };

  const all = [];
  let useSince = !!sinceLiteral;
  let pages = 0;

  for (let page = 0; page < maxPages; page++) {
    let res = await fetchPage(useSince, page);

    // If server rejects LastModifiedDateTime (in $filter or $select), retry page w/out it and disable thereafter
    if (
      !res.ok &&
      useSince &&
      (
        res.status === 400 ||
        /LastModifiedDateTime|KeyNotFound|ODataException|not present in the dictionary/i.test(res.bodyText || "")
      )
    ) {
      useSince = false;
      res = await fetchPage(false, page);
    }

    if (!res.ok) {
      throw new Error(res.bodyText || `ERP error for ${baid}`);
    }

    const arr = Array.isArray(res.json) ? res.json : [];
    all.push(...arr);
    pages += 1;

    const truncated = arr.length === pageSize;
    console.log(
      `[fetchOrdersWithDetails] baid=${baid} page=${page} size=${pageSize} rows=${arr.length} ` +
      `ms=${res.ms} truncated=${truncated}`
    );

    // Stop when this page returned less than pageSize (last page)
    if (arr.length < pageSize) break;
  }

  console.log(
    `[fetchOrdersWithDetails] baid=${baid} DONE pages=${pages} pageSize=${pageSize} totalRows=${all.length}`
  );

  return all;
}

export { fetchOrdersWithDetails };
