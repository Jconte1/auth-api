// src/lib/notifications/t42/escalate.js
import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver, addDaysDenver } from '@/lib/time/denver';
import { ensureNotificationJob } from '@/lib/notifications/t42/persist';
import { postDeliveryEscalation } from '@/lib/acumatica/escalations';

const PHASE = 'T42';
const ESCALATE_DAY = 39;

function daysUntilDenver(targetDate, now = new Date()) {
  if (!targetDate) return null;
  const t0 = startOfDayDenver(targetDate);
  const n0 = startOfDayDenver(now);
  return Math.round((t0.getTime() - n0.getTime()) / (24 * 60 * 60 * 1000));
}

async function fetchCandidates(now = new Date()) {
  const todayDenver = startOfDayDenver(now);
  const sixtyDaysOut = addDaysDenver(todayDenver, 60);

  return prisma.erpOrderSummary.findMany({
    where: {
      isActive: true,
      deliveryDate: { gte: todayDenver, lte: sixtyDaysOut },
      AND: [
        { confirmedAt: null },
        { OR: [{ isConfirmed: false }, { isConfirmed: null }] },
      ],
    },
    include: { contact: true },
  });
}

export async function runT42Escalation({ now = new Date() } = {}) {
  const rows = await fetchCandidates(now);

  let considered = 0;
  let claimed = 0;
  let skipped = 0;
  let erpOk = 0;
  let erpFail = 0;
    const messages = [];
  for (const o of rows) {
    // Defensive guard
    if (o.isConfirmed || o.confirmedAt) continue;

    const daysOut = daysUntilDenver(o.deliveryDate, now);
    if (daysOut !== ESCALATE_DAY) continue;

    considered++;

    const job = await ensureNotificationJob({
      orderSummaryId: o.id,
      scheduledAt: now,
    });

    // Claim by stamping escalationPostedAt if it's still null (idempotent)
    const res = await prisma.notificationJob.updateMany({
      where: { id: job.id, escalationPostedAt: null, phase: PHASE },
      data: { escalationPostedAt: new Date(), status: 'escalated' },
    });

    if (res.count !== 1) {
      skipped++; // already escalated or raced
      continue;
    }

    claimed++;

    try {
      const result = await postDeliveryEscalation({
        orderId: o.id,
        baid: o.baid,
        orderNbr: o.orderNbr,
        deliveryDate: o.deliveryDate,
        deliveryEmail: o?.contact?.deliveryEmail || null,
        phase: PHASE,
        daysOut,
      });
      if (result?.ok) {
        erpOk++;
        if (result?.note) {
          messages.push({ orderNbr: o.orderNbr, note: result.note });
        }
      } else {
        erpFail++;
      }
    } catch (e) {
      erpFail++;
    }
  }

  return {
    ok: true,
    phase: PHASE,
    summary: { considered, claimed, skipped, erpOk, erpFail },
    messages,
  };
}
