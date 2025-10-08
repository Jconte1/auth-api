// backend: app/api/devices/register/route.js
import { NextResponse } from 'next/server';
import notifsEnabled from '@/config/notifs.js';
import prisma from '@/lib/prisma/prisma.js';
import requireAuth from '../../auth/requireAuth.js/route';

export async function POST(req) {
  if (!notifsEnabled()) {
    return NextResponse.json({ ok: false, reason: 'NOTIFS_DISABLED' }, { status: 503 });
  }

  // auth (expects your requireAuth to return { userId } or a NextResponse)
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  const { userId } = auth;

  // input
  const body = await req.json().catch(() => ({}));
  const { platform, pushToken } = body || {};
  if (platform !== 'ios' && platform !== 'android') {
    return NextResponse.json({ ok: false, error: 'INVALID_PLATFORM' }, { status: 400 });
  }
  if (!pushToken || typeof pushToken !== 'string' || pushToken.length < 10) {
    return NextResponse.json({ ok: false, error: 'INVALID_TOKEN' }, { status: 400 });
  }

  // upsert by unique pushToken; (re)link to the current user and activate
  await prisma.device.upsert({
    where: { pushToken },
    update: { userId, platform, lastSeenAt: new Date(), isActive: true },
    create: { userId, platform, pushToken },
  });

  return NextResponse.json({ ok: true, saved: true });
}
