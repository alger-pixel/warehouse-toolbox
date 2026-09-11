const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export function allowedOrigins(env) {
  const configured = env && env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS : "https://alger-pixel.github.io";
  return new Set(String(configured).split(",").map((origin) => origin.trim()).filter(Boolean));
}
export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin"); const headers = { Vary: "Origin" };
  if (origin && allowedOrigins(env).has(origin)) { headers["Access-Control-Allow-Origin"] = origin; headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"; headers["Access-Control-Allow-Headers"] = "Content-Type, X-Request-ID, Authorization"; headers["Access-Control-Max-Age"] = "86400"; }
  return headers;
}
export function json(data, status, request, env) { return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...corsHeaders(request, env) } }); }
export function errorResponse(status, code, message, retryable, requestId, request, env, extra = {}) { return json({ ok: false, error: { code, message, retryable }, requestId, ...extra }, status, request, env); }
