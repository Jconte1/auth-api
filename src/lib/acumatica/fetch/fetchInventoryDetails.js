// src/lib/acumatica/fetchInventoryOrders.js

export default async function fetchInventoryOrders(restService, orderNbr) {
    const token = await restService.getToken();

    const params = new URLSearchParams();
    params.set(
        "$filter",
        `OrderNbr eq '${orderNbr}' ` 
    );
    params.set("$select", "OrderNbr,Details/LineDescription,Details/InventoryID,Details/LineType,Details/OpenQty,Details/UnitPrice,Details/UsrETA");
    params.set("$expand", "Details");
    const url = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001//SalesOrder?${params.toString()}`;

    const resp = await fetch(url, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
        },
    });

    const raw = await resp.text();
    if (!resp.ok) throw new Error(raw || `ERP error for ${orderNbr}`);

    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
}
