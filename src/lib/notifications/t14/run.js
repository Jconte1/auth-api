// src/lib/notifications/t14/run.js
import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver } from '@/lib/time/denver';
import { sendT14Email } from '@/lib/email/mailer';

function daysUntilDenver(targetDate, now = new Date()) {
    if (!targetDate) return null;
    const t0 = startOfDayDenver(targetDate);
    const n0 = startOfDayDenver(now);
    return Math.round((t0.getTime() - n0.getTime()) / (24 * 60 * 60 * 1000));
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
                await sendT14Email({
                    to,
                    orderNbr: o.orderNbr,
                    customerName: o.customerName || '',
                    deliveryDate: o.deliveryDate,
                });

                // Mark as sent
                await prisma.erpOrderContact.update({
                    where: { orderSummaryId: o.id },
                    data: { tenDaySent: true },
                });

                sent++;
            } catch (e) {
                errors++;
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

    const summary = { sent, resetFlags, skippedNoEmail, skippedOutOfWindow, alreadySent, errors };
    console.log('[T14] summary:', JSON.stringify(summary));
    return { ok: true, phase: 'T14', summary };
}
