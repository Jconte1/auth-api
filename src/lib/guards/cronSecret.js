// backend: src/lib/guards/cronSecret.js
export default function guardCronSecret(req) {
  const header = req.headers.get('x-cron-key') || '';
  const url = new URL(req.url);
  const qp1 = url.searchParams.get('cron_secret') || '';
  const qp2 = url.searchParams.get('x-cron-key') || ''; // you’re using this
  const got = header || qp1 || qp2;
  return !!process.env.CRON_SECRET && got === process.env.CRON_SECRET;
}