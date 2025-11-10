export default function error(error, status = 400) {
  return new Response(
    JSON.stringify({ success: false, error }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        "Access-Control-Allow-Origin": "https://mld-website-git-login-feature-jconte1s-projects.vercel.app", // <-- Add this
      },
    }
  );
}
