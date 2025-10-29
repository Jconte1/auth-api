export default function success(data = {}, status = 200) {
  return new Response(
    JSON.stringify({ success: true, ...data }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        "Access-Control-Allow-Origin": "https://mld-website-git-login-feature-jconte1s-projects.vercel.app", //http://localhost:3000
      },
    }
  );
}