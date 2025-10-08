// app/api/internal/cron/t42/route.js
import { NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/cron/auth';
import { runT42PrepareWrites } from '@/lib/notifications/t42/orchestrator';
import { runT42SendEmails } from '@/lib/notifications/t42/sender';
import { runT42Escalation } from '@/lib/notifications/t42/escalate';

export async function POST(req) {
  const { searchParams } = new URL(req.url);
  if (!isCronAuthorized(req, searchParams)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const now = new Date();
  const prepared = await runT42PrepareWrites({ now });
  const sent = await runT42SendEmails({ now });
  const escalated = await runT42Escalation({ now });

  return NextResponse.json({ ok: true, prepared, sent, escalated });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    phase: 'T42',
    message: 'POST (with cron auth) runs prepare + send + escalate.',
  });
}
