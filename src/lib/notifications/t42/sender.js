// src/lib/notifications/t42/sender.js
import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver } from '@/lib/time/denver';
import { sendT42Email } from '@/lib/email/mailer';

const PHASE = 'T42';
const VALID_DAYS_OUT = new Set([42, 41, 40]);

function daysUntilDenver(targetDate, now = new Date()) {
  if (!targetDate) return null;
  const t0 = startOfDayDenver(targetDate);
  const n0 = startOfDayDenver(now);
  return Math.round((t0.getTime() - n0.getTime()) / (24 * 60 * 60 * 1000));
}

async function claimAttempt(attemptId) {
  const res = await prisma.notificationAttempt.updateMany({
    where: { id: attemptId, status: 'waiting' },
    data: { status: 'sending' },
  });
  return res.count === 1;
}

export async function runT42SendEmails({ now = new Date() } = {}) {
  const attempts = await prisma.notificationAttempt.findMany({
    where: {
      status: 'waiting',
      job: { phase: PHASE },
    },
    include: {
      job: {
        include: {
          order: {
            include: { contact: true },
          },
        },
      },
    },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const a of attempts) {
    const order = a.job?.order;
    if (!order) { skipped++; continue; }

    // NEW: skip if confirmed (defensive against same-day confirmations)
    if (order.isConfirmed || order.confirmedAt) { skipped++; continue; }

    const daysOut = daysUntilDenver(order.deliveryDate, now);
    if (!VALID_DAYS_OUT.has(daysOut)) { skipped++; continue; }

    const to = order?.contact?.deliveryEmail;
    if (!to) { skipped++; continue; }

    const owned = await claimAttempt(a.id);
    if (!owned) { skipped++; continue; }

    try {
      const { messageId } = await sendT42Email({
        to,
        orderNbr: order.orderNbr,
        customerName: order.customerName || '',
        deliveryDate: order.deliveryDate,
      });

      await prisma.notificationAttempt.update({
        where: { id: a.id },
        data: {
          status: 'sent',
          providerMsgId: messageId || undefined,
          error: null,
          sentAt: new Date(),
        },
      });
      sent++;
    } catch (err) {
      await prisma.notificationAttempt.update({
        where: { id: a.id },
        data: {
          status: 'failed',
          error: String(err?.message || err),
          sentAt: new Date(),
        },
      });
      failed++;
    }
  }

  return { ok: true, phase: PHASE, summary: { sent, failed, skipped } };
}
