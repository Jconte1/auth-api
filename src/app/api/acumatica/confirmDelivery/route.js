/* app/api/acumatica/confirmDelivery/route.js */

import { NextResponse } from "next/server";
import { WriteT42Confirm } from "@/lib/acumatica/confirmations";
import { writeT42Note } from "@/lib/acumatica/confirmations";
import writeConfirmOrder from "@/lib/acumatica/write/writeConfirmOrder";

// Helper to build CORS headers
function corsHeaders(origin) {
  const allowOrigin = origin || "http://localhost:3000";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
    "Vary": "Origin",
  };
}

export async function OPTIONS(req) {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req) {
  const origin = req.headers.get("origin");

  try {
    const idem =
      req.headers.get("idempotency-key") ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const body = await req.json().catch(() => ({}));
    const orderNumber   = String(body.orderNumber || "").trim();
    const confirmedVia  = String(body.confirmedVia || "email response").trim();
    const confirmedWith = String(body.confirmedWith || "").trim();
    const noteId = String(body.noteId || "").trim();
    if (!orderNumber) {
      return new NextResponse(
        JSON.stringify({ ok: false, error: "orderNumber is required" }),
        { status: 400, headers: corsHeaders(origin) }
      );
    }
    if (!confirmedWith) {
      return new NextResponse(
        JSON.stringify({ ok: false, error: "confirmedWith (jobsite name) is required" }),
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // 1) Write to ERP (authoritative system of record)
    const erpResult = await WriteT42Confirm({
      orderNbr: orderNumber,
      confirmVia: confirmedVia,
      confirmWth: confirmedWith,
    });

    // 2) Write to note to ERP 
    const erpNoteResult = await writeT42Note({
      noteID: noteId,
    })


    // 3) Best-effort mirror into your DB
    let dbResult;
    try {
      dbResult = await writeConfirmOrder({
        orderNbr: orderNumber,
        confirmedVia,
        confirmedWith,
      });
    } catch (dbErr) {
      dbResult = { ok: false, reason: dbErr?.message || "db-write-exception" };
    }

    return new NextResponse(
      JSON.stringify({
        ok: true,
        idempotencyKey: idem,
        orderNumber,
        confirmedVia,
        confirmedWith,
        erpResult,  // Optional to keep for debugging
        dbResult,   // Inspect this in logs/metrics; front-end can ignore
        erpNoteResult,
      }),
      { status: 200, headers: corsHeaders(origin) }
    );
  } catch (err) {
    const status = err?.status || 500;
    const msg = err?.message || "Internal Server Error";
    return new NextResponse(
      JSON.stringify({ ok: false, error: msg }),
      { status, headers: corsHeaders(origin) }
    );
  }
}
