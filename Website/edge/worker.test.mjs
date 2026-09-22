import assert from "node:assert/strict";

import worker, { handleRequest } from "./worker.mjs";

const baseEnv = {
  ANALYTICS_SITE_HOSTNAME: "arrivewithin.com",
  ANALYTICS_INGEST_URL: "https://stats.example.test/ingest/v1",
  ANALYTICS_INGEST_TOKEN: "site-token",
};

function request(path = "/", headers = {}, method = "GET") {
  return new Request(`https://arrivewithin.com${path}`, {
    method,
    headers: {
      Host: "arrivewithin.com",
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0",
      "CF-Connecting-IP": "203.0.113.4",
      "CF-IPCountry": "sg",
      ...headers,
    },
  });
}

function assetsResponse(status = 200, contentType = "text/html; charset=UTF-8") {
  return new Response("<!doctype html><main>Arrive Within</main>", {
    status,
    headers: { "Content-Type": contentType },
  });
}

const originalFetch = globalThis.fetch;
const seen = [];
globalThis.fetch = async (input, options) => {
  seen.push({ input: typeof input === "string" ? input : input.url, options });
  return new Response("accepted", { status: 204 });
};

try {
  const waits = [];
  const response = await handleRequest(
    request("/privacy", { Referer: "https://example.test/article?secret=removed" }),
    {
      ...baseEnv,
      ASSETS: { fetch: async () => assetsResponse() },
    },
    { waitUntil: (promise) => waits.push(promise) },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=UTF-8");
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
  assert.equal(waits.length, 1);
  await waits[0];
  assert.equal(seen.length, 1);
  assert.equal(seen[0].input, baseEnv.ANALYTICS_INGEST_URL);
  assert.equal(seen[0].options.headers.Authorization, `Bearer ${baseEnv.ANALYTICS_INGEST_TOKEN}`);
  assert.deepEqual(JSON.parse(seen[0].options.body), {
    hostname: "arrivewithin.com",
    path: "/privacy",
    referrer: "https://example.test",
    ip: "203.0.113.4",
    userAgent: "Mozilla/5.0",
    country: "SG",
  });

  const failedAsset = await handleRequest(
    request("/privacy"),
    { ...baseEnv, ASSETS: { fetch: async () => assetsResponse(500) } },
    { waitUntil: () => { throw new Error("500 responses must not queue analytics"); } },
  );
  assert.equal(failedAsset.status, 500);

  const nonHtml = await handleRequest(
    request("/privacy"),
    { ...baseEnv, ASSETS: { fetch: async () => assetsResponse(200, "application/json") } },
    { waitUntil: () => { throw new Error("non-HTML responses must not queue analytics"); } },
  );
  assert.equal(nonHtml.status, 200);

  for (const headers of [
    { DNT: "1" },
    { "Sec-GPC": "1" },
    { Cookie: "p0s_analytics_optout=1" },
  ]) {
    const excluded = await handleRequest(
      request("/privacy", headers),
      { ...baseEnv, ASSETS: { fetch: async () => assetsResponse() } },
      { waitUntil: () => { throw new Error("privacy exclusions must not queue analytics"); } },
    );
    assert.equal(excluded.status, 200);
  }

  const noSecrets = await handleRequest(
    request("/privacy"),
    { ANALYTICS_SITE_HOSTNAME: "arrivewithin.com", ASSETS: { fetch: async () => assetsResponse() } },
    { waitUntil: () => { throw new Error("missing ingest secrets must fail closed"); } },
  );
  assert.equal(noSecrets.status, 200);

  const crossOrigin = await handleRequest(
    request("/analytics/opt-out", { Origin: "https://attacker.example" }, "POST"),
    { ANALYTICS_SITE_HOSTNAME: "arrivewithin.com" },
    {},
  );
  assert.equal(crossOrigin.status, 403);

  const optOut = await handleRequest(
    request("/analytics/opt-out", { Origin: "https://arrivewithin.com", Referer: "https://arrivewithin.com/de/privacy" }, "POST"),
    { ANALYTICS_SITE_HOSTNAME: "arrivewithin.com" },
    {},
  );
  assert.equal(optOut.status, 200);
  assert.equal(optOut.headers.get("referrer-policy"), "same-origin");
  assert.match(optOut.headers.get("set-cookie"), /p0s_analytics_optout=1/);

  const wrongMethod = await handleRequest(
    request("/analytics/opt-in"),
    { ANALYTICS_SITE_HOSTNAME: "arrivewithin.com" },
    {},
  );
  assert.equal(wrongMethod.status, 403);

  assert.equal(worker.fetch, handleRequest);
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Cloudflare edge worker tests passed: successful HTML gating, minimization, exclusions, and native forms.");
