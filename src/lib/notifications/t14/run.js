// src/lib/notifications/t14/run.js
import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver } from '@/lib/time/denver';
import { ensureJob, incrementAttempt, resetAttempts, closeJob } from './jobs';
// TODO: swap to a dedicated T14 template (sendT14Email) once added to mailer.
// For now we reuse the T42 email sender to keep wiring minimal.
import { sendT14Email } from '@/lib/email/mailer';
import { postDeliveryEscalation } from '@/lib/acumatica/escalations';

const PHASE = 'T14';
const SEND_DAYS = new Set([14, 13, 12, 11]); // attempt window

function daysUntilDenver(targetDate, now = new Date()) {
    if (!targetDate) return null;
    const t0 = startOfDayDenver(targetDate);
    const n0 = startOfDayDenver(now);
    return Math.round((t0.getTime() - n0.getTime()) / (24 * 60 * 60 * 1000));
}

// Treat null or "" as empty
function isEmpty(v) {
    return v == null || v === '';
}

export async function runT14({ now = new Date() } = {}) {
    const todayDenver = startOfDayDenver(now);

    // Candidates: active, future delivery, unconfirmed via/with, not tenDaySent
    const orders = await prisma.erpOrderSummary.findMany({
        where: {
            isActive: true,
            deliveryDate: { gte: todayDenver },
            contact: {
                is: {
                    tenDaySent: { not: true },
                    OR: [{ confirmedVia: null }, { confirmedVia: '' }],
                    AND: [{ OR: [{ confirmedWith: null }, { confirmedWith: '' }] }],
                },
            },
        },
        include: { contact: true },
    });

    let countedAttempts = 0;
    let emailsSent = 0;
    let emailsErrored = 0;
    let resets = 0;
    let escalations = 0;
    let closed = 0;
    let skipped = 0;

    for (const o of orders) {
        const daysOut = daysUntilDenver(o.deliveryDate, now);

        // If confirmations present, close job (if any) and skip
        if (!isEmpty(o?.contact?.confirmedVia) || !isEmpty(o?.contact?.confirmedWith)) {
            const job = await prisma.notificationJob.findUnique({
                where: { orderSummaryId_phase: { orderSummaryId: o.id, phase: PHASE } },
            });
            if (job && job.status !== 'closed') {
                await closeJob(job.id);
                closed++;
            } else {
                skipped++;
            }
            continue;
        }

        // Block if flagged failed until human clears via ERP sync
        if (o?.contact?.tenDaySent === true) {
            skipped++;
            continue;
        }

        // > 14 days: reset attempts (if any) and skip for today
        if (daysOut > 14) {
            const job = await prisma.notificationJob.findUnique({
                where: { orderSummaryId_phase: { orderSummaryId: o.id, phase: PHASE } },
            });
            if (job && job.attemptCount > 0) {
                await resetAttempts(job.id, o.deliveryDate);
                resets++;
            } else {
                skipped++;
            }
            continue;
        }

        // < 11 days: escalate immediately (regardless of attempts)
        if (daysOut < 11) {
            const job = await ensureJob(o.id, o.deliveryDate);

            const res = await postDeliveryEscalation({
                orderId: o.id,
                baid: o.baid,
                orderNbr: o.orderNbr,
                deliveryDate: o.deliveryDate,
                deliveryEmail: o?.contact?.deliveryEmail || null,
                phase: PHASE,
                daysOut,
                attemptCount: job.attemptCount ?? 0,
                reason: 'late-window', // for T14
            });

            if (res?.ok) {
                await prisma.$transaction([
                    prisma.erpOrderContact.update({
                        where: { orderSummaryId: o.id },
                        data: { tenDaySent: true },
                    }),
                    prisma.notificationJob.update({
                        where: { id: job.id },
                        data: { attemptCount: 0, escalationPostedAt: new Date(), status: 'escalated' },
                    }),
                ]);
                escalations++;
            } else {
                skipped++; // ERP write failed; try again next run while flag is still false
            }
            continue;
        }

        // 14–11 window: count attempts (even with missing/bad email) up to 3; never send a 4th email
        if (SEND_DAYS.has(daysOut)) {
            const job = await ensureJob(o.id, o.deliveryDate);

            // One attempt per Denver day
            const alreadyCountedToday =
                job.lastAttemptAt &&
                startOfDayDenver(job.lastAttemptAt).getTime() === todayDenver.getTime();

            if (job.attemptCount < 3 && !alreadyCountedToday) {
                await incrementAttempt(job.id);
                countedAttempts++;

                // Try to send if we have an email; attempt still counts regardless
                const to = o?.contact?.deliveryEmail || null;
                if (to) {
                    try {
                        await sendT14Email({
                            to,
                            orderNbr: o.orderNbr,
                            customerName: o.customerName || '',
                            deliveryDate: o.deliveryDate,
                        });
                        emailsSent++;
                    } catch {
                        emailsErrored++;
                    }
                }
            } else {
                // attemptCount >= 3 or already counted today
                skipped++;
            }
            continue;
        }

        // Any other day (shouldn't happen with guards above) → skip
        skipped++;
    }

    const summary = { countedAttempts, emailsSent, emailsErrored, escalations, resets, closed, skipped };
    console.log('[T14] summary:', JSON.stringify(summary));
    return { ok: true, phase: PHASE, summary };
}
