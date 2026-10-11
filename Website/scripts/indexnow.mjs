import { createHash } from "node:crypto";

export const PUBLIC_ORIGIN = "https://arrivewithin.com";
export const PUBLIC_HOST = "arrivewithin.com";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const MAX_SITEMAP_URLS = 100;
export const MAX_NOTIFICATION_URLS = 100;
export const REQUEST_TIMEOUT_MS = 12_000;
export const MAX_SITEMAP_BYTES = 1_000_000;
export const MAX_ROBOTS_BYTES = 64_000;
export const MAX_HTML_BYTES = 2_000_000;

const PRIVATE_PATH_SEGMENTS = new Set([
  "account",
  "admin",
  "analytics",
  "api",
  "auth",
  "checkout",
  "internal",
  "login",
  "private",
]);

function decodeXmlText(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function validatePublicURL(value, origin = PUBLIC_ORIGIN) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`sitemap contains an invalid URL: ${value}`);
  }

  if (
    url.protocol !== "https:"
    || url.origin !== origin
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.href !== value
  ) {
    throw new Error(`sitemap URL must be a canonical same-host HTTPS URL without query or fragment: ${value}`);
  }

  const segments = url.pathname.split("/").filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment).toLowerCase();
    } catch {
      throw new Error(`sitemap URL has an invalid encoded path: ${value}`);
    }
  });
  if (segments.some((segment) => PRIVATE_PATH_SEGMENTS.has(segment))) {
    throw new Error(`sitemap URL uses a private or service path: ${value}`);
  }

  return url;
}

export function parsePublicSitemap(xml, origin = PUBLIC_ORIGIN) {
  if (Buffer.byteLength(xml, "utf8") > MAX_SITEMAP_BYTES) throw new Error("sitemap exceeds the bounded response size");
  if (/<!doctype|<!entity/i.test(xml)) throw new Error("sitemap declarations are not allowed");
  if (!/<urlset\b[^>]*xmlns=["']http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9["'][^>]*>/i.test(xml)) {
    throw new Error("expected a standard sitemap urlset");
  }

  const entries = [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)];
  if (!entries.length || entries.length > MAX_SITEMAP_URLS) {
    throw new Error(`sitemap must contain between 1 and ${MAX_SITEMAP_URLS} page URLs`);
  }

  const urls = [];
  const seen = new Set();
  for (const [, entry] of entries) {
    // A direct <loc> is the page URL. Namespaced <image:loc> values are ignored.
    const locations = [...entry.matchAll(/<loc>([^<]+)<\/loc>/gi)];
    if (locations.length !== 1) throw new Error("each sitemap url entry must contain one page loc");
    const value = decodeXmlText(locations[0][1].trim());
    validatePublicURL(value, origin);
    if (seen.has(value)) throw new Error(`sitemap contains a duplicate page URL: ${value}`);
    seen.add(value);
    urls.push(value);
  }

  return urls;
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function robotsPatternMatches(pattern, path) {
  const anchoredAtEnd = pattern.endsWith("$");
  const source = (anchoredAtEnd ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map(escapeRegExp)
    .join(".*");
  return new RegExp(`^${source}${anchoredAtEnd ? "$" : ""}`).test(path);
}

export function isRobotsAllowed(robotsText, path) {
  const groups = [];
  let current = null;
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    const separator = line.indexOf(":");
    if (!line || separator < 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === "user-agent") {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (name === "allow" || name === "disallow")) {
      current.rules.push({ name, value });
    }
  }

  const rules = groups.filter((group) => group.agents.includes("*")).flatMap((group) => group.rules);
  const matched = rules
    .filter((rule) => rule.value && robotsPatternMatches(rule.value, path))
    .sort((left, right) => {
      const length = right.value.replaceAll("*", "").replace(/\$$/, "").length
        - left.value.replaceAll("*", "").replace(/\$$/, "").length;
      if (length) return length;
      return Number(right.name === "allow") - Number(left.name === "allow");
    });
  return matched[0]?.name !== "disallow";
}

async function readLimitedBody(response, limit) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error(`public response exceeds the ${limit}-byte limit`);
    }
    chunks.push(Buffer.from(value));
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

async function fetchText(url, limit, accept) {
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": "ArriveWithinIndexNowPublisher/1.0" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status !== 200) throw new Error(`${url} returned HTTP ${response.status}`);
  return { body: await readLimitedBody(response, limit), response };
}

function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function htmlIndexingState(html, headers, url) {
  const canonicals = [];
  const robots = [headers.get("x-robots-tag") ?? ""];
  for (const [tag] of html.matchAll(/<(?:link|meta)\b[^>]*>/gi)) {
    const attributes = parseAttributes(tag);
    if (tag.toLowerCase().startsWith("<link") && (attributes.rel ?? "").toLowerCase().split(/\s+/).includes("canonical")) {
      if (!attributes.href) throw new Error(`${url} has a canonical link without href`);
      canonicals.push(new URL(attributes.href, url).href);
    }
    if (tag.toLowerCase().startsWith("<meta") && ["robots", "googlebot", "bingbot"].includes((attributes.name ?? "").toLowerCase())) {
      robots.push(attributes.content ?? "");
    }
  }
  if (canonicals.length !== 1 || canonicals[0] !== url) throw new Error(`${url} is not its own single canonical URL`);
  if (robots.some((value) => /(?:^|[\s,])noindex(?:$|[\s,])/i.test(value))) throw new Error(`${url} is marked noindex`);
}

async function mapLimit(items, concurrency, operation) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await operation(items[index]);
    }
  }));
  return results;
}

export async function fetchPublicSiteSnapshot(origin = PUBLIC_ORIGIN) {
  if (origin !== PUBLIC_ORIGIN) throw new Error(`publisher is restricted to ${PUBLIC_ORIGIN}`);
  const [robotsResult, sitemapResult] = await Promise.all([
    fetchText(`${origin}/robots.txt`, MAX_ROBOTS_BYTES, "text/plain"),
    fetchText(`${origin}/sitemap.xml`, MAX_SITEMAP_BYTES, "application/xml, text/xml"),
  ]);
  const urls = parsePublicSitemap(sitemapResult.body, origin);
  for (const value of urls) {
    const url = validatePublicURL(value, origin);
    if (!isRobotsAllowed(robotsResult.body, url.pathname)) throw new Error(`robots.txt disallows sitemap URL ${value}`);
  }

  const pageEntries = await mapLimit(urls, 8, async (url) => {
    const result = await fetchText(url, MAX_HTML_BYTES, "text/html");
    if (result.response.url !== url || !result.response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      throw new Error(`${url} did not return its canonical HTML document`);
    }
    htmlIndexingState(result.body, result.response.headers, url);
    return [url, createHash("sha256").update(result.body).digest("hex")];
  });
  return { urls, pages: new Map(pageEntries) };
}

export function diffPublicURLs(before, after) {
  if (!(before instanceof Map) || !(after instanceof Map)) throw new Error("public URL snapshots must be maps");
  const changed = [];
  for (const [url, digest] of after) {
    if (!before.has(url) || before.get(url) !== digest) changed.push(url);
  }
  for (const url of before.keys()) {
    if (!after.has(url)) changed.push(url);
  }
  const result = [...new Set(changed)].sort();
  if (result.length > MAX_NOTIFICATION_URLS) {
    throw new Error(`IndexNow notification exceeds the ${MAX_NOTIFICATION_URLS}-URL batch limit`);
  }
  return result;
}

export async function verifyIndexNowKey(key) {
  if (!/^[a-f\d]{8,128}$/i.test(key)) throw new Error("IndexNow key must contain 8 to 128 hexadecimal characters");
  const keyURL = `${PUBLIC_ORIGIN}/${key}.txt`;
  const result = await fetchText(keyURL, 512, "text/plain");
  if (result.body !== key) throw new Error(`public IndexNow key file did not match ${keyURL}`);
  return keyURL;
}

export async function submitIndexNow(urls, key, { keyVerified = false } = {}) {
  const list = [...new Set(urls)].sort();
  if (!list.length) return { submitted: false, count: 0, status: null };
  if (list.length > MAX_NOTIFICATION_URLS) throw new Error(`IndexNow notification exceeds the ${MAX_NOTIFICATION_URLS}-URL batch limit`);
  for (const url of list) validatePublicURL(url);
  if (!keyVerified) await verifyIndexNowKey(key);

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": "ArriveWithinIndexNowPublisher/1.0" },
    body: JSON.stringify({ host: PUBLIC_HOST, key, urlList: list }),
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await readLimitedBody(response, 16_000);
  if (![200, 202].includes(response.status)) {
    throw new Error(`IndexNow returned HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return { submitted: true, count: list.length, status: response.status, body };
}
