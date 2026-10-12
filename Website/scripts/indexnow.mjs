import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { hashTree } from "./lib.mjs";

export const PUBLIC_ORIGIN = "https://arrivewithin.com";
export const PUBLIC_HOST = "arrivewithin.com";
export const INDEXNOW_ENDPOINT = "https://www.bing.com/indexnow";
export const MAX_SITEMAP_URLS = 100;
export const MAX_NOTIFICATION_URLS = 100;
export const MAX_PENDING_INDEXNOW_URLS = 1_000;
export const MAX_INDEXNOW_ATTEMPTS = 5;
export const DEFAULT_RETRY_DELAY_MS = 60_000;
export const MAX_RETRY_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_PUBLISHER_STATE_BYTES = 2_000_000;
export const MAX_LIVE_PROPAGATION_ATTEMPTS = 3;
export const LIVE_PROPAGATION_DELAYS_MS = [250, 750];
export const REQUEST_TIMEOUT_MS = 12_000;
export const MAX_SITEMAP_BYTES = 1_000_000;
export const MAX_ROBOTS_BYTES = 64_000;
export const MAX_HTML_BYTES = 2_000_000;
export const MAX_MANIFEST_BYTES = 64_000;
export const WORKER_NAME = "arrivewithin-web";
export const ACCOUNT_ID = "0317b000520a8e6b237de500c592d67a";

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

function parseBuildManifest(text, origin = PUBLIC_ORIGIN) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error("public build manifest is not valid JSON");
  }
  if (
    manifest?.schema_version !== 1
    || manifest.product !== "Arrive Within"
    || !/^[a-f\d]{64}$/.test(manifest.source_sha256 ?? "")
    || !/^[a-f\d]{64}$/.test(manifest.content_sha256 ?? "")
    || manifest.host?.intended_project !== WORKER_NAME
    || manifest.host?.project_binding !== `authorized-account-${ACCOUNT_ID}-production-custom-domains`
    || manifest.host?.custom_domain !== PUBLIC_HOST
    || manifest.host?.public_base_url !== origin
    || manifest.host?.public_base_url_state !== "deployment-bound"
    || manifest.deployment_performed !== false
  ) {
    throw new Error("public build manifest does not identify the expected Arrive Within production candidate");
  }
  return manifest;
}

function pageFingerprint(html, contentSHA256) {
  if (!/^[a-f\d]{64}$/.test(contentSHA256 ?? "")) throw new Error("page fingerprint requires a valid build content hash");
  return createHash("sha256").update(html).update("\0").update(contentSHA256).digest("hex");
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
  const [robotsResult, sitemapResult, manifestResult] = await Promise.all([
    fetchText(`${origin}/robots.txt`, MAX_ROBOTS_BYTES, "text/plain"),
    fetchText(`${origin}/sitemap.xml`, MAX_SITEMAP_BYTES, "application/xml, text/xml"),
    fetchText(`${origin}/_build-manifest.json`, MAX_MANIFEST_BYTES, "application/json"),
  ]);
  const manifest = parseBuildManifest(manifestResult.body, origin);
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
    return [url, pageFingerprint(result.body, manifest.content_sha256)];
  });
  return { urls, pages: new Map(pageEntries), manifest };
}

export function diffPublicURLs(before, after) {
  if (!(before instanceof Map) || !(after instanceof Map)) throw new Error("public URL snapshots must be maps");
  const result = changedPublicURLs(before, after);
  if (result.length > MAX_NOTIFICATION_URLS) {
    throw new Error(`IndexNow notification exceeds the ${MAX_NOTIFICATION_URLS}-URL batch limit`);
  }
  return result;
}

function changedPublicURLs(before, after) {
  const changed = [];
  for (const [url, digest] of after) {
    if (!before.has(url) || before.get(url) !== digest) changed.push(url);
  }
  for (const url of before.keys()) {
    if (!after.has(url)) changed.push(url);
  }
  return [...new Set(changed)].sort();
}

function assertPageMap(pages, label) {
  if (!(pages instanceof Map) || pages.size > MAX_SITEMAP_URLS) {
    throw new Error(`${label} must be a bounded public page map`);
  }
  for (const [url, digest] of pages) {
    validatePublicURL(url);
    if (typeof digest !== "string" || !/^[a-f\d]{64}$/.test(digest)) {
      throw new Error(`${label} contains an invalid page digest`);
    }
  }
  return new Map([...pages].sort(([left], [right]) => left.localeCompare(right)));
}

function samePageMap(left, right) {
  if (left.size !== right.size) return false;
  for (const [url, digest] of left) {
    if (right.get(url) !== digest) return false;
  }
  return true;
}

function makePublisherState(acknowledgedPages, pending) {
  return assertPublisherState({
    schemaVersion: 2,
    acknowledgedPages,
    pending,
  });
}

function assertPublisherState(state) {
  if (
    !state
    || state.schemaVersion !== 2
    || !(state.acknowledgedPages instanceof Map)
    || !Array.isArray(state.pending)
    || state.pending.length > MAX_PENDING_INDEXNOW_URLS
  ) {
    throw new Error("invalid local IndexNow publisher state");
  }
  const acknowledgedPages = assertPageMap(state.acknowledgedPages, "acknowledged page state");
  const pending = [];
  const seen = new Set();
  for (const item of state.pending) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("local IndexNow pending entry is invalid");
    const { url, fingerprint, attempts, status, notBefore = null, reason = null } = item;
    validatePublicURL(url);
    if (fingerprint !== null && fingerprint !== "legacy" && !/^[a-f\d]{64}$/.test(fingerprint)) {
      throw new Error("local IndexNow pending entry has an invalid fingerprint");
    }
    if (!Number.isInteger(attempts) || attempts < 0 || attempts > MAX_INDEXNOW_ATTEMPTS) {
      throw new Error("local IndexNow pending entry has an invalid attempt count");
    }
    if (!["ready", "waiting", "in_flight", "blocked", "accepted"].includes(status)) {
      throw new Error("local IndexNow pending entry has an invalid status");
    }
    if (notBefore !== null && (typeof notBefore !== "string" || !Number.isFinite(Date.parse(notBefore)))) {
      throw new Error("local IndexNow pending entry has an invalid retry time");
    }
    if (reason !== null && typeof reason !== "string") throw new Error("local IndexNow pending entry has an invalid reason");
    const key = url;
    if (seen.has(key)) throw new Error("local IndexNow publisher state contains duplicate pending URLs");
    seen.add(key);
    let normalizedStatus = status;
    let normalizedNotBefore = notBefore;
    let normalizedReason = reason;
    if ((status === "ready" || status === "waiting") && attempts >= MAX_INDEXNOW_ATTEMPTS) {
      normalizedStatus = "blocked";
      normalizedNotBefore = null;
      normalizedReason = "retry limit reached; manual review required";
    }
    pending.push({ url, fingerprint, attempts, status: normalizedStatus, notBefore: normalizedNotBefore, reason: normalizedReason });
  }
  if (pending.length > MAX_PENDING_INDEXNOW_URLS) throw new Error("local IndexNow pending queue exceeds its bound");
  return { schemaVersion: 2, acknowledgedPages, pending: pending.sort((left, right) => left.url.localeCompare(right.url)) };
}

export function parsePublisherState(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("local IndexNow publisher state is not valid JSON");
  }
  if (!value || !value.acknowledged_pages || Array.isArray(value.acknowledged_pages) || typeof value.acknowledged_pages !== "object") {
    throw new Error("local IndexNow publisher state has an unsupported schema");
  }
  if (value.schema_version === 1 && Array.isArray(value.pending_urls)) {
    const acknowledgedPages = new Map(Object.entries(value.acknowledged_pages));
    return assertPublisherState({
      schemaVersion: 2,
      acknowledgedPages,
      pending: value.pending_urls.map((url) => ({
        url,
        fingerprint: "legacy",
        attempts: 0,
        status: "ready",
        notBefore: null,
        reason: "migrated from prior publisher state",
      })),
    });
  }
  if (value.schema_version !== 2 || !Array.isArray(value.pending)) throw new Error("local IndexNow publisher state has an unsupported schema");
  return assertPublisherState({
    schemaVersion: value.schema_version,
    acknowledgedPages: new Map(Object.entries(value.acknowledged_pages)),
    pending: value.pending.map((item) => item?.status === "in_flight"
      ? { ...item, status: "blocked", notBefore: null, reason: "ambiguous in-flight request recovered after interruption; manual review required" }
      : item),
  });
}

export function serializePublisherState(state) {
  const normalized = assertPublisherState(state);
  return `${JSON.stringify({
    schema_version: normalized.schemaVersion,
    acknowledged_pages: Object.fromEntries(normalized.acknowledgedPages),
    pending: normalized.pending,
  }, null, 2)}\n`;
}

async function assertPrivateStateDirectory(directory, { create = false } = {}) {
  if (create) {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("local IndexNow state directory must be a real directory");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("local IndexNow state directory must be private to the current user");
  }
}

export async function loadPublisherState(directory) {
  try {
    await assertPrivateStateDirectory(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }

  const file = path.join(directory, "publisher-state.json");
  let metadata;
  try {
    metadata = await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("local IndexNow state must be a regular file");
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("local IndexNow state file must be private to the current user");
  }
  if (metadata.size > MAX_PUBLISHER_STATE_BYTES) {
    throw new Error("local IndexNow state exceeds the bounded file size");
  }
  return parsePublisherState(await readFile(file, "utf8"));
}

export async function savePublisherState(directory, state) {
  const serialized = serializePublisherState(state);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PUBLISHER_STATE_BYTES) {
    throw new Error("local IndexNow state exceeds the bounded file size");
  }
  await assertPrivateStateDirectory(directory, { create: true });

  const file = path.join(directory, "publisher-state.json");
  try {
    const existing = await lstat(file);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error("local IndexNow state must be a regular file");
    }
    if ((existing.mode & 0o077) !== 0) {
      throw new Error("local IndexNow state file must be private to the current user");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporary = path.join(directory, `.publisher-state-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, file);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readBuildText(root, file, maxBytes, label) {
  const relative = path.relative(root, file);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a file inside the public build output`);
  }
  let parent = root;
  for (const segment of path.dirname(relative).split(path.sep).filter(Boolean)) {
    parent = path.join(parent, segment);
    const parentMetadata = await lstat(parent);
    if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
      throw new Error(`${label} has a non-directory or symbolic-link parent`);
    }
  }
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  if (metadata.size > maxBytes) throw new Error(`${label} exceeds the bounded output size`);
  const bytes = await readFile(file);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function routeOutputPath(root, url) {
  const pathname = new URL(url).pathname;
  const segments = pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  if (segments.some((segment) => [".", ".."].includes(segment) || /[\\/]/.test(segment))) {
    throw new Error(`sitemap URL cannot be mapped to a local public file: ${url}`);
  }
  const relative = path.join(...segments, "index.html");
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error(`sitemap URL escapes the local public output: ${url}`);
  }
  return absolute;
}

export async function readPublicTreeSnapshot(directory) {
  const root = path.resolve(directory);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("public build output must be a real directory");
  }
  const robotsText = await readBuildText(root, path.join(root, "robots.txt"), MAX_ROBOTS_BYTES, "robots.txt");
  const sitemapText = await readBuildText(root, path.join(root, "sitemap.xml"), MAX_SITEMAP_BYTES, "sitemap.xml");
  const manifestText = await readBuildText(root, path.join(root, "_build-manifest.json"), MAX_MANIFEST_BYTES, "build manifest");
  const manifest = parseBuildManifest(manifestText);
  const outputHash = await hashTree(root, new Set(["_build-manifest.json"]));
  if (manifest.content_sha256 !== outputHash.sha256) throw new Error("build manifest content hash does not match the public output tree");
  const urls = parsePublicSitemap(sitemapText);
  for (const value of urls) {
    const url = validatePublicURL(value);
    if (!isRobotsAllowed(robotsText, url.pathname)) throw new Error(`robots.txt disallows sitemap URL ${value}`);
  }

  const pageEntries = await mapLimit(urls, 8, async (url) => {
    const body = await readBuildText(root, routeOutputPath(root, url), MAX_HTML_BYTES, url);
    htmlIndexingState(body, new Headers(), url);
    return [url, pageFingerprint(body, manifest.content_sha256)];
  });
  return { urls, pages: assertPageMap(new Map(pageEntries), "built public page snapshot"), manifest };
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function afterSuccessfulDeployment(deploy, publish) {
  await deploy();
  return publish();
}

export async function verifyDeletedPublicURL(url) {
  validatePublicURL(url);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "ArriveWithinIndexNowPublisher/1.0" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.status === 404 || response.status === 410;
  } catch {
    return false;
  }
}

function retryNotBefore(retryAfter, nowMilliseconds) {
  let delay = DEFAULT_RETRY_DELAY_MS;
  if (typeof retryAfter === "string" && retryAfter.trim()) {
    const value = retryAfter.trim();
    if (/^\d+$/.test(value)) delay = Number(value) * 1_000;
    else {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) delay = parsed - nowMilliseconds;
    }
  }
  delay = Math.max(1_000, Math.min(MAX_RETRY_AFTER_MS, delay));
  return new Date(nowMilliseconds + delay).toISOString();
}

function canAttempt(entry, nowMilliseconds) {
  return entry.status === "ready"
    || (entry.status === "waiting" && Date.parse(entry.notBefore) <= nowMilliseconds);
}

function pendingMatchesCandidate(pending, candidate) {
  return pending.every((entry) => (candidate.get(entry.url) ?? null) === entry.fingerprint);
}

function notificationReport(pending, attemptsUsed, submitted, receipts, failure = null) {
  const counts = { ready: 0, waiting: 0, blocked: 0, accepted: 0 };
  for (const entry of pending) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
  return {
    submitted,
    count: receipts.reduce((sum, receipt) => sum + receipt.count, 0),
    status: receipts.at(-1)?.status ?? null,
    batches: receipts.length,
    propagationAttempts: attemptsUsed,
    pendingCount: pending.length,
    statuses: counts,
    failure,
  };
}

export async function prepareIndexNowChanges({ beforePages, candidatePages, previousState = null, saveState }) {
  const before = assertPageMap(beforePages, "pre-deploy public page snapshot");
  const candidate = assertPageMap(candidatePages, "candidate public page snapshot");
  if (typeof saveState !== "function") throw new Error("IndexNow preparation requires a state writer");
  const saved = previousState ? assertPublisherState(previousState) : null;
  const acknowledged = saved?.acknowledgedPages ?? before;
  const pending = saved?.pending.map((item) => ({ ...item })) ?? [];
  if (!samePageMap(before, candidate)) {
    const byURL = new Map(pending.map((item) => [item.url, item]));
    for (const url of changedPublicURLs(acknowledged, candidate)) {
      const fingerprint = candidate.get(url) ?? null;
      const existing = byURL.get(url);
      if (!existing) {
        const item = { url, fingerprint, attempts: 0, status: "ready", notBefore: null, reason: null };
        pending.push(item);
        byURL.set(url, item);
      } else if (existing.fingerprint !== fingerprint) {
        existing.fingerprint = fingerprint;
        if (existing.status !== "blocked" && existing.status !== "in_flight" && existing.status !== "waiting") {
          existing.attempts = 0;
          existing.status = "ready";
          existing.notBefore = null;
          existing.reason = null;
        }
      } else if (existing.fingerprint === "legacy") {
        existing.fingerprint = fingerprint;
      }
    }
  }
  if (pending.length > MAX_PENDING_INDEXNOW_URLS) {
    throw new Error(`IndexNow pending queue exceeds its ${MAX_PENDING_INDEXNOW_URLS}-URL bound; existing state was preserved`);
  }
  const prepared = makePublisherState(acknowledged, pending);
  if (!samePageMap(before, candidate) && pending.length) await saveState(prepared);
  return prepared;
}

export async function publishIndexNowChanges({
  beforePages,
  candidatePages,
  previousState = null,
  saveState,
  readLiveSnapshot,
  submit,
  verifyDeleted = verifyDeletedPublicURL,
  retryOnly = false,
  now = () => Date.now(),
  wait = sleep,
  propagationAttempts = MAX_LIVE_PROPAGATION_ATTEMPTS,
  propagationDelaysMs = LIVE_PROPAGATION_DELAYS_MS,
}) {
  const before = assertPageMap(beforePages, "pre-deploy public page snapshot");
  const candidate = assertPageMap(candidatePages, "candidate public page snapshot");
  if (typeof saveState !== "function" || typeof readLiveSnapshot !== "function" || typeof submit !== "function" || typeof verifyDeleted !== "function") {
    throw new Error("IndexNow publication requires state, live-read, deletion-check, and submit functions");
  }
  if (!Number.isInteger(propagationAttempts) || propagationAttempts < 1 || propagationAttempts > 5) {
    throw new Error("live propagation attempts must be between one and five");
  }
  const saved = previousState ? assertPublisherState(previousState) : null;
  let acknowledged = saved?.acknowledgedPages ?? before;
  let pending = saved?.pending.map((entry) => ({ ...entry })) ?? [];

  // A normal deployment never uses an unchanged public candidate as a retry trigger.
  // Operators can run the explicit verify-only retry path for due retained entries.
  if (!retryOnly && samePageMap(before, candidate)) {
    if (pending.length && pending.every((entry) => entry.status === "accepted") && pendingMatchesCandidate(pending, candidate)) {
      await saveState(makePublisherState(candidate, []));
      return notificationReport([], 0, false, []);
    }
    return notificationReport(pending, 0, false, []);
  }
  if (retryOnly && !saved) return notificationReport([], 0, false, []);

  if (!retryOnly) {
    const prepared = await prepareIndexNowChanges({ beforePages: before, candidatePages: candidate, previousState: saved, saveState });
    acknowledged = prepared.acknowledgedPages;
    pending = prepared.pending;
  } else {
    let upgraded = false;
    for (const item of pending) {
      if (item.fingerprint === "legacy") {
        item.fingerprint = candidate.get(item.url) ?? null;
        item.reason = "legacy pending URL bound to the verified current candidate";
        upgraded = true;
      }
    }
    if (upgraded) await saveState(makePublisherState(acknowledged, pending));
  }
  if (pending.length && pending.every((entry) => entry.status === "accepted") && pendingMatchesCandidate(pending, candidate)) {
    await saveState(makePublisherState(candidate, []));
    return notificationReport([], 0, false, []);
  }
  if (pending.length > MAX_PENDING_INDEXNOW_URLS) {
    throw new Error(`IndexNow pending queue exceeds its ${MAX_PENDING_INDEXNOW_URLS}-URL bound; existing state was preserved`);
  }
  pending = pending.sort((left, right) => left.url.localeCompare(right.url));
  const queuedState = () => makePublisherState(acknowledged, pending);

  // Queue preparation above is persisted before deployment or live verification.
  const nowMilliseconds = now();
  const due = pending.filter((entry) => canAttempt(entry, nowMilliseconds));
  if (!due.length) return notificationReport(pending, 0, false, []);

  let propagated = false;
  let attemptsUsed = 0;
  let lastProblem = "live pages did not yet match the build candidate";
  for (let attempt = 0; attempt < propagationAttempts; attempt += 1) {
    attemptsUsed += 1;
    try {
      const live = await readLiveSnapshot();
      const livePages = assertPageMap(live?.pages, "live public page snapshot");
      if (samePageMap(livePages, candidate)) {
        propagated = true;
        break;
      }
      lastProblem = "live page hashes did not match the build candidate";
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    if (attempt + 1 < propagationAttempts) {
      await wait(propagationDelaysMs[attempt] ?? propagationDelaysMs.at(-1) ?? 0);
    }
  }
  if (!propagated) {
    await saveState(queuedState());
    throw new Error(`IndexNow held: live deployment did not match the candidate after ${attemptsUsed} bounded reads; ${pending.length} URL(s) remain pending (${lastProblem})`);
  }

  const receipts = [];
  let submitted = false;
  let failure = null;
  while (true) {
    const eligible = pending.filter((entry) => canAttempt(entry, now()));
    if (!eligible.length) break;
    const batch = eligible.slice(0, MAX_NOTIFICATION_URLS);
    const batchURLs = new Set(batch.map((entry) => entry.url));
    const removedURLs = batch.filter((entry) => entry.fingerprint === null).map((entry) => entry.url);
    if (removedURLs.length) {
      const verified = await Promise.all(removedURLs.map((url) => verifyDeleted(url)));
      if (verified.some((value) => value !== true)) {
        for (const entry of batch) entry.reason = "removed URL has not returned HTTP 404 or 410";
        await saveState(queuedState());
        throw new Error("IndexNow held: removed URL did not return HTTP 404 or 410");
      }
    }

    for (const entry of batch) {
      entry.attempts += 1;
      entry.status = "in_flight";
      entry.notBefore = null;
      entry.reason = null;
    }
    await saveState(queuedState());

    let receipt;
    try {
      receipt = await submit([...batchURLs]);
    } catch {
      for (const entry of batch) {
        entry.status = "blocked";
        entry.reason = "ambiguous request outcome; manual review required";
      }
      await saveState(queuedState());
      failure = "ambiguous request outcome; batch is held to avoid automatic duplicate submission";
      break;
    }
    if (receipt?.submitted && [200, 202].includes(receipt.status)) {
      for (const entry of batch) {
        entry.status = "accepted";
        entry.reason = null;
      }
      receipts.push({ count: batch.length, status: receipt.status });
      submitted = true;
      await saveState(queuedState());
      continue;
    }

    const status = Number.isInteger(receipt?.status) ? receipt.status : null;
    if ([429, 503].includes(status)) {
      for (const entry of batch) {
        if (entry.attempts >= MAX_INDEXNOW_ATTEMPTS) {
          entry.status = "blocked";
          entry.reason = `retry limit reached after HTTP ${status}`;
        } else {
          entry.status = "waiting";
          entry.notBefore = retryNotBefore(receipt.retryAfter, now());
          entry.reason = `HTTP ${status}; delayed retry scheduled`;
        }
      }
      await saveState(queuedState());
      failure = `HTTP ${status}; retry is delayed`;
      break;
    }

    const permanent = status !== null && status >= 400 && status < 500 && status !== 408;
    for (const entry of batch) {
      entry.status = "blocked";
      entry.reason = permanent ? `permanent HTTP ${status}` : "ambiguous server response; manual review required";
    }
    await saveState(queuedState());
    failure = permanent ? `permanent HTTP ${status}; batch is held` : "ambiguous server response; batch is held";
    break;
  }

  if (pending.length && pending.every((entry) => entry.status === "accepted")) {
    acknowledged = candidate;
    pending = [];
    await saveState(makePublisherState(candidate, []));
  } else if (pending.length) {
    await saveState(queuedState());
  } else {
    acknowledged = candidate;
    await saveState(makePublisherState(candidate, []));
  }
  return notificationReport(pending, attemptsUsed, submitted, receipts, failure);
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
  return {
    submitted: [200, 202].includes(response.status),
    count: list.length,
    status: response.status,
    retryAfter: response.headers.get("retry-after"),
    body: body.slice(0, 300),
  };
}
