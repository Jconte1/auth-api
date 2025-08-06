// src/lib/cors.js

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "http://localhost:3000", // <-- update as needed
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function withCORSResponse(res, status = 200) {
  // res: Response or data to wrap as a Response
  if (res instanceof Response) {
    // clone with CORS headers merged in
    const headers = new Headers(res.headers);
    Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
    return new Response(res.body, { ...res, headers, status });
  }
  // wrap raw data as JSON with CORS
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function corsOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
