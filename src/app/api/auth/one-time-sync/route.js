// src/app/api/auth/one-time-sync/route.js
import { NextResponse } from "next/server";
import requireAuth from "../requireAuth.js/route";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req) {
  // must be logged in (JWT)
  const auth = requireAuth(req);
  if (auth instanceof Response) {
    const body = await auth.text();
    return new Response(body, { status: auth.status, headers: CORS_HEADERS });
  }

  const { userId } = auth;

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  const baid = String(body?.baid || "");
  const run = Array.isArray(body?.run) ? body.run : ["order-summaries","payment-info","inventory-details","address-contact"];
  const dryRun = Boolean(body?.dryRun === true ? true : false);

  if (!email || !baid) {
    return new Response(JSON.stringify({ message: "Provide email and baid in body." }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) {
    return new Response(JSON.stringify({ message: "Server misconfig" }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }

  const target = new URL("/api/acumatica/one-time-sync", req.url).toString();
  const upstream = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ userId, email, baid, run, dryRun }),
  });

  const text = await upstream.text();
  return new Response(text, { status: upstream.status, headers: CORS_HEADERS });
}

export function GET() {
  return new Response(
    JSON.stringify({ message: "Use POST with JSON body." }),
    { status: 405, headers: CORS_HEADERS }
  );
}
