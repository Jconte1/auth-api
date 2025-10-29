// src/lib/notifications/t14/run.js
import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver } from '@/lib/time/denver';
import { sendT14Email } from '@/lib/email/mailer';
import { writeT14 } from '@/lib/acumatica/confirmations';

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

export async function runT14({ now = new Date() } = {}) {
    const todayDenver = startOfDayDenver(now);

    // Pull active, future-dated orders (or today) where we might need to do T14 work
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
    let erpWrites = 0;
    let erpWriteErrors = 0;

    for (const o of orders) {
        const daysOut = daysUntilDenver(o.deliveryDate, now);
        const tenDaySent = o?.contact?.tenDaySent === true;
        const to = o?.contact?.deliveryEmail?.trim() || '';

        console.log('[T14][inspect]', o.orderNbr, {
            todayDenver: startOfDayDenver(now).toISOString(),
            rawDelivery: o.deliveryDate,
            daysOut,
            tenDaySent,
            hasEmail: !!to,
        });

        // If date moved earlier/later than the window:
        if (daysOut == null) { skippedOutOfWindow++; continue; }

        // Reset rule: if the date is pushed out again (>14) and we had marked sent, make it false.
        if (daysOut > 14 && tenDaySent) {
            await prisma.erpOrderContact.update({
                where: { orderSummaryId: o.id },
                data: { tenDaySent: false },
            });
            resetFlags++;
            continue;
        }

        // Send rule: between 10 to 14 days out, not already sent
        if (daysOut >= 10 && daysOut <= 14 && !tenDaySent) {
            if (!to) { skippedNoEmail++; continue; }

            try {
                // 1) Send email
                await sendT14Email({
                    to,
                    orderNbr: o.orderNbr,
                    customerName: o.customerName || '',
                    deliveryDate: o.deliveryDate,
                });

                // 2) Mark local contact flag
                await prisma.erpOrderContact.update({
                    where: { orderSummaryId: o.id },
                    data: { tenDaySent: true },
                });

                // 3) Tell ERP (library call). Keep isolated so ERP write failures don't undo email/flag.
                try {
                    const orderType = orderTypeFromNbr(o.orderNbr);
                    if (!orderType) {
                        erpWriteErrors++;
                        console.error('[T14][ERP write skipped - bad orderType]', o.orderNbr, 'Could not derive orderType from orderNbr');
                    } else {
                        await writeT14({ orderType, orderNbr: o.orderNbr });
                        erpWrites++;
                    }
                } catch (erpErr) {
                    erpWriteErrors++;
                    console.error('[T14][ERP write error]', o.orderNbr, erpErr?.message || erpErr);
                }

                sent++;
            } catch (e) {
                errors++;
                console.error('[T14][send-or-flag error]', o.orderNbr, e?.message || e);
            }
            continue;
        }

        // If we’re exactly 14 but already sent, or just not exactly 14 → skip
        if (tenDaySent && daysOut === 14) {
            alreadySent++;
        } else {
            skippedOutOfWindow++;
        }
    }

    const summary = { sent, resetFlags, skippedNoEmail, skippedOutOfWindow, alreadySent, errors, erpWrites, erpWriteErrors };
    console.log('[T14] summary:', JSON.stringify(summary));
    return { ok: true, phase: 'T14', summary };
}
