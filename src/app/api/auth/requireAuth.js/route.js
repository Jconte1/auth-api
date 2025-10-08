// backend: src/lib/auth/requireAuth.js
import jwt from 'jsonwebtoken';
import { NextResponse } from 'next/server';

export default function requireAuth(req) {
  const hdr = req.headers.get('authorization') || '';
  const m = hdr.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : '';

  if (!token) {
    console.warn('[auth] NO_AUTH: missing Authorization header or Bearer token. hdr=', hdr);
    return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });
  }

  if (!process.env.JWT_SECRET) {
    console.error('[auth] CONFIG_ERROR: JWT_SECRET is missing in env');
    return NextResponse.json({ ok: false, error: 'SERVER_MISCONFIG' }, { status: 500 });
  }

  const redact = (t) => (t.length > 24 ? `${t.slice(0, 12)}...${t.slice(-6)}` : '[short-token]');
  const redactedToken = redact(token);

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Accept multiple possible claim names for backward compatibility
    const userId =
      payload?.sub ||
      payload?.id ||
      payload?.userId || // <- your current tokens use this
      null;

    if (!userId) {
      console.error(
        '[auth] BAD_AUTH_PAYLOAD: verified but missing user id. payload keys=',
        Object.keys(payload || {})
      );
      return NextResponse.json({ ok: false, error: 'BAD_AUTH_PAYLOAD' }, { status: 401 });
    }

    // console.log('[auth] OK userId=', userId, 'token=', redactedToken);
    return { userId: String(userId), payload };
  } catch (err) {
    console.error('[auth] INVALID_TOKEN:', err?.name, err?.message, 'token=', redactedToken);
    return NextResponse.json({ ok: false, error: 'INVALID_TOKEN' }, { status: 401 });
  }
}
