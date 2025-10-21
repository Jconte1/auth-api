// backend: app/api/internal/orders/[orderNbr]/assign-pm/route.js
import { NextResponse } from 'next/server';
// NOTE: adjust the relative paths if needed based on your folder depth.
import prisma from '@/lib/prisma/prisma.js';
import deriveOrderPmAssignment from '@/services/assignment/deriveOrderPmAssignment.js';
import notifsEnabled from '@/config/notifs';

export async function POST(_req, { params }) {
  if (!notifsEnabled()) {
    return NextResponse.json({ ok: false, reason: 'NOTIFS_DISABLED' }, { status: 503 });
  }

  const orderNbr = params?.orderNbr;
  if (!orderNbr) {
    return NextResponse.json({ ok: false, error: 'MISSING_ORDER_NBR' }, { status: 400 });
  }
  
  // Find the orderSummaryId from the OrderNbr
  const order = await prisma.erpOrderSummary.findFirst({
    where: { orderNbr },
    select: { id: true },
  });
  if (!order) {
    return NextResponse.json({ ok: false, error: 'ORDER_NOT_FOUND', orderNbr }, { status: 404 });
  }

  const result = await deriveOrderPmAssignment(order.id);
  return NextResponse.json({ ok: true, orderNbr, result });
}
