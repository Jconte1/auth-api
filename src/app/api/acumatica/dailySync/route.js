// src/app/api/acumatica/dailySync/route.js
import { NextResponse } from "next/server";
import AcumaticaService from "@/lib/acumatica/auth/acumaticaService";
import fetchDailySync from "@/lib/acumatica/fetch/fetchDailySync";
import writeDailySync from "@/lib/acumatica/write/writeDailySync";
import prisma from "@/lib/prisma/prisma";

/** helpers for safe logs */
const redact = (s) => {
  if (!s) return "";
  const str = String(s);
  if (str.length <= 8) return "***";
  return `${str.slice(0,4)}…${str.slice(-4)}`;
};
const getBearer = (h) => {
  const m = /^Bearer\s+(.+)$/i.exec(h || "");
  return m ? m[1].trim() : "";
};

/** Verbose auth that returns {ok, reason} and logs safely */
function authOkVerbose(req) {
  const headerAuth = req.headers.get("authorization") || "";
  const headerToken = getBearer(headerAuth);

  const { searchParams } = new URL(req.url);
  const queryToken = (searchParams.get("token") || "").trim();

  const envToken = (process.env.CRON_SECRET || "").trim();

  const headerMatch = headerToken && envToken && headerToken === envToken;
  const queryMatch  = queryToken && envToken && queryToken === envToken;

  console.log("[dailySync] auth check", {
    hasAuthorizationHeader: !!headerAuth,
    headerBearerRedacted: redact(headerToken),
    hasQueryToken: !!queryToken,
    queryTokenRedacted: redact(queryToken),
    hasEnvCronSecret: !!envToken,
    envCronSecretRedacted: redact(envToken),
    headerMatch,
    queryMatch,
  });

  if (headerMatch) return { ok: true, reason: "header" };
  if (queryMatch)  return { ok: true, reason: "query" };
  return { ok: false, reason: "no-match" };
}

/**
 * Return the datetimeoffset literal for the start of the last [3am,3am) window
 * in America/Denver.
 */
function denver3amWindowStartLiteral(now = new Date()) {
  const partsNow = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZoneName: "longOffset"
  }).formatToParts(now);

  const get = t => partsNow.find(p => p.type === t)?.value;
  const yyyy = get("year");
  const MM   = get("month");
  const dd   = get("day");
  const hh   = Number(get("hour"));
  const offset = (get("timeZoneName") || "").replace("GMT", "") || "+00:00";

  if (hh >= 3) {
    const lit = `${yyyy}-${MM}-${dd}T03:00:00${offset}`;
    console.log("[dailySync] sinceLiteral (today 3am Denver)", { sinceLiteral: lit });
    return lit;
  } else {
    const dateFor3am = new Date(`${yyyy}-${MM}-${dd}T03:00:00${offset}`);
    const yParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Denver",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(dateFor3am.getTime() - 24 * 3600 * 1000));
    const yY = yParts.find(p => p.type === "year")?.value;
    const yM = yParts.find(p => p.type === "month")?.value;
    const yD = yParts.find(p => p.type === "day")?.value;
    const lit = `${yY}-${yM}-${yD}T03:00:00${offset}`;
    console.log("[dailySync] sinceLiteral (yesterday 3am Denver)", { sinceLiteral: lit });
    return lit;
  }
}

export async function POST(req) {
  try {
    const { ok, reason } = authOkVerbose(req);
    if (!ok) {
      console.warn("[dailySync] 401 from route guard", { reason });
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

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

    console.log("[dailySync] resolved BAIDs", { baids });

    if (!baids.length) {
      return NextResponse.json(
        { message: "No BAID(s) resolved." },
        { status: 400 }
      );
    }

    const restService = new AcumaticaService(
      process.env.ACUMATICA_BASE_URL,
      process.env.ACUMATICA_CLIENT_ID,
      process.env.ACUMATICA_CLIENT_SECRET,
      process.env.ACUMATICA_USERNAME,
      process.env.ACUMATICA_PASSWORD
    );

    try {
      await restService.getToken();
      console.log("[dailySync] Acumatica token acquired");
    } catch (e) {
      console.error("[dailySync] 401 (or other) while acquiring Acumatica token", {
        error: String(e?.message || e)
      });
      return NextResponse.json({ message: "Upstream auth error" }, { status: 502 });
    }

    const sinceLiteral = denver3amWindowStartLiteral();

    const results = [];
    for (const baid of baids) {
      console.log("[dailySync] fetching", { baid, sinceLiteral });
      const rows = await fetchDailySync(restService, baid, { sinceLiteral });
      console.log("[dailySync] fetched rows", { baid, count: rows.length });
      const writeResult = await writeDailySync(baid, rows);
      results.push({ baid, fetched: rows.length, ...writeResult });
    }

    return NextResponse.json({ count: results.length, results });
  } catch (e) {
    console.error("dailySync POST error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const { ok, reason } = authOkVerbose(req);
    if (!ok) {
      console.warn("[dailySync] 401 from route guard (GET)", { reason });
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    // Proxy to POST while preserving ?userId=/ ?email= in the URL; if none → all BAIDs path runs
    return POST(new Request(req.url, { method: "POST", headers: req.headers }));
  } catch (e) {
    console.error("dailySync GET error:", e);
    return NextResponse.json({ message: "Server error", error: String(e?.message || e) }, { status: 500 });
  }
}
