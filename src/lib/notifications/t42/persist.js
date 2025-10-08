// src/lib/notifications/t42/persist.js
import prisma from '@/lib/prisma/prisma';

const PHASE = 'T42';

// Create or fetch the NotificationJob for an order+phase.
// Uses the unique constraint @@unique([orderSummaryId, phase]) for idempotency.
export async function ensureNotificationJob({ orderSummaryId, scheduledAt = new Date() }) {
  return prisma.notificationJob.upsert({
    where: {
      // Prisma composite unique: orderSummaryId + phase
      orderSummaryId_phase: { orderSummaryId, phase: PHASE },
    },
    update: {
      // Keep it in a “waiting”/“scheduled” style state until we actually send
      status: 'waiting',
      scheduledAt, // keep latest schedule time for visibility
    },
    create: {
      orderSummaryId,
      phase: PHASE,
      scheduledAt,
      status: 'waiting',
      idempotencyKey: `${orderSummaryId}-${PHASE}`, // stable unique per job
    },
  });
}

// Create or fetch a NotificationAttempt for a job+attemptNumber.
// Uses the unique constraint @@unique([notificationJobId, attemptNumber]).
export async function ensureAttempt({ notificationJobId, attemptNumber }) {
  return prisma.notificationAttempt.upsert({
    where: {
      notificationJobId_attemptNumber: { notificationJobId, attemptNumber },
    },
    update: {
      // No email sent yet — leave as a “waiting” placeholder with a timestamp
      status: 'waiting',
      sentAt: new Date(),
    },
    create: {
      notificationJobId,
      attemptNumber,
      status: 'waiting', // we’ll flip to 'sent' or 'failed' in the email step
      sentAt: new Date(), // acts as “created at” for the placeholder
    },
  });
}
