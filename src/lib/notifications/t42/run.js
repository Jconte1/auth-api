// src/lib/notifications/t42/run.js
import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver } from '@/lib/time/denver';
import { ensureJob, incrementAttempt, resetAttempts, closeJob } from './jobs';
import { sendT42Email } from '@/lib/email/mailer';
import { postDeliveryEscalation } from '@/lib/acumatica/escalations';

const PHASE = 'T42';
const SEND_DAYS = new Set([42, 41, 40, 39]);

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

export async function runT42({ now = new Date() } = {}) {
  const todayDenver = startOfDayDenver(now);

  // Pull only orders that *might* need attention:
  // - active
  // - have a deliveryDate in the future (or today)
  // - unconfirmed via/with (empty)
  // - not marked sixWeekFailed
  const orders = await prisma.erpOrderSummary.findMany({
    where: {
      isActive: true,
      deliveryDate: { gte: todayDenver },
      contact: {
        is: {
          sixWeekFailed: { not: true },
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

    // Belt & suspenders: if confirmations present, close job and skip.
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

    // Skip entirely if flagged failed until a human clears it (sync flips it back to false)
    if (o?.contact?.sixWeekFailed === true) {
      skipped++;
      continue;
    }

    // > 42 days: reset attempts (if any) and skip for today
    if (daysOut > 42) {
      const job = await prisma.notificationJob.findUnique({
        where: { orderSummaryId_phase: { orderSummaryId: o.id, phase: PHASE } },
      });
      if (job && job.attemptCount > 0) {
        await resetAttempts(job.id, o.deliveryDate);
        resets++;
      } else {
        // no job or already zero attempts
        skipped++;
      }
      continue;
    }

    // < 39 days and still unconfirmed: escalate immediately (regardless of attempts)
    if (daysOut < 39) {
      // Ensure a job exists (so we can stamp escalation)
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
        // Mark contact failed + reset attempts + stamp escalation
        await prisma.$transaction([
          prisma.erpOrderContact.update({
            where: { orderSummaryId: o.id },
            data: { sixWeekFailed: true },
          }),
          prisma.notificationJob.update({
            where: { id: job.id },
            data: { attemptCount: 0, escalationPostedAt: new Date(), status: 'escalated' },
          }),
        ]);
        escalations++;
      } else {
        // If ERP write fails, do nothing else; next cron will retry while sixWeekFailed is still false.
        skipped++;
      }
      continue;
    }

    // 39–42 window: count attempts (even with missing/bad email) up to 3; never send a 4th email
    if (SEND_DAYS.has(daysOut)) {
      const job = await ensureJob(o.id, o.deliveryDate);

      // Avoid double-counting within the same Denver day
      const alreadyCountedToday =
        job.lastAttemptAt &&
        startOfDayDenver(job.lastAttemptAt).getTime() === todayDenver.getTime();

      if (job.attemptCount < 3 && !alreadyCountedToday) {
        await incrementAttempt(job.id);
        countedAttempts++;

        // Try to send if we have an email; attempt still counts regardless of outcome
        const to = o?.contact?.deliveryEmail || null;
        if (to) {
          try {
            await sendT42Email({
              to,
              orderNbr: o.orderNbr,
              customerName: o.customerName || '',
              deliveryDate: o.deliveryDate,
            });
            emailsSent++;
          } catch {
            emailsErrored++; // attempt still counted
          }
        }
      } else {
        // attemptCount >= 3 or already counted today → no more emails here
        // Escalation is handled once the order leaves the window (<39) or via ops policy
        skipped++;
      }
      continue;
    }

    // If we’re exactly at 39, the above branch handled it.
    // Any other day (e.g., 43+ handled earlier, <39 handled earlier) falls through to skip.
    skipped++;
  }

  const summary = { countedAttempts, emailsSent, emailsErrored, escalations, resets, closed, skipped };
  console.log('[T42] summary:', JSON.stringify(summary));
  return { ok: true, phase: PHASE, summary };

  return {
    ok: true,
    phase: PHASE,
    summary: { countedAttempts, emailsSent, emailsErrored, escalations, resets, closed, skipped },
  };
}
