import assert from "node:assert/strict";

import {
  OPT_IN_PATH,
  OPT_OUT_PATH,
  analyticsConfig,
  isEligiblePageRequest,
  payloadForRequest,
  preferenceResponse,
  queueIngest,
} from "../src/analytics.mjs";

const config = analyticsConfig({
  ANALYTICS_SITE_HOSTNAME: "arrivewithin.com",
  ANALYTICS_INGEST_URL: "https://stats.example.test/ingest/v1",
  ANALYTICS_INGEST_TOKEN: "site-token",
});

function request(path, headers = {}, method = "GET") {
  return new Request(`https://arrivewithin.com${path}`, {
    method,
    headers: {
      Host: "arrivewithin.com",
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0",
      "X-Vercel-Forwarded-For": "203.0.113.4",
      ...headers,
    },
  });
}

assert.equal(isEligiblePageRequest(request("/privacy"), config), true);
assert.deepEqual(payloadForRequest(request("/privacy?utm_source=ignored", {
  Referer: "https://example.test/article?secret=removed",
  "X-Vercel-IP-Country": "sg",
})), {
  hostname: "arrivewithin.com",
  path: "/privacy",
  referrer: "https://example.test",
  ip: "203.0.113.4",
  userAgent: "Mozilla/5.0",
  country: "SG",
});

for (const [path, headers] of [
  ["/assets/site.css", {}],
  ["/privacy/", {}],
  ["/privacy", { DNT: "1" }],
  ["/privacy", { "Sec-GPC": "1" }],
  ["/privacy", { Purpose: "prefetch" }],
  ["/privacy", { Cookie: "p0s_analytics_optout=1" }],
  ["/privacy", { "X-Vercel-Forwarded-For": "" }],
  ["/privacy", { "User-Agent": "Googlebot/2.1" }],
]) {
  assert.equal(isEligiblePageRequest(request(path, headers), config), false, `${path} should be excluded`);
}

const invalidPreference = await preferenceResponse(
  request(OPT_OUT_PATH, { Origin: "https://attacker.example" }, "POST"),
  "out",
  config,
);
assert.equal(invalidPreference.status, 403);

const optOut = await preferenceResponse(
  request(OPT_OUT_PATH, { Origin: "https://arrivewithin.com", Referer: "https://arrivewithin.com/de/privacy" }, "POST"),
  "out",
  config,
);
assert.equal(optOut.status, 200);
assert.equal(optOut.headers.get("referrer-policy"), "same-origin");
assert.match(optOut.headers.get("set-cookie"), /p0s_analytics_optout=1/);
assert.match(optOut.headers.get("set-cookie"), /Secure; HttpOnly; SameSite=Lax/);
assert.doesNotMatch(optOut.headers.get("set-cookie"), /Domain=/i);
assert.match(await optOut.text(), /\/de\/privacy/);

const optIn = await preferenceResponse(
  request(OPT_IN_PATH, { Origin: "https://arrivewithin.com" }, "POST"),
  "in",
  config,
);
assert.equal(optIn.status, 200);
assert.match(optIn.headers.get("set-cookie"), /Max-Age=0/);

const originalFetch = globalThis.fetch;
let waited;
globalThis.fetch = async () => {
  throw new Error("collector unavailable");
};
try {
  assert.equal(queueIngest(request("/"), { waitUntil: (promise) => { waited = promise; } }, config), true);
  await assert.doesNotReject(waited);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Website analytics tests passed: allowlist, minimization, exclusions, and privacy preference boundaries.");
