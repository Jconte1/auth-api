// src/lib/cron/auth.js
// Accept Vercel Cron header OR our existing token/Bearer
export function isCronAuthorized(req, searchParams) {
  const headerAuth = req.headers.get("authorization") || "";
  const queryToken = (searchParams?.get("token") || "").trim();
  const fromVercelCron = req.headers.get("x-vercel-cron") === "1";
  return (
    fromVercelCron ||
    headerAuth === `Bearer ${process.env.CRON_SECRET}` ||
    (queryToken && queryToken === process.env.CRON_SECRET)
  );
}
