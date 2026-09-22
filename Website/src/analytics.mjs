export const PUBLIC_HTML_PATHS = new Set([
  "/",
  "/de",
  "/support",
  "/de/support",
  "/privacy",
  "/de/privacy",
  "/open-source",
  "/de/open-source",
]);

export const OPT_OUT_PATH = "/analytics/opt-out";
export const OPT_IN_PATH = "/analytics/opt-in";
export const OPT_OUT_COOKIE = "p0s_analytics_optout";

const BOT_USER_AGENT = /(?:bot|crawler|spider|slurp|bingpreview|facebookexternalhit|twitterbot|linkedinbot|petalbot|semrush|ahrefs|bytespider|headlesschrome|lighthouse)/i;
const PREFETCH_HEADER = /(?:prefetch|prerender)/i;

export function analyticsConfig(env = globalThis.process?.env ?? {}) {
  return {
    hostname: normalizeHostname(env.ANALYTICS_SITE_HOSTNAME),
    ingestURL: env.ANALYTICS_INGEST_URL?.trim() || "",
    ingestToken: env.ANALYTICS_INGEST_TOKEN?.trim() || "",
  };
}

export function isEligiblePageRequest(request, config) {
  // Routing Middleware runs before Vercel resolves the static response/cache and
  // has no post-response status hook. The finite production route allowlist is
  // therefore the no-origin-fetch guard for known HTML documents.
  if (!config?.hostname || !config.ingestURL || !config.ingestToken) return false;
  const url = new URL(request.url);
  const hostname = requestHostname(request);
  if (hostname !== config.hostname || hostname.length > 253 || request.method.toUpperCase() !== "GET") return false;
  if (!PUBLIC_HTML_PATHS.has(url.pathname) || (url.pathname !== "/" && url.pathname.endsWith("/"))) return false;
  if (hasOptOutCookie(request.headers.get("cookie"))) return false;
  if (request.headers.get("dnt")?.trim() === "1" || request.headers.get("sec-gpc")?.trim() === "1") return false;
  if (isPrefetch(request.headers)) return false;

  const accept = request.headers.get("accept")?.toLowerCase();
  if (accept && !accept.includes("text/html") && !accept.includes("*/*")) return false;
  const userAgent = request.headers.get("user-agent")?.trim() || "";
  if (!userAgent || userAgent.length > 512 || BOT_USER_AGENT.test(userAgent)) return false;
  if (!trustedClientIP(request)) return false;
  return isHTTPSURL(config.ingestURL);
}

export function payloadForRequest(request) {
  const url = new URL(request.url);
  const payload = {
    hostname: requestHostname(request),
    path: url.pathname,
    ip: trustedClientIP(request),
    userAgent: request.headers.get("user-agent")?.trim() || "",
  };
  const referrer = referrerOrigin(request.headers.get("referer"));
  const country = countryCode(request.headers.get("x-vercel-ip-country"));
  if (referrer) payload.referrer = referrer;
  if (country) payload.country = country;
  return payload;
}

export function preferenceResponse(request, action, config) {
  if (!config?.hostname || requestHostname(request) !== config.hostname) {
    return new Response("Not found", { status: 404, headers: responseHeaders() });
  }
  if (request.method.toUpperCase() !== "POST" || !sameOriginPost(request)) {
    return new Response("Invalid request", { status: 403, headers: responseHeaders() });
  }
  const isOptOut = action === "out";
  const returnPath = returnPrivacyPath(request.headers.get("referer"));
  const headers = responseHeaders();
  headers.set(
    "Set-Cookie",
    isOptOut
      ? `${OPT_OUT_COOKIE}=1; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax`
      : `${OPT_OUT_COOKIE}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure; HttpOnly; SameSite=Lax`,
  );
  return new Response(
    isOptOut
      ? `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Analytics preference saved</title></head><body><main><h1>Analytics preference saved</h1><p>Future page requests from this browser will be excluded from the website request count.</p><p><a href="${returnPath}">Return to privacy</a></p></main></body></html>`
      : `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Analytics preference restored</title></head><body><main><h1>Analytics preference restored</h1><p>Future eligible page requests from this browser may be included in the website request count.</p><p><a href="${returnPath}">Return to privacy</a></p></main></body></html>`,
    { status: 200, headers },
  );
}

export function queueIngest(request, context, config) {
  if (!isEligiblePageRequest(request, config)) return false;
  const promise = sendIngest(payloadForRequest(request), config);
  if (typeof context?.waitUntil === "function") {
    context.waitUntil(promise);
  }
  return true;
}

function sendIngest(payload, config) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  return fetch(config.ingestURL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.ingestToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .catch(() => undefined)
    .finally(() => clearTimeout(timeout));
}

function requestHostname(request) {
  return normalizeHostname(request.headers.get("host"));
}

function normalizeHostname(value) {
  return value?.trim().toLowerCase().replace(/:\d+$/, "") || "";
}

function isHTTPSURL(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function trustedClientIP(request) {
  const value = request.headers.get("x-vercel-forwarded-for")?.trim() || "";
  if (!value || value.includes(",") || value.length > 64) return null;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    return value.split(".").every((part) => Number(part) <= 255) ? value : null;
  }
  return /^[0-9a-f:.]+$/i.test(value) && value.includes(":") ? value : null;
}

function countryCode(value) {
  const country = value?.trim().toUpperCase() || "";
  return /^[A-Z]{2}$/.test(country) ? country : undefined;
}

function referrerOrigin(value) {
  if (!value?.trim() || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const origin = url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
    return origin && origin.length <= 255 ? origin : undefined;
  } catch {
    return undefined;
  }
}

function hasOptOutCookie(value) {
  return value?.split(";").some((part) => part.trim() === `${OPT_OUT_COOKIE}=1`) ?? false;
}

function isPrefetch(headers) {
  for (const name of ["purpose", "sec-purpose", "x-purpose", "x-middleware-prefetch"]) {
    if (PREFETCH_HEADER.test(headers.get(name) || "")) return true;
  }
  return headers.has("next-router-prefetch");
}

function sameOriginPost(request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin")?.trim();
  if (origin) return origin === expected;
  const referer = request.headers.get("referer")?.trim();
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function returnPrivacyPath(value) {
  try {
    const pathname = new URL(value || "https://invalid.example").pathname;
    return pathname === "/de/privacy" ? pathname : "/privacy";
  } catch {
    return "/privacy";
  }
}

function responseHeaders() {
  return new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
}
