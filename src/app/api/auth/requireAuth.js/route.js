// src/lib/auth/requireAuth.js
import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";

export default function requireAuth(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

  if (!token) {
    return NextResponse.json({ success: false, error: "NO_AUTH" }, { status: 401 });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ success: false, error: "SERVER_MISCONFIG" }, { status: 500 });
  }

  try {
    const payload = jwt.verify(token, secret);
    const userId = payload?.userId || payload?.sub || payload?.id;
    if (!userId) {
      return NextResponse.json({ success: false, error: "BAD_AUTH_PAYLOAD" }, { status: 401 });
    }
    return { userId: String(userId), payload };
  } catch {
    return NextResponse.json({ success: false, error: "INVALID_TOKEN" }, { status: 401 });
  }
}
