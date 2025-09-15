// src/lib/acumatica/filterInventoryDetails.js
import { oneYearAgoDenver } from "@/lib/time/denver";

export default function shapeAndFilter(rawRows) {
    const cutoff = oneYearAgoDenver(new Date());

    const normalized = [];
    let droppedMissing = 0;
    let droppedExcluded = 0;
    for (const row of rawRows) {
        const orderNbr = row?.OrderNbr?.value ?? row?.OrderNbr ?? null;
        const status = row?.Status?.value ?? row?.Status ?? null;
        const locationId = row?.LocationID?.value ?? row?.LocationID ?? null;
        const requestedOnRaw = row?.RequestedOn?.value ?? row?.RequestedOn ?? null;

        if (!orderNbr || !status || !locationId || !requestedOnRaw) {
            droppedMissing++; continue;
        }
        if (String(orderNbr).startsWith("QT")) { droppedExcluded++; continue; }
        const requestedOn = new Date(requestedOnRaw);
        if (Number.isNaN(requestedOn.getTime())) { droppedMissing++; continue; }

        normalized.push({
            orderNbr: String(orderNbr),
            status: String(status),
            locationId: String(locationId),
            requestedOn: requestedOn.toISOString(),
        });
    }

    // 1-year window
    const cutoffISO = cutoff.toISOString();
    const withinWindow = [];
    let droppedOld = 0;

    for (const item of normalized) {
        if (item.requestedOn >= cutoffISO) withinWindow.push(item);
        else droppedOld++;
    }

    // dedupe by orderNbr (keep most recent requestedOn)
    const byNbr = new Map();
    for (const item of withinWindow) {
        const prev = byNbr.get(item.orderNbr);
        if (!prev || item.requestedOn > prev.requestedOn) byNbr.set(item.orderNbr, item);
    }
    const deduped = Array.from(byNbr.values());

    return {
        kept: deduped,
        counts: {
            totalFromERP: rawRows.length,
            droppedMissing,
            droppedExcluded,
            droppedOld,
            kept: deduped.length,
        },
        cutoff,
    };
}
