// src/lib/cron/auth.js
export function isCronAuthorized(req, searchParams) {
  const headerAuth = req.headers.get("authorization") || "";
  const queryToken = searchParams.get("token") || "";
  const okByHeader = headerAuth === `Bearer ${process.env.CRON_SECRET}`;
  const okByQuery  = queryToken && queryToken === process.env.CRON_SECRET;
  return okByHeader || okByQuery;
}
