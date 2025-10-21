// src/lib/notifications/t42/jobs.js
import prisma from '@/lib/prisma/prisma';

const PHASE = 'T42';

export async function ensureJob(orderSummaryId, snapshotDate) {
  return prisma.notificationJob.upsert({
    where: { orderSummaryId_phase: { orderSummaryId, phase: PHASE } },
    update: {
      // keep it open; refresh snapshot if we learned a new delivery date
      ...(snapshotDate ? { lastDeliveryDateSnapshot: snapshotDate } : {}),
      status: 'open',
    },
    create: {
      orderSummaryId,
      phase: PHASE,
      status: 'open',
      attemptCount: 0,
      lastDeliveryDateSnapshot: snapshotDate ?? null,
      idempotencyKey: `${orderSummaryId}-${PHASE}`,
      scheduledAt: new Date(),
    },
  });
}

export async function incrementAttempt(jobId) {
  return prisma.notificationJob.update({
    where: { id: jobId },
    data: {
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
      status: 'open',
    },
  });
}

export async function resetAttempts(jobId, newSnapshot) {
  return prisma.notificationJob.update({
    where: { id: jobId },
    data: {
      attemptCount: 0,
      escalationPostedAt: null,
      status: 'open',
      ...(newSnapshot ? { lastDeliveryDateSnapshot: newSnapshot } : {}),
    },
  });
}

export async function closeJob(jobId) {
  return prisma.notificationJob.update({
    where: { id: jobId },
    data: { status: 'closed', closedAt: new Date() },
  });
}
