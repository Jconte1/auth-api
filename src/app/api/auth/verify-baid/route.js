// src/app/api/auth/verify-baid/route.js
import { NextResponse } from "next/server";
import requireAuth from "../requireAuth.js/route"; // same import style as your /auth/me route

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://mld-website-git-login-feature-jconte1s-projects.vercel.app",
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
    // re-wrap auth failure with CORS so the browser sees headers
    const body = await auth.text();
    return new Response(body, { status: auth.status, headers: CORS_HEADERS });
  }

  const { userId } = auth;

  // read client payload
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  const zip   = String(body?.zip   || "");
  const phone = String(body?.phone || "");

  // minimal presence check (full validation remains in /acumatica/verify-baid)
  if (!email || !zip || !phone) {
    return new Response(
      JSON.stringify({ message: "email, zip, phone are required" }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) {
    return new Response(
      JSON.stringify({ message: "Server misconfig" }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // forward to your existing protected endpoint (server-side adds CRON secret)
  const target = new URL("/api/acumatica/verify-baid", req.url).toString();
  const upstream = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ userId, email, zip, phone }),
  });

  const text = await upstream.text(); // pass through body as-is
  return new Response(text, {
    status: upstream.status,
    headers: CORS_HEADERS,
  });
}

export function GET() {
  return new Response(
    JSON.stringify({ message: "Use POST with JSON body." }),
    { status: 405, headers: CORS_HEADERS }
  );
}
