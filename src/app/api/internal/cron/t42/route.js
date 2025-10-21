// app/api/internal/cron/t42/route.js
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron/auth';
import { runT42 } from '@/lib/notifications/t42/run';

export async function POST(req) {
  const { searchParams } = new URL(req.url);
  if (!isCronAuthorized(req, searchParams)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const now = new Date();
    const result = await runT42({ now });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    phase: 'T42',
    message: 'POST (with cron auth) runs the single-pass T42 flow (attempts, resets, escalation).',
  });
}
