// backend: app/api/orders/[orderNbr]/confirm/route.js
import { NextResponse } from 'next/server';
import notifsEnabled from '@/config/notifs.js';
import prisma from '@/lib/prisma/prisma';
import requireAuth from '@/app/api/auth/requireAuth.js/route';

async function isAdminForBaid(userId, baid) {
  const rows = await prisma.accountUserRole.findMany({
    where: { userId, baid, isActive: true },
    select: { role: true },
  });
  return rows.some(r => r.role === 'ADMIN');
}

export async function POST(req, { params }) {
  if (!notifsEnabled()) {
    return NextResponse.json({ ok: false, reason: 'NOTIFS_DISABLED' }, { status: 503 });
  }

  // auth (expects requireAuth to return { userId } or NextResponse on failure)
  const auth = requireAuth(req);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  const orderNbr = params?.orderNbr;
  const body = await req.json().catch(() => ({}));
  const phase = String(body?.phase || '').toUpperCase(); // 'T42' | 'T14' | 'T2'

  if (!orderNbr || !['T42', 'T14', 'T2'].includes(phase)) {
    return NextResponse.json({ ok: false, error: 'BAD_REQUEST' }, { status: 400 });
  }

  // find the order to learn its BAID and ID
  const order = await prisma.erpOrderSummary.findFirst({
    where: { orderNbr },
    select: { id: true, baid: true },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: 'ORDER_NOT_FOUND' }, { status: 404 });
  }

  // Authorization: Admin for BAID OR assigned PM to this order
  const admin = await isAdminForBaid(userId, order.baid);
  if (!admin) {
    const assigned = await prisma.orderAssignment.findFirst({
      where: { orderSummaryId: order.id, userId, role: 'PM', isActive: true },
      select: { id: true },
    });
    if (!assigned) {
      return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
    }
  }

  // find the job for this phase
  const job = await prisma.notificationJob.findUnique({
    where: { orderSummaryId_phase: { orderSummaryId: order.id, phase } },
    select: { id: true, confirmedAt: true, status: true },
  });
  if (!job) {
    return NextResponse.json({ ok: false, error: 'JOB_NOT_FOUND' }, { status: 404 });
  }

  // mark confirmed (idempotent)
  const now = new Date();
  await prisma.notificationJob.update({
    where: { id: job.id },
    data: {
      confirmedAt: job.confirmedAt || now,
      status: 'sent',
      // optional: sentAt: now,
    },
  });

  // TODO: post ERP activity "Customer confirmed {phase}" (optional for MVP)

  return NextResponse.json({ ok: true, orderNbr, phase, confirmed: true, by: userId });
}

// Optional GET -> echo POST for quick manual tests
// export async function GET(req, ctx) { return POST(req, ctx); }
