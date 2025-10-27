// auth-api/lib/cors.js
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://mld-website-git-login-feature-jconte1s-projects.vercel.app',
  'https://mld.com',
  'https://www.mld.com',
];

export function corsHeaders(req) {
  const origin = req.headers?.get('origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    // include these two for correctness/caching:
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    // only add this if you actually use credentials (cookies/auth headers cross-site)
    // 'Access-Control-Allow-Credentials': 'true',
  };
}