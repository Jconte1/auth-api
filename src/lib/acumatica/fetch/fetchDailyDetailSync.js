import https from "node:https";

export default async function fetchDailyDetailSync(
  restService,
  baid,
  orderNbrs,
  { batchSize = 16, pageTop = 500 } = {}
) {
  if (!Array.isArray(orderNbrs) || orderNbrs.length === 0) return [];

  const token = await restService.getToken();
  const base = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001/SalesOrder`;
  const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });

  const select = [
    "OrderNbr",
    "Details/InventoryID",
    "Details/LineDescription",
    "Details/LineType",
    "Details/UnitPrice",
    "Details/OpenQty",
    "Details/UsrETA",
    "Details/Here",
    "Details/WarehouseID",
  ].join(",");

  const blockedStatuses = [
    "Canceled","Cancelled","On Hold","Pending Approval","Rejected",
    "Pending Processing","Awaiting Payment","Credit Hold","Completed",
    "Invoiced","Expired","Purchase Hold","Not Approved","Risk Hold"
  ];

  const chunks = [];
  for (let i = 0; i < orderNbrs.length; i += batchSize) {
    chunks.push(orderNbrs.slice(i, i + batchSize));
  }

  const all = [];
  for (const batch of chunks) {
    const ors = batch
      .map(n => String(n).replace(/'/g, "''"))
      .map(n => `OrderNbr eq '${n}'`)
      .join(" or ");

    const statusClauses = blockedStatuses.map(s => `Status ne '${s.replace(/'/g, "''")}'`);
    statusClauses.push(`Status ne ''`);

    const filter = [
      `CustomerID eq '${String(baid).replace(/'/g, "''")}'`,
      `(${ors})`,
      ...statusClauses,
    ].join(" and ");

    const params = new URLSearchParams();
    params.set("$filter", filter);
    params.set("$select", select);
    params.set("$expand", "Details");
    params.set("$top", String(pageTop));

    const url = `${base}?${params.toString()}`;
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      agent,
    });

    const text = await resp.text();
    if (!resp.ok) throw new Error(text || `ERP error fetching details for ${baid}`);

    let rows = [];
    try { rows = text ? JSON.parse(text) : []; } catch { rows = []; }
    if (Array.isArray(rows) && rows.length) all.push(...rows);
  }

  return all;
}
