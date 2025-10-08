// src/app/api/acumatica/one-time-sync/route.js
import { NextResponse } from "next/server";

function authOk(req) {
  const headerAuth = req.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(headerAuth || "")?.[1] || "";
  const env = (process.env.CRON_SECRET || "").trim();
  return !!env && bearer === env;
}

// Small helper to resolve our own base URL for internal fetches
function baseUrl(req) {
  // Prefer env in dev; fall back to request origin
  const envBase = process.env.NEXT_PUBLIC_BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, "");
  const { origin } = new URL(req.url);
  return origin;
}

export async function POST(req) {
  try {
    if (!authOk(req)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { userId, email, baid, run = ["order-summaries","payment-info","inventory-details","address-contact"] } = body;

    if (!email || !baid) {
      return NextResponse.json({ message: "Provide email and baid in body." }, { status: 400 });
    }

    const base = baseUrl(req);
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.CRON_SECRET}`,
    };

    // Map route keys → endpoint paths
    const endpoints = {
      "order-summaries": "/api/acumatica/ingest-order-summaries",
      "payment-info": "/api/acumatica/ingest-payment-info",
      "inventory-details": "/api/acumatica/ingest-inventory-details",
      "address-contact": "/api/acumatica/ingest-address-contact",
    };

    // Only keep valid tasks
    const tasks = run.filter(k => endpoints[k]);

    // Call each route (sequential to be gentle with ERP; change to Promise.allSettled if you want parallel)
    const results = [];
    for (const key of tasks) {
      const url = `${base}${endpoints[key]}`;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ userId, email, baid }),
      }).catch(err => ({ ok: false, status: 0, json: async () => ({ message: String(err) }) }));

      let json;
      try { json = await res.json(); } catch { json = { message: "No JSON body" }; }

      results.push({
        route: key,
        status: res.status || 0,
        ok: res.ok === true,
        body: json,
      });
    }

    return NextResponse.json({ count: results.length, results });
  } catch (e) {
    console.error("one-time-sync POST error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Use POST with JSON body." }, { status: 405 });
}
