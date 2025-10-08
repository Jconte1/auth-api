// src/lib/notifications/t42/orchestrator.js
import prisma from '@/lib/prisma/prisma';
import { startOfDayDenver, addDaysDenver } from '@/lib/time/denver';
import { ensureNotificationJob, ensureAttempt } from '@/lib/notifications/t42/persist';

const TARGET_DAY = 42;
const ESCALATE_DAY = 39;
const DAYS_WE_CARE = new Set([42, 41, 40, 39]);

function daysUntilDenver(targetDate, now = new Date()) {
  if (!targetDate) return null;
  const t = startOfDayDenver(targetDate);
  const n = startOfDayDenver(now);
  const ms = t.getTime() - n.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

// Only pull active, upcoming, and **not confirmed** orders
async function fetchCandidates(now = new Date()) {
  const todayDenver = startOfDayDenver(now);
  const sixtyDaysOut = addDaysDenver(todayDenver, 60);

  return prisma.erpOrderSummary.findMany({
    where: {
      isActive: true,
      deliveryDate: { gte: todayDenver, lte: sixtyDaysOut },
      AND: [
        // Treat either flag as confirmation; skip if confirmed
        { confirmedAt: null },
        { OR: [{ isConfirmed: false }, { isConfirmed: null }] },
      ],
    },
    include: {
      contact: true, // for deliveryEmail
    },
  });
}

// ---- Read-only scan (for diagnostics / status) ----
export async function runT42Scan({ now = new Date() } = {}) {
  const rows = await fetchCandidates(now);

  const attempt1 = [];
  const attempt2 = [];
  const attempt3 = [];
  const escalate = [];

  for (const o of rows) {
    // Extra runtime guard (defensive against race-y updates)
    if (o.isConfirmed || o.confirmedAt) continue;

    const daysOut = daysUntilDenver(o.deliveryDate, now);
    if (!DAYS_WE_CARE.has(daysOut)) continue;

    const hasEmail = !!o?.contact?.deliveryEmail;
    const entry = {
      orderId: o.id,
      baid: o.baid,
      orderNbr: o.orderNbr,
      daysOut,
      hasEmail,
      deliveryEmail: o?.contact?.deliveryEmail || null,
      deliveryDate: o.deliveryDate,
    };

    if (daysOut === TARGET_DAY)       attempt1.push(entry);
    else if (daysOut === TARGET_DAY-1) attempt2.push(entry);
    else if (daysOut === TARGET_DAY-2) attempt3.push(entry);
    else if (daysOut === ESCALATE_DAY) escalate.push(entry);
  }

  return {
    ok: true,
    phase: 'T42',
    now,
    counts: {
      scanned: rows.length,
      attempt1: attempt1.length,
      attempt2: attempt2.length,
      attempt3: attempt3.length,
      escalate: escalate.length,
    },
    samples: {
      attempt1: attempt1.slice(0, 10),
      attempt2: attempt2.slice(0, 10),
      attempt3: attempt3.slice(0, 10),
      escalate: escalate.slice(0, 10),
    },
  };
}

// ---- Write-mode: create job + attempt placeholders (no email here) ----
export async function runT42PrepareWrites({ now = new Date() } = {}) {
  const rows = await fetchCandidates(now);

  const prepared = { attempt1: 0, attempt2: 0, attempt3: 0 };
  const skippedNoEmail = { attempt1: 0, attempt2: 0, attempt3: 0 };

  for (const o of rows) {
    // Defensive guard
    if (o.isConfirmed || o.confirmedAt) continue;

    const daysOut = daysUntilDenver(o.deliveryDate, now);
    if (!DAYS_WE_CARE.has(daysOut)) continue;

    let attemptNumber = null;
    if (daysOut === TARGET_DAY) attemptNumber = 1;
    else if (daysOut === TARGET_DAY - 1) attemptNumber = 2;
    else if (daysOut === TARGET_DAY - 2) attemptNumber = 3;
    else if (daysOut === ESCALATE_DAY) {
      // Day 39 handled in escalation pass
      continue;
    }
    if (!attemptNumber) continue;

    const hasEmail = !!o?.contact?.deliveryEmail;
    if (!hasEmail) {
      if (attemptNumber === 1) skippedNoEmail.attempt1++;
      if (attemptNumber === 2) skippedNoEmail.attempt2++;
      if (attemptNumber === 3) skippedNoEmail.attempt3++;
      continue;
    }

    const job = await ensureNotificationJob({
      orderSummaryId: o.id,
      scheduledAt: now,
    });

    await ensureAttempt({ notificationJobId: job.id, attemptNumber });

    if (attemptNumber === 1) prepared.attempt1++;
    if (attemptNumber === 2) prepared.attempt2++;
    if (attemptNumber === 3) prepared.attempt3++;
  }

  return {
    ok: true,
    phase: 'T42',
    now,
    prepared,
    skippedNoEmail,
  };
}
