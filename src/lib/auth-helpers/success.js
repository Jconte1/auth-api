export default function success(data = {}, status = 200) {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "http://localhost:3000", // <-- Add this
      },
    }
  );
}