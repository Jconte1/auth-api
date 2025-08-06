export default function success(data = {}, status = 200) {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}