// backend: app/api/me/route.js
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma/prisma';
import requireAuth from '../requireAuth.js/route';

export async function GET(req) {
  const auth = requireAuth(req);
  if (auth instanceof Response) return auth; // 401/403 if not authorized
  const { userId } = auth;

  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, error: 'NO_USER' }, { status: 404 });
  }

  const rows = await prisma.accountUserRole.findMany({
    where: { userId, isActive: true },
    select: { baid: true, role: true },
    orderBy: [{ baid: 'asc' }],
  });

  // Fold roles by BAID: [{ baid, roles: ['ADMIN','PM'] }, ...]
  const byBaid = new Map();
  for (const r of rows) {
    if (!byBaid.has(r.baid)) byBaid.set(r.baid, new Set());
    byBaid.get(r.baid).add(r.role);
  }
  const baids = Array.from(byBaid.entries()).map(([baid, set]) => ({
    baid, roles: Array.from(set),
  }));

  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name },
    baids,
  });
}
