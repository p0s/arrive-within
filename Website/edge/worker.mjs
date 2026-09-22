import {
  OPT_IN_PATH,
  OPT_OUT_PATH,
  analyticsConfig,
  preferenceResponse,
  queueIngest,
} from "../src/analytics.mjs";

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function responseWithSecurityHeaders(response, url) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set(
    "Referrer-Policy",
    url.pathname === "/privacy" || url.pathname === "/de/privacy" ? "same-origin" : "no-referrer",
  );
  if (url.pathname.startsWith("/assets/")) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function unavailableResponse() {
  return new Response("Static assets unavailable", {
    status: 503,
    headers: new Headers({
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Referrer-Policy": "no-referrer",
    }),
  });
}

export async function handleRequest(request, env = {}, context = {}) {
  const url = new URL(request.url);
  const config = analyticsConfig(env);

  if (url.pathname === OPT_OUT_PATH) return preferenceResponse(request, "out", config);
  if (url.pathname === OPT_IN_PATH) return preferenceResponse(request, "in", config);

  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") return unavailableResponse();

  let assetResponse;
  try {
    assetResponse = await env.ASSETS.fetch(request);
  } catch {
    return unavailableResponse();
  }

  const response = responseWithSecurityHeaders(assetResponse, url);
  queueIngest(request, context, config, response);
  return response;
}

export default { fetch: handleRequest };
