import https from "node:https";

/**
 * Fetch slim SalesOrder rows for a BAID since a given datetimeoffset literal,
 * returning exactly the fields you asked for (plus the two $custom attributes).
 */
export default async function fetchDailySync(
    restService,
    baid,
    { sinceLiteral, pageSize = 500 } = {}
) {
    const token = await restService.getToken();
    const base = `${restService.baseUrl}/entity/CustomEndpoint/24.200.001/SalesOrder`;
    const agent = new https.Agent({ keepAlive: true, maxSockets: 8 });

    const select = [
        "OrderType", "OrderNbr", "CustomerID", "LastModified",
        "UnpaidBalance", "OrderTotal", "RequestedOn", "ShipVia", "Status",
        "DeliveryEmail", "AddressLine1", "AddressLine2", "City", "Country", "PostalCode", "State",
        "LocationID", "JobName", "Terms", "NoteID"
    ].join(",");

   const custom = "Document.AttributeSITENUMBER, Document.AttributeOSCONTACT, Document.AttributeTHREEDAY, Document.AttributeTWOWEEK, Document.AttributeSIXWEEKFF, Document.AttributeCONFIRMVIA, Document.AttributeCONFIRMWTH,Document.AttributeBUYERGROUP";

    const baidLit = String(baid).replace(/'/g, "''");
    const filter = [
        `CustomerID eq '${baidLit}'`,
        `LastModified ge datetimeoffset'${sinceLiteral.replace(/^datetimeoffset'|'+$/g, "")}'`
    ].join(" and ");

    const all = [];
    let skip = 0;

    while (true) {
        const params = new URLSearchParams();
        params.set("$filter", filter);
        params.set("$select", select);
        params.set("$custom", custom);
        params.set("$top", String(pageSize));
        params.set("$skip", String(skip));

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
        if (!resp.ok) {
            console.error(`[fetchDailySync] baid=${baid} ERROR status=${resp.status} body=${text?.slice(0, 500)}`);
            throw new Error(text || `ERP error fetching daily sync for baid=${baid}`);
        }

        const arr = text ? JSON.parse(text) : [];
        const rows = Array.isArray(arr) ? arr : [];
        // inside the while(true) loop, after `const rows = Array.isArray(arr) ? arr : [];`
        const orderNbrs = rows.map(r => r?.OrderNbr?.value).filter(Boolean);
        console.log(`[fetchDailySync] page rows=${rows.length} orderNbrs=${JSON.stringify(orderNbrs)}`);
        all.push(...rows);

        // after the loop, just before `return all;`
        console.log(`[fetchDailySync] total rows=${all.length} allOrderNbrs=${JSON.stringify(all.map(r => r?.OrderNbr?.value).filter(Boolean))}`);

        all.push(...rows);

        if (rows.length < pageSize) break;
        skip += pageSize;
    }

    return all;
}
