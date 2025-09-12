// src/lib/acumatica/fetchOrders.js
export default async function fetchOrders(restService, baid) {
  const token = await restService.getToken();
  const url =
    `${restService.baseUrl}` +
    `/entity/CustomEndpoint/24.200.001//SalesOrder` +
    `?$filter=CustomerID eq '${baid}'` +
    `&$select=OrderNbr,Status,LocationID,RequestedOn`;

  const resp = await fetch(encodeURI(url), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  const raw = await resp.text();
  if (!resp.ok) throw new Error(raw || `ERP error for ${baid}`);

  const parsed = raw ? JSON.parse(raw) : [];
  return Array.isArray(parsed) ? parsed : [];
}
