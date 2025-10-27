export default function error(error, status = 400) {
  return new Response(
    JSON.stringify({ success: false, error }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        "Access-Control-Allow-Origin": "http://localhost:3000", // <-- Add this
      },
    }
  );
}
