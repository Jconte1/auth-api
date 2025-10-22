// app/api/me/route.js
import prisma from "@/lib/prisma/prisma";
import requireAuth from "../requireAuth.js/route";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://mld-website-git-login-feature-jconte1s-projects.vercel.app",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  // If you ever send cookies: "Access-Control-Allow-Credentials": "true",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req) {
  const auth = requireAuth(req);
  if (auth instanceof Response) {
    // Re-wrap auth failure with CORS headers so the browser sees them
    const body = await auth.text();
    return new Response(body, { status: auth.status, headers: CORS_HEADERS });
  }

  const { userId } = auth;

  try {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, baid: true },
    });

    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "NO_USER" }), {
        status: 404,
        headers: CORS_HEADERS,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        user: { id: user.id, email: user.email, name: user.name },
        baid: user.baid ?? null,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: "SERVER_ERROR" }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
