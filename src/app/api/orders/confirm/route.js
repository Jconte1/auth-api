// app/api/orders/confirm/route.js
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma/prisma';
import { postOrderConfirmed } from '@/lib/acumatica/confirmations';

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allow =
    origin === (process.env.FRONTEND_URL || 'http://localhost:3000') ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

export async function OPTIONS(req) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req) {
  try {
    const { baid, orderNbr } = await req.json();
    if (!baid || !orderNbr) {
      return NextResponse.json(
        { ok: false, error: 'Missing baid or orderNbr' },
        { status: 400, headers: corsHeaders(req) }
      );
    }

    // Flip confirmation in our DB
    const updated = await prisma.erpOrderSummary.updateMany({
      where: { baid, orderNbr, isActive: true },
      data: { isConfirmed: true, confirmedAt: new Date() },
    });

    if (updated.count === 0) {
      return NextResponse.json(
        { ok: false, error: 'Order not found' },
        { status: 404, headers: corsHeaders(req) }
      );
    }

    // Park any open T42 job to avoid escalation
    await prisma.notificationJob.updateMany({
      where: { phase: 'T42', order: { baid, orderNbr } },
      data: { status: 'sent' },
    });

    // Fetch minimal context for ERP payload (optional, but useful)
    const ord = await prisma.erpOrderSummary.findFirst({
      where: { baid, orderNbr },
      include: { contact: true },
    });

    // Fire ERP confirmation (placeholder)
    try {
      await postOrderConfirmed({
        orderId: ord?.id,
        baid,
        orderNbr,
        deliveryDate: ord?.deliveryDate ?? null,
        deliveryEmail: ord?.contact?.deliveryEmail ?? null,
      });
    } catch (e) {
      // Log but don't fail the user confirmation
      console.error('[orders/confirm] ERP confirm failed:', e?.message || e);
    }

    return NextResponse.json(
      { ok: true, baid, orderNbr, confirmed: true },
      { status: 200, headers: corsHeaders(req) }
    );
  } catch (e) {
    console.error('[orders/confirm] error:', e);
    return NextResponse.json(
      { ok: false, error: 'Server error' },
      { status: 500, headers: corsHeaders(req) }
    );
  }
}
