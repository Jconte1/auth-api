// src/lib/notifications/t3/run.js
import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver } from '@/lib/time/denver';
import { sendT3Email } from '@/lib/email/mailer';
import { writeT3 } from '@/lib/acumatica/confirmations';

function daysUntilDenver(targetDate, now = new Date()) {
    if (!targetDate) return null;
    const t0 = startOfDayDenver(targetDate);
    const n0 = startOfDayDenver(now);
    return Math.round((t0.getTime() - n0.getTime()) / (24 * 60 * 60 * 1000));
}

function orderTypeFromNbr(orderNbr = '') {
    // Grab the first two Characters at the start of the string, e.g. "SO12345" → "SO"
    const m = String(orderNbr).match(/^[A-Za-z0-9]{2}/);
    return m ? m[0].toUpperCase() : null;
}

export async function runT3({ now = new Date() } = {}) {
    const todayDenver = startOfDayDenver(now);

    const orders = await prisma.erpOrderSummary.findMany({
        where: { isActive: true, deliveryDate: { gte: todayDenver } },
        include: { contact: true },
    });

    let sent = 0;
    let resetFlags = 0;
    let skippedNoEmail = 0;
    let skippedOutOfWindow = 0;
    let alreadySent = 0;
    let errors = 0;

    // NEW: ERP write counters
    let erpWrites = 0;
    let erpWriteErrors = 0;

    for (const o of orders) {
        const daysOut = daysUntilDenver(o.deliveryDate, now);
        const threeDaySent = o?.contact?.threeDaySent === true;
        const to = o?.contact?.deliveryEmail?.trim() || '';

        console.log('[T3][inspect]', o.orderNbr, {
            todayDenver: todayDenver.toISOString(),
            rawDelivery: o.deliveryDate,
            deliveryDenver: startOfDayDenver(o.deliveryDate).toISOString(),
            daysOut,
            threeDaySent,
            hasEmail: !!to,
        });

        // If we somehow can't compute a day span, skip
        if (daysOut == null) { skippedOutOfWindow++; continue; }

        // Reset rule: pushed back out beyond 3 days after being marked sent
        if (daysOut > 3 && threeDaySent) {
            await prisma.erpOrderContact.update({
                where: { orderSummaryId: o.id },
                data: { threeDaySent: false },
            });
            resetFlags++;
            continue;
        }

        // Send rule: within [2..4] days (your chosen buffer), not already sent
        if (daysOut >= 2 && daysOut <= 4 && !threeDaySent) {
            if (!to) { skippedNoEmail++; continue; }
            try {
                // 1) Send email
                const info = await sendT3Email({
                    to,
                    orderNbr: o.orderNbr,
                    customerName: o.customerName || '',
                    deliveryDate: o.deliveryDate,
                });

                // 2) Mark local contact flag
                await prisma.erpOrderContact.update({
                    where: { orderSummaryId: o.id },
                    data: { threeDaySent: true },
                });

                // 3) Tell ERP (library call). Keep isolated so ERP write failures don't undo email/flag.
                try {
                    const orderType = orderTypeFromNbr(o.orderNbr);
                    if (!orderType) {
                        erpWriteErrors++;
                        console.error('[T3][ERP write skipped - bad orderType]', o.orderNbr, 'Could not derive orderType from orderNbr');
                    } else {
                        await writeT3({ orderType, orderNbr: o.orderNbr });
                        erpWrites++;
                    }
                } catch (erpErr) {
                    erpWriteErrors++;
                    console.error('[T3][ERP write error]', o.orderNbr, erpErr?.message || erpErr);
                }

                sent++;
            } catch (e) {
                errors++;
                console.error('[T3][send-or-flag error]', o.orderNbr, e?.message || e);
            }
            continue;
        }

        // Exactly-3 but already sent → count; everything else → out-of-window
        if (threeDaySent && daysOut === 3) {
            alreadySent++;
        } else {
            skippedOutOfWindow++;
        }
    }

    const summary = {
        sent,
        resetFlags,
        skippedNoEmail,
        skippedOutOfWindow,
        alreadySent,
        errors,
        erpWrites,         
        erpWriteErrors,    
    };

    console.log('[T3] summary:', JSON.stringify(summary));
    return { ok: true, phase: 'T3', summary };
}
