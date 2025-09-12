// src/lib/acumatica/fetchOrders.js
import { oneYearAgoDenver, toDenverDateTimeOffsetLiteral } from "@/lib/time/denver";

export default async function fetchOrders(restService, baid) {
    const token = await restService.getToken();

    // Denver cutoff literal, e.g. datetimeoffset'2024-09-12T00:00:00-06:00'
    const cutoffDenver = oneYearAgoDenver(new Date());
    const cutoffLiteral = toDenverDateTimeOffsetLiteral(cutoffDenver);

    const params = new URLSearchParams();
    params.set(
        "$filter",
        `CustomerID eq '${baid}' and RequestedOn ge ${cutoffLiteral} and ` +
        `Status ne 'Canceled' and Status ne 'On Hold'`
    );
    params.set("$select", "OrderNbr,Status,LocationID,RequestedOn");

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
    if (!resp.ok) throw new Error(raw || `ERP error for ${baid}`);

    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
}
