// src/lib/notifications/t3/run.js
import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver } from '@/lib/time/denver';
import { sendT3Email } from '@/lib/email/mailer';

function daysUntilDenver(targetDate, now = new Date()) {
  if (!targetDate) return null;
  const t0 = startOfDayDenver(targetDate);
  const n0 = startOfDayDenver(now);
  return Math.round((t0.getTime() - n0.getTime()) / (24 * 60 * 60 * 1000));
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
        await sendT3Email({
          to,
          orderNbr: o.orderNbr,
          customerName: o.customerName || '',
          deliveryDate: o.deliveryDate,
        });
        await prisma.erpOrderContact.update({
          where: { orderSummaryId: o.id },
          data: { threeDaySent: true },
        });
        sent++;
      } catch {
        errors++;
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

  const summary = { sent, resetFlags, skippedNoEmail, skippedOutOfWindow, alreadySent, errors };
  console.log('[T3] summary:', JSON.stringify(summary));
  return { ok: true, phase: 'T3', summary };
}
