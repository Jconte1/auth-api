// src/lib/acumatica/fetch/fetchOrderSummaries.js
import https from "node:https";
import { oneYearAgoDenver, toDenverDateTimeOffsetLiteral } from "@/lib/time/denver";

/**
 * Fetch order summaries for a BAID with plain $top/$skip paging.
 * No $expand=Details here — keep it fast.
 */
export default async function fetchOrderSummaries(
  restService,
  baid,
  {
    pageSize: pageSizeArg,
    maxPages: maxPagesArg,
    useOrderBy = false, // avoid unless you need deterministic scans
  } = {}
) {
  const token = await restService.getToken();

  // Paging from env with sane defaults
  const envPage = Number(process.env.ACU_PAGE_SIZE || "");
  const pageSize = Number.isFinite(envPage) && envPage > 0 ? envPage : (pageSizeArg || 250);
  const envMax = Number(process.env.ACU_MAX_PAGES || "");
  const maxPages = Number.isFinite(envMax) && envMax > 0 ? envMax : (maxPagesArg || 50);

  const cutoffDenver = oneYearAgoDenver(new Date());
  const cutoffLiteral = toDenverDateTimeOffsetLiteral(cutoffDenver);

  const base = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001/SalesOrder`;
  const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });

  // TODO
// ADD 6 WEEK CONFIRM AND 2 WEEK CONFIRM BOOLEAN 

  const select = [
    "OrderNbr",
    "Status",
    "LocationID",
    "RequestedOn",
    "ShipVia",
    "JobName",
    "CustomerName",
  ].join(",");

  const custom = "Document.AttributeBUYERGROUP";

  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams();
    params.set(
      "$filter",
      [
        `CustomerID eq '${baid}'`,
        `RequestedOn ge ${cutoffLiteral}`,
        `Status ne 'Canceled'`,
        `Status ne 'On Hold'`,
        `Status ne 'Pending Approval'`,
        `Status ne 'Rejected'`,
        `Status ne 'Pending Processing'`,
        `Status ne 'Awaiting Payment'`,
        `Status ne 'Credit Hold'`,
        `Status ne 'Completed'`,
        `Status ne 'Invoiced'`,
        `Status ne 'Expired'`,
        `Status ne 'Purchase Hold'`,
        `Status ne 'Not Approved'`,
        `Status ne 'Risk Hold'`,
      ].join(" and ")
    );
    params.set("$select", select);
    params.set("$custom", custom);
    
    if (useOrderBy) params.set("$orderby", "RequestedOn desc");
    params.set("$top", String(pageSize));
    params.set("$skip", String(page * pageSize));

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
    const ms = Date.now() - t0;

    const text = await resp.text();
    
    if (!resp.ok) throw new Error(text || `ERP error for ${baid}`);
    const arr = text ? JSON.parse(text) : [];
    const rows = Array.isArray(arr) ? arr : [];

    all.push(...rows);
    console.log(
      `[fetchOrderSummaries] baid=${baid} page=${page} size=${pageSize} rows=${rows.length} ms=${ms} truncated=${rows.length === pageSize}`
    );
    if (rows.length < pageSize) break; 
  }

  console.log(`[fetchOrderSummaries] baid=${baid} totalRows=${all.length}`);
  return all;
}
