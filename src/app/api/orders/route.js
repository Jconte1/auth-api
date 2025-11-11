// backend: app/api/orders/route.js
import prisma from '@/lib/prisma/prisma';

const ORIGIN = 'https://mld-website-git-login-feature-jconte1s-projects.vercel.app'; //
const baseHeaders = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
  'Vary': 'Origin',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...baseHeaders,
      'Access-Control-Max-Age': '600',
    },
  });
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const baid = searchParams.get('baid');

    if (!baid) {
      return new Response(JSON.stringify({ success: false, error: 'Missing baid' }), {
        status: 400,
        headers: baseHeaders,
      });
    }

    const orders = await prisma.erpOrderSummary.findMany({
      where: { baid, isActive: true },
      orderBy: { deliveryDate: 'asc' },
      include: { address: true, contact: true, payment: true, lines: true },
    });

    return new Response(JSON.stringify(orders), {
      status: 200,
      headers: baseHeaders,
    });
  } catch (e) {
    console.error('[orders GET] error:', e);
    return new Response(JSON.stringify({ success: false, error: e?.message || 'Server error' }), {
      status: 500,
      headers: baseHeaders,
    });
  }
}
