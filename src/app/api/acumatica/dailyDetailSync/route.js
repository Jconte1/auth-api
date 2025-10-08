// src/app/api/acumatica/dailyDetailSync/route.js
import { NextResponse } from "next/server";
import AcumaticaService from "@/lib/acumatica/auth/acumaticaService";
import fetchDailySync from "@/lib/acumatica/fetch/fetchDailySync";
import fetchDailyDetailSync from "@/lib/acumatica/fetch/fetchDailyDetailSync";
import writeDailyDetailSync from "@/lib/acumatica/write/writeDailyDetailSync";
import prisma from "@/lib/prisma/prisma";

/* auth: header Bearer or ?token= */
function authOk(req) {
  const headerAuth = req.headers.get("authorization") || "";
  const { searchParams } = new URL(req.url);
  const queryToken = (searchParams.get("token") || "").trim();
  const env = (process.env.CRON_SECRET || "").trim();
  const bearer = /^Bearer\s+(.+)$/i.exec(headerAuth || "")?.[1] || "";
  return (env && bearer === env) || (env && queryToken === env);
}

/* start of last [3am,3am) window in Denver, output as datetimeoffset literal */
function denver3amWindowStartLiteral(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "longOffset"
  }).formatToParts(now);
  const v = t => parts.find(p => p.type === t)?.value;
  const yyyy = v("year"), MM = v("month"), dd = v("day");
  const hh = Number(v("hour"));
  const offset = (v("timeZoneName") || "").replace("GMT", "") || "+00:00";
  if (hh >= 3) return `${yyyy}-${MM}-${dd}T03:00:00${offset}`;
  const today3 = new Date(`${yyyy}-${MM}-${dd}T03:00:00${offset}`);
  const yParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(today3.getTime() - 24*3600*1000));
  const yY = yParts.find(p=>p.type==="year")?.value;
  const yM = yParts.find(p=>p.type==="month")?.value;
  const yD = yParts.find(p=>p.type==="day")?.value;
  return `${yY}-${yM}-${yD}T03:00:00${offset}`;
}

export async function POST(req) {
  try {
    if (!authOk(req)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

    // NEW: resolve single user by query… or default to ALL users with a BAID when none given
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId") || null;
    const email  = searchParams.get("email")  || null;

    let baids = [];

    if (userId || email) {
      const baid = userId
        ? (await prisma.users.findUnique({ where: { id: userId }, select: { baid: true } }))?.baid
        : (await prisma.users.findUnique({ where: { email }, select: { baid: true } }))?.baid;
      if (baid) baids = [baid];
    } else {
      const rows = await prisma.users.findMany({
        where: { baid: { not: null } },
        select: { baid: true },
      });
      const seen = new Set();
      for (const r of rows) if (r.baid && !seen.has(r.baid)) { seen.add(r.baid); baids.push(r.baid); }
    }

    if (!baids.length) return NextResponse.json({ message: "No BAID(s) resolved." }, { status: 400 });

    const rest = new AcumaticaService(
      process.env.ACUMATICA_BASE_URL,
      process.env.ACUMATICA_CLIENT_ID,
      process.env.ACUMATICA_CLIENT_SECRET,
      process.env.ACUMATICA_USERNAME,
      process.env.ACUMATICA_PASSWORD
    );
    await rest.getToken();

    const sinceLiteral = denver3amWindowStartLiteral();
    const results = [];

    for (const baid of baids) {
      // 1) headers changed since 3am → orderNbr list
      const headerRows = await fetchDailySync(rest, baid, { sinceLiteral });
      const orderNbrs = headerRows.map(r => r?.OrderNbr?.value).filter(Boolean);
      if (!orderNbrs.length) {
        results.push({ baid, fetchedHeaders: headerRows.length, fetchedDetails: 0, ordersAffected: 0, linesInserted: 0 });
        continue;
      }

      // 2) fetch details for those orders
      const detailRows = await fetchDailyDetailSync(rest, baid, orderNbrs);

      // 3) write lines (delete + insert)
      const write = await writeDailyDetailSync(baid, detailRows);

      results.push({
        baid,
        fetchedHeaders: headerRows.length,
        fetchedDetails: detailRows.length,
        ...write,
      });
    }

    return NextResponse.json({ count: results.length, results });
  } catch (e) {
    console.error("dailyDetailSync POST error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    if (!authOk(req)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    // Proxy to POST while preserving ?userId=/ ?email=; if none → all BAIDs path runs
    return POST(new Request(req.url, { method: "POST", headers: req.headers }));
  } catch (e) {
    console.error("dailyDetailSync GET error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}
