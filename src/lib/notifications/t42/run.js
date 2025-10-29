// src/lib/notifications/t42/run.js
import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver } from '@/lib/time/denver';
import { ensureJob, incrementAttempt, resetAttempts, closeJob } from './jobs';
import { sendT42Email } from '@/lib/email/mailer';
import { writeT42 } from '@/lib/acumatica/confirmations';

const PHASE = 'T42';
const SEND_DAYS = new Set([42, 41, 40, 39]);

function daysUntilDenver(targetDate, now = new Date()) {
  if (!targetDate) return null;
  const t0 = startOfDayDenver(targetDate);
  const n0 = startOfDayDenver(now);
  return Math.round((t0.getTime() - n0.getTime()) / (24 * 60 * 60 * 1000));
}

function orderTypeFromNbr(orderNbr = '') {
  // e.g. "C105098" -> "C1"
  const m = String(orderNbr).match(/^[A-Za-z0-9]{2}/);
  return m ? m[0].toUpperCase() : null;
}

// Treat null or "" as empty
function isEmpty(v) {
  return v == null || v === '';
}

export async function runT42({ now = new Date() } = {}) {
  const todayDenver = startOfDayDenver(now);

  // Pull only orders that *might* need attention:
  // - active
  // - future (or today)
  // - unconfirmed
  // - not already marked sixWeekFailed
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

  // ERP write counters
  let erpWrites = 0;
  let erpWriteErrors = 0;

  for (const o of orders) {
    const daysOut = daysUntilDenver(o.deliveryDate, now);

    // If confirmations are present, close job and skip
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

    // If already flagged failed, skip (ops must clear)
    if (o?.contact?.sixWeekFailed === true) {
      skipped++;
      continue;
    }

    // > 42 days: reset attempts (if any) and skip
    if (daysOut == null || daysOut > 42) {
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

    // < 39 days: escalate (ERP write), then flag sixWeekFailed on success
    if (daysOut < 39) {
      const job = await ensureJob(o.id, o.deliveryDate);

      try {
        const orderType = orderTypeFromNbr(o.orderNbr);
        if (!orderType) {
          erpWriteErrors++;
          console.error('[T42][ERP write skipped - bad orderType]', o.orderNbr, 'Could not derive orderType from orderNbr');
          skipped++;
          continue;
        }

        // Write to ERP first
        await writeT42({ orderType, orderNbr: o.orderNbr });
        erpWrites++;

        // Only after a successful ERP write do we flag locally and stamp escalation
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
      } catch (erpErr) {
        erpWriteErrors++;
        console.error('[T42][ERP write error]', o.orderNbr, erpErr?.message || erpErr);
        // Do not mark sixWeekFailed; next run will retry.
        skipped++;
      }
      continue;
    }

    // 39–42 window: count attempts (max 3), try sending email if present
    // 39–42 window: count attempts (max 3). If we'd reach a 4th touch, escalate instead of emailing.
    if (SEND_DAYS.has(daysOut)) {
      const job = await ensureJob(o.id, o.deliveryDate);

      const alreadyCountedToday =
        job.lastAttemptAt &&
        startOfDayDenver(job.lastAttemptAt).getTime() === todayDenver.getTime();

      // If we've already recorded 3 attempts (i.e., the next would be #4), escalate + ERP write
      if (job.attemptCount >= 3 && !alreadyCountedToday && job.status !== 'escalated') {
        try {
          const orderType = orderTypeFromNbr(o.orderNbr);
          if (!orderType) {
            erpWriteErrors++;
            console.error('[T42][ERP write skipped - bad orderType]', o.orderNbr, 'Could not derive orderType from orderNbr');
            skipped++;
          } else {
            await writeT42({ orderType, orderNbr: o.orderNbr });
            erpWrites++;

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
          }
        } catch (erpErr) {
          erpWriteErrors++;
          console.error('[T42][ERP write error]', o.orderNbr, erpErr?.message || erpErr);
          // Leave sixWeekFailed false so a later run can retry
          skipped++;
        }
        continue;
      }

      // Normal attempt counting (only for attempts 0–2). Attempt #3 still sends the email.
      if (job.attemptCount < 3 && !alreadyCountedToday) {
        await incrementAttempt(job.id);
        countedAttempts++;

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
            emailsErrored++;
          }
        }
      } else {
        // Either already counted today, or already escalated, or attemptCount >= 3 but handled above
        skipped++;
      }
      continue;
    }
    // Anything else falls through
    skipped++;
  }

  const summary = {
    countedAttempts,
    emailsSent,
    emailsErrored,
    escalations,
    resets,
    closed,
    skipped,
    erpWrites,
    erpWriteErrors,
  };
  console.log('[T42] summary:', JSON.stringify(summary));
  return { ok: true, phase: PHASE, summary };
}
