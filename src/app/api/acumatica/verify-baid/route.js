// src/app/api/acumatica/verify-baid/route.js
import { NextResponse } from "next/server";
import AcumaticaService from "@/lib/acumatica/auth/acumaticaService";
import fetchVerifiedData from "@/lib/acumatica/fetch/fetchVerifiedData";
import writeVerifiedBaid from "@/lib/acumatica/write/writeVerifiedData";
import prisma from "@/lib/prisma/prisma";

/** Simple bearer check: Authorization: Bearer <CRON_SECRET> */
function authOk(req) {
  const headerAuth = req.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(headerAuth || "")?.[1] || "";
  const env = (process.env.CRON_SECRET || "").trim();
  return !!env && bearer === env;
}

/** tiny validators (ZIP=5 digits, PHONE=10 digits, email basic) */
const isZip5 = (z) => /^[0-9]{5}$/.test(String(z || ""));
const isPhone10 = (p) => /^[0-9]{10}$/.test(String(p || ""));
const isEmail = (e) => {
  const s = String(e || "");
  if (s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
};

function genericFail() {
  return NextResponse.json(
    { ok: false, message: "We couldn’t confirm these details. Please contact your salesperson." },
    { status: 400 }
  );
}

export async function POST(req) {
  try {
    if (!authOk(req)) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Body must include all three — ZIP, EMAIL, PHONE — and userId to write BAID
    const body = await req.json().catch(() => ({}));
    const { userId, zip, email, phone } = body || {};

    if (!userId || !zip || !email || !phone) {
      return NextResponse.json(
        { message: "userId, zip, email, phone are required" },
        { status: 400 }
      );
    }
    if (!isZip5(zip))      return NextResponse.json({ message: "ZIP must be 5 digits" }, { status: 400 });
    if (!isPhone10(phone)) return NextResponse.json({ message: "Phone must be 10 digits" }, { status: 400 });
    if (!isEmail(email))   return NextResponse.json({ message: "Invalid email" }, { status: 400 });

    // Ensure the user exists & isn't already linked
    const user = await prisma.users.findUnique({
      where: { id: String(userId) },
      select: { id: true, baid: true },
    });
    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }
    if (user.baid) {
      return NextResponse.json({ message: "BAID already set" }, { status: 409 });
    }

    // ERP client
    const restService = new AcumaticaService(
      process.env.ACUMATICA_BASE_URL,
      process.env.ACUMATICA_CLIENT_ID,
      process.env.ACUMATICA_CLIENT_SECRET,
      process.env.ACUMATICA_USERNAME,
      process.env.ACUMATICA_PASSWORD
    );
    await restService.getToken();

    // Fetch candidates with the single OData filter you specified
    const rows = await fetchVerifiedData(restService, {
      zip: String(zip),
      email: String(email).trim().toLowerCase(),
      phone: String(phone),
    });

    // If empty → fail (this implies fewer than 2-of-3 matched, since filter is: zip AND (email OR phone))
    if (!Array.isArray(rows) || rows.length === 0) {
      return genericFail();
    }

    // Write the first CustomerID we see into users.baid (only if currently null)
    const write = await writeVerifiedBaid(String(userId), rows);
    if (!write.ok) {
      if (write.reason === "already-set") {
        return NextResponse.json({ message: "BAID already set" }, { status: 409 });
      }
      // We did get rows but didn't find a CustomerID field — treat as generic fail
      return genericFail();
    }

    return NextResponse.json({
      ok: true,
      baid: write.baid,
      message: "BAID verified and linked.",
    });
  } catch (e) {
    console.error("[verify-baid] error", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Use POST with JSON body." }, { status: 405 });
}
