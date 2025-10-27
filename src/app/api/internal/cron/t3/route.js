import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { runT3 } from '@/lib/notifications/t3/run';

async function runCron(req) {
  const { searchParams } = new URL(req.url);
  if (!isCronAuthorized(req, searchParams)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  try {
    const now = new Date();
    const result = await runT3({ now });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function GET(req) {
  return runCron(req);   // ← Vercel scheduled GET runs the job
}

export async function POST(req) {
  return runCron(req);   // ← manual curl/Postman can POST w/ token
}
