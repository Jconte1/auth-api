import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function corsHeaders(req) {
  const origin = req.headers.get("origin") || "";
  const allow =
    origin === (process.env.FRONTEND_URL || "http://localhost:3000")
      ? origin
      : ""; // echo only allowed origin
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

export async function OPTIONS(req) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const baid = searchParams.get("baid");
    if (!baid) {
      return new Response(JSON.stringify({ success: false, error: "Missing baid" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(req) },
      });
    }

    const orders = await prisma.erpOrderSummary.findMany({
      where: { baid, isActive: true },
      include: { address: true, contact: true, payment: true, lines: true },
    });

    return new Response(JSON.stringify(orders), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e?.message || "Server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  }
}
