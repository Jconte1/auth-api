// auth-api/lib/cors.js
export const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  // preview domain(s):
  "https://mld-website-git-login-feature-jconte1s-projects.vercel.app",
  // prod domains:
  "https://mld.com",
  "https://www.mld.com",
];

export function corsHeadersFor(req, { withCredentials = false } = {}) {
  const origin = req.headers.get?.("origin") || req.headers.origin || "";
  const allow = allowedOrigins.includes(origin) ? origin : "";
  const headers = {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
  if (withCredentials) headers["Access-Control-Allow-Credentials"] = "true";
  return headers;
}
