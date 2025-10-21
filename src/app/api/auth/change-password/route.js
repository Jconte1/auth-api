// app/api/auth/change-password/route.js
import prisma from "@/lib/prisma/prisma";
import argon2 from "argon2";
// NOTE: this route lives in /app/api/auth/change-password,
// so go up TWO levels to reach /app/api/requireAuth.js/route
import requireAuth from "../requireAuth.js/route";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3000",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Vary": "Origin",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req) {
  // Auth (reuse your helper and rewrap failures with CORS)
  const auth = requireAuth(req);
  if (auth instanceof Response) {
    const body = await auth.text();
    return new Response(body, { status: auth.status, headers: CORS_HEADERS });
  }
  const { userId } = auth;

  try {
    const { currentPassword, newPassword, confirmPassword } = await req.json();

    // Basic validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }
    if (newPassword !== confirmPassword) {
      return new Response(
        JSON.stringify({ ok: false, error: "Passwords do not match." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }
    if (newPassword.length < 8) {
      return new Response(
        JSON.stringify({ ok: false, error: "Password must be at least 8 characters." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Find credentials account
    const account = await prisma.accounts.findFirst({
      where: { userId, providerId: "credentials" },
      select: { id: true, password: true },
    });
    if (!account?.password) {
      return new Response(
        JSON.stringify({ ok: false, error: "No credentials account found." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Verify current password
    const valid = await argon2.verify(account.password, currentPassword);
    if (!valid) {
      return new Response(
        JSON.stringify({ ok: false, error: "Current password is incorrect." }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Hash & update
    const hashed = await argon2.hash(newPassword, { type: argon2.argon2id });
    await prisma.accounts.update({
      where: { id: account.id },
      data: { password: hashed, updatedAt: new Date() },
    });

    // (Optional) Invalidate other sessions/tokens here if you keep a sessions table

    return new Response(
      JSON.stringify({ ok: true, message: "Password updated." }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: "Failed to change password." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
