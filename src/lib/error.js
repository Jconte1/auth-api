export default function error(error, status = 400) {
  return new Response(
    JSON.stringify({ success: false, error }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}