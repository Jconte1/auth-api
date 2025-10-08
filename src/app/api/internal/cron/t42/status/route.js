// app/api/internal/cron/t42/status/route.js
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma/prisma';
import { isCronAuthorized } from '@/lib/cron/auth';
import { startOfDayDenver, addDaysDenver } from '@/lib/time/denver';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  if (!isCronAuthorized(req, searchParams)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const now = new Date();
  const dayStart = startOfDayDenver(now);
  const dayEnd = addDaysDenver(dayStart, 1); // exclusive upper bound

  // Jobs (T42) touched today
  const jobs = await prisma.notificationJob.findMany({
    where: {
      phase: 'T42',
      updatedAt: { gte: dayStart, lt: dayEnd },
    },
    select: {
      id: true,
      status: true,
      escalationPostedAt: true,
      orderSummaryId: true,
      scheduledAt: true,
      updatedAt: true,
    },
    take: 200, // keep payload light; adjust as needed
    orderBy: { updatedAt: 'desc' },
  });

  // Attempts (T42) changed today
  const attempts = await prisma.notificationAttempt.findMany({
    where: {
      updatedAt: { gte: dayStart, lt: dayEnd },
      job: { phase: 'T42' },
    },
    select: {
      id: true,
      attemptNumber: true,
      status: true,           // 'waiting' | 'sending' | 'sent' | 'failed'
      providerMsgId: true,
      error: true,
      sentAt: true,
      notificationJobId: true,
      updatedAt: true,
    },
    take: 500,
    orderBy: { updatedAt: 'desc' },
  });

  // Quick rollups
  const rollup = {
    jobs: {
      total: jobs.length,
      waiting: jobs.filter(j => j.status === 'waiting').length,
      sent: jobs.filter(j => j.status === 'sent').length,
      escalated: jobs.filter(j => j.status === 'escalated').length,
    },
    attempts: {
      total: attempts.length,
      waiting: attempts.filter(a => a.status === 'waiting').length,
      sending: attempts.filter(a => a.status === 'sending').length,
      sent: attempts.filter(a => a.status === 'sent').length,
      failed: attempts.filter(a => a.status === 'failed').length,
    },
  };

  return NextResponse.json({
    ok: true,
    phase: 'T42',
    dayStart,
    dayEnd,
    rollup,
    samples: {
      jobs: jobs.slice(0, 25),
      attempts: attempts.slice(0, 25),
    },
  });
}
