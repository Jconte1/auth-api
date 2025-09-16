// src/lib/cron/auth.js
export function isCronAuthorized(req, searchParams) {
  const headerAuth = req.headers.get("authorization") || "";
  const queryToken = searchParams.get("token") || "";
  const fromVercelCron = req.headers.get("x-vercel-cron") === "1";
  return (
    fromVercelCron ||
    headerAuth === `Bearer ${process.env.CRON_SECRET}` ||
    (queryToken && queryToken === process.env.CRON_SECRET)
  );
}