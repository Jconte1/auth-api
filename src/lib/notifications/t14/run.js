import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver } from '@/lib/time/denver';
import { ensureJob, incrementAttempt, resetAttempts } from './jobs';
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

export async function runT14({ now = new Date() } = {}) {
    const todayDenver = startOfDayDenver(now);

    // Candidates: active, future delivery (or today), NOT already marked as sent for T14
    const orders = await prisma.erpOrderSummary.findMany({
        where: {
            isActive: true,
            deliveryDate: { gte: todayDenver },
            contact: {
                is: {
                    tenDaySent: { not: true },
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
    let skipped = 0;

    for (const o of orders) {
        const daysOut = daysUntilDenver(o.deliveryDate, now);

        // Block entirely if ten-day already handled (until ERP sync flips back)
        if (o?.contact?.tenDaySent === true) {
            skipped++;
            continue;
        }

        // Too early: >14 days → reset attempts if needed
        if (daysOut > 14) {
            if (o?.contact?.tenDaySent === true) {
                await prisma.erpOrderContact.update({
                    where: { orderSummaryId: o.id },
                    data: { tenDaySent: false },
                });
            }
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

        // Too late: <11 days → escalate immediately (no more reminders)
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
                reason: 'late-window',
            });

            if (res?.ok) {
                await prisma.$transaction([
                    prisma.erpOrderContact.update({
                        where: { orderSummaryId: o.id },
                        data: { tenDaySent: true }, // mark complete to prevent more T14 attempts
                    }),
                    prisma.notificationJob.update({
                        where: { id: job.id },
                        data: { attemptCount: 0, escalationPostedAt: new Date(), status: 'escalated' },
                    }),
                ]);
                escalations++;
            } else {
                skipped++; // ERP write failed; try again next run
            }
            continue;
        }

        // In-window 14–11 (inclusive): attempt up to 3 times, once per Denver day
        if (SEND_DAYS.has(daysOut)) {
            const job = await ensureJob(o.id, o.deliveryDate);

            const alreadyCountedToday =
                job.lastAttemptAt &&
                startOfDayDenver(job.lastAttemptAt).getTime() === todayDenver.getTime();

            if (job.attemptCount < 3 && !alreadyCountedToday) {
                await incrementAttempt(job.id);
                countedAttempts++;

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
                        emailsErrored++; // attempt still counts even if send fails
                    }
                }
            } else {
                skipped++; // maxed out or already attempted today
            }
            continue;
        }

        // Any other day falls through
        skipped++;
    }

    const summary = { countedAttempts, emailsSent, emailsErrored, escalations, resets, skipped };
    console.log('[T14] summary:', JSON.stringify(summary));
    return { ok: true, phase: PHASE, summary };
}
