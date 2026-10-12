import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { hashTree } from "./lib.mjs";
import { assertProductionWranglerConfig, parseWranglerProjectConfig, readProductionWranglerConfig } from "./cloudflare-config.mjs";
import { assertDeploymentReadback, parseWranglerDeployEvents } from "./deployment-proof.mjs";
import {
  afterSuccessfulDeployment,
  diffPublicURLs,
  INDEXNOW_ENDPOINT,
  isRobotsAllowed,
  loadPublisherState,
  MAX_NOTIFICATION_URLS,
  parsePublicSitemap,
  parsePublisherState,
  prepareIndexNowChanges,
  publishIndexNowChanges,
  readPublicTreeSnapshot,
  savePublisherState,
  serializePublisherState,
  WORKER_NAME,
} from "./indexnow.mjs";

const sitemap = (entries) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;
const homepage = "https://arrivewithin.com/";
const supportPage = "https://arrivewithin.com/de/support";
const digest = (letter) => letter.repeat(64);
const pageMap = (entries) => new Map(entries);
const productionBinding = await readProductionWranglerConfig({
  workerName: WORKER_NAME,
  customDomains: ["arrivewithin.com", "www.arrivewithin.com"],
});
const wranglerConfigText = await readFile(new URL("../edge/wrangler.toml", import.meta.url), "utf8");
const entry = (url, fingerprint, status = "ready", extra = {}) => ({
  url, fingerprint, attempts: 0, status, notBefore: null, reason: null, ...extra,
});
const state = (acknowledgedPages, pending = []) => ({ schemaVersion: 2, acknowledgedPages, pending });

function copyState(value) {
  return {
    schemaVersion: value.schemaVersion,
    acknowledgedPages: new Map(value.acknowledgedPages),
    pending: value.pending.map((item) => ({ ...item })),
  };
}

function manifest(contentSHA256) {
  return {
    schema_version: 1,
    product: "Arrive Within",
    source_sha256: digest("f"),
    content_sha256: contentSHA256,
    host: {
      intended_project: WORKER_NAME,
      project_binding: `authorized-account-${productionBinding.accountId}-production-custom-domains`,
      custom_domain: "arrivewithin.com",
      public_base_url: "https://arrivewithin.com",
      public_base_url_state: "deployment-bound",
    },
    deployment_performed: false,
  };
}

test("Wrangler project binding is strictly parsed from the production configuration", () => {
  const binding = assertProductionWranglerConfig(wranglerConfigText, {
    workerName: WORKER_NAME,
    customDomains: ["arrivewithin.com", "www.arrivewithin.com"],
  });
  assert.match(binding.accountId, /^[a-f\d]{32}$/);
  assert.deepEqual(binding.customDomains, ["arrivewithin.com", "www.arrivewithin.com"]);
  assert.throws(() => parseWranglerProjectConfig(wranglerConfigText.replace(/^account_id\s*=.*$/m, "account_id = 123")), /quoted 32-character hexadecimal/);
  assert.throws(() => parseWranglerProjectConfig(`${wranglerConfigText}\naccount_id = "${binding.accountId}"\n`), /one top-level account_id/);
  assert.throws(() => assertProductionWranglerConfig(wranglerConfigText, {
    workerName: WORKER_NAME,
    customDomains: ["other.example", "www.other.example"],
  }), /fixed Arrive Within custom domains/);
});

async function writeBuild(root, body, assets = []) {
  await writeFile(path.join(root, "robots.txt"), "User-agent: *\nAllow: /\n");
  await writeFile(path.join(root, "sitemap.xml"), sitemap(`<url><loc>${homepage}</loc></url>`));
  await writeFile(path.join(root, "index.html"), body);
  for (const [relative, bytes] of assets) {
    const file = path.join(root, relative);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(path.dirname(file), { recursive: true }));
    await writeFile(file, bytes);
  }
  const content = await hashTree(root, new Set(["_build-manifest.json"]));
  await writeFile(path.join(root, "_build-manifest.json"), JSON.stringify(manifest(content.sha256)));
  return content.sha256;
}

test("sitemap parsing counts page locs and ignores image locs", () => {
  const xml = sitemap(`<url><loc>https://arrivewithin.com/</loc><image:image><image:loc>https://arrivewithin.com/photo.png</image:loc></image:image></url><url><loc>https://arrivewithin.com/de</loc></url>`);
  assert.deepEqual(parsePublicSitemap(xml), ["https://arrivewithin.com/", "https://arrivewithin.com/de"]);
});

test("publisher submits to the direct Bing IndexNow endpoint", () => {
  assert.equal(INDEXNOW_ENDPOINT, "https://www.bing.com/indexnow");
});

test("sitemap parsing rejects off-host, insecure, query, private, and duplicate URLs", () => {
  for (const url of [
    "http://arrivewithin.com/",
    "https://www.arrivewithin.com/",
    "https://arrivewithin.com/?source=private",
    "https://arrivewithin.com/analytics/",
    "https://arrivewithin.com/%61nalytics/",
  ]) assert.throws(() => parsePublicSitemap(sitemap(`<url><loc>${url}</loc></url>`)));
  assert.throws(() => parsePublicSitemap(sitemap("<url><loc>https://arrivewithin.com/</loc></url><url><loc>https://arrivewithin.com/</loc></url>")), /duplicate/);
  assert.throws(() => parsePublicSitemap("<sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"><sitemap><loc>https://arrivewithin.com/sitemap-1.xml</loc></sitemap></sitemapindex>"));
});

test("URL deltas include new, changed, and removed public pages", () => {
  const before = pageMap([[homepage, "a"], ["https://arrivewithin.com/de", "same"], ["https://arrivewithin.com/old", "gone"]]);
  const after = pageMap([[homepage, "changed"], ["https://arrivewithin.com/de", "same"], ["https://arrivewithin.com/new", "added"]]);
  assert.deepEqual(diffPublicURLs(before, after), [homepage, "https://arrivewithin.com/new", "https://arrivewithin.com/old"]);
  assert.deepEqual(diffPublicURLs(after, after), []);
  assert.throws(() => diffPublicURLs(new Map(), new Map(Array.from({ length: MAX_NOTIFICATION_URLS + 1 }, (_, index) => [
    `https://arrivewithin.com/${index}`,
    String(index),
  ]))), /batch limit/);
});

test("robots rules allow public pages and exclude explicitly blocked paths", () => {
  const robots = "User-agent: *\nDisallow: /private/\nAllow: /private/public/\n";
  assert.equal(isRobotsAllowed(robots, "/privacy"), true);
  assert.equal(isRobotsAllowed(robots, "/private/draft"), false);
  assert.equal(isRobotsAllowed(robots, "/private/public/page"), true);
});

test("page fingerprints include generated asset and dependency bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "arrive-indexnow-build-"));
  try {
    const body = `<html><head><link rel="canonical" href="${homepage}"></head><body>Public page</body></html>`;
    const firstContentHash = await writeBuild(root, body, [["assets/app.js", "asset-v1"]]);
    const first = await readPublicTreeSnapshot(root);
    assert.equal(first.pages.get(homepage), createHash("sha256").update(body).update("\0").update(firstContentHash).digest("hex"));
    await writeBuild(root, body, [["assets/app.js", "asset-v2"]]);
    const second = await readPublicTreeSnapshot(root);
    assert.notEqual(second.pages.get(homepage), first.pages.get(homepage));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changed and added URLs are persisted before live verification and cleared only after acceptance", async () => {
  const before = pageMap([[homepage, digest("a")]]);
  const candidate = pageMap([[homepage, digest("b")], [supportPage, digest("c")]]);
  const saved = [];
  const calls = [];
  const result = await publishIndexNowChanges({
    beforePages: before,
    candidatePages: candidate,
    saveState: async (value) => { calls.push("save"); saved.push(copyState(value)); },
    readLiveSnapshot: async () => { calls.push("live"); return { pages: candidate }; },
    verifyDeleted: async () => true,
    submit: async (urls) => { calls.push("submit"); return { submitted: true, count: urls.length, status: 200 }; },
    wait: async () => {},
  });
  assert.deepEqual(calls, ["save", "live", "save", "submit", "save", "save"]);
  assert.deepEqual(saved[0].pending.map(({ url }) => url), [homepage, supportPage]);
  assert.deepEqual(saved.at(-1).pending, []);
  assert.deepEqual(saved.at(-1).acknowledgedPages, candidate);
  assert.equal(result.count, 2);
  assert.equal(result.status, 200);
});

test("unchanged production candidate sends no notification, including for retained pending work", async () => {
  const current = pageMap([[homepage, digest("a")]]);
  const previous = state(current, [entry(supportPage, digest("b"))]);
  let posts = 0;
  let liveReads = 0;
  let saves = 0;
  const result = await publishIndexNowChanges({
    beforePages: current,
    candidatePages: current,
    previousState: previous,
    saveState: async () => { saves += 1; },
    readLiveSnapshot: async () => { liveReads += 1; return { pages: current }; },
    submit: async () => { posts += 1; return { submitted: true, status: 200 }; },
    wait: async () => {},
  });
  assert.equal(liveReads, 0);
  assert.equal(posts, 0);
  assert.equal(saves, 0);
  assert.equal(result.submitted, false);
  assert.equal(result.pendingCount, 1);
});

test("accepted state left by an interruption is finalized without duplicate submission", async () => {
  const current = pageMap([[homepage, digest("b")]]);
  const previous = state(pageMap([[homepage, digest("a")]]), [entry(homepage, digest("b"), "accepted", { attempts: 1 })]);
  let posts = 0;
  const saved = [];
  const result = await publishIndexNowChanges({
    beforePages: current,
    candidatePages: current,
    previousState: previous,
    saveState: async (value) => saved.push(copyState(value)),
    readLiveSnapshot: async () => ({ pages: current }),
    verifyDeleted: async () => true,
    submit: async () => { posts += 1; return { submitted: true, status: 200 }; },
  });
  assert.equal(posts, 0);
  assert.equal(result.pendingCount, 0);
  assert.deepEqual(saved.at(-1).acknowledgedPages, current);
  assert.deepEqual(saved.at(-1).pending, []);
});

test("removed URLs are submitted only after a real 404 or 410 check", async () => {
  const before = pageMap([[homepage, digest("a")], [supportPage, digest("b")]]);
  const candidate = pageMap([[homepage, digest("a")]]);
  let posts = 0;
  const saved = [];
  await assert.rejects(publishIndexNowChanges({
    beforePages: before,
    candidatePages: candidate,
    previousState: state(before),
    saveState: async (value) => saved.push(copyState(value)),
    readLiveSnapshot: async () => ({ pages: candidate }),
    verifyDeleted: async () => false,
    submit: async () => { posts += 1; return { submitted: true, status: 200 }; },
    wait: async () => {},
  }), /removed URL did not return HTTP 404 or 410/);
  assert.equal(posts, 0);
  const held = saved.at(-1).pending.find((item) => item.url === supportPage);
  assert.equal(held.status, "ready");
  assert.equal(held.attempts, 0);
  assert.match(held.reason, /404 or 410/);

  const result = await publishIndexNowChanges({
    beforePages: before,
    candidatePages: candidate,
    previousState: saved.at(-1),
    saveState: async () => {},
    readLiveSnapshot: async () => ({ pages: candidate }),
    verifyDeleted: async (url) => url === supportPage,
    submit: async (urls) => { posts += 1; return { submitted: true, status: 202, count: urls.length }; },
    wait: async () => {},
  });
  assert.equal(posts, 1);
  assert.equal(result.status, 202);
});

test("429 Retry-After is persisted and respected by verify-only retries", async () => {
  const before = pageMap([[homepage, digest("a")]]);
  const candidate = pageMap([[homepage, digest("b")]]);
  const saved = [];
  const currentTime = Date.UTC(2026, 9, 12, 0, 0, 0);
  const first = await publishIndexNowChanges({
    beforePages: before,
    candidatePages: candidate,
    saveState: async (value) => saved.push(copyState(value)),
    readLiveSnapshot: async () => ({ pages: candidate }),
    verifyDeleted: async () => true,
    submit: async () => ({ submitted: false, status: 429, retryAfter: "120" }),
    now: () => currentTime,
    wait: async () => {},
  });
  assert.equal(first.submitted, false);
  const delayed = saved.at(-1).pending[0];
  assert.equal(delayed.status, "waiting");
  assert.equal(delayed.notBefore, new Date(currentTime + 120_000).toISOString());

  let posts = 0;
  const changedCandidate = pageMap([[homepage, digest("c")]]);
  const changedRelease = await publishIndexNowChanges({
    beforePages: candidate,
    candidatePages: changedCandidate,
    previousState: saved.at(-1),
    saveState: async (value) => saved.push(copyState(value)),
    readLiveSnapshot: async () => ({ pages: changedCandidate }),
    verifyDeleted: async () => true,
    submit: async () => { posts += 1; return { submitted: true, status: 200 }; },
    now: () => currentTime + 60_000,
    wait: async () => {},
  });
  assert.equal(changedRelease.submitted, false);
  assert.equal(posts, 0);
  assert.equal(saved.at(-1).pending[0].status, "waiting");
  assert.equal(saved.at(-1).pending[0].notBefore, new Date(currentTime + 120_000).toISOString());

  const early = await publishIndexNowChanges({
    beforePages: changedCandidate,
    candidatePages: changedCandidate,
    previousState: saved.at(-1),
    retryOnly: true,
    saveState: async () => {},
    readLiveSnapshot: async () => ({ pages: changedCandidate }),
    verifyDeleted: async () => true,
    submit: async () => { posts += 1; return { submitted: true, status: 200 }; },
    now: () => currentTime + 119_000,
    wait: async () => {},
  });
  assert.equal(early.submitted, false);
  assert.equal(posts, 0);

  const due = await publishIndexNowChanges({
    beforePages: changedCandidate,
    candidatePages: changedCandidate,
    previousState: saved.at(-1),
    retryOnly: true,
    saveState: async () => {},
    readLiveSnapshot: async () => ({ pages: changedCandidate }),
    verifyDeleted: async () => true,
    submit: async () => { posts += 1; return { submitted: true, status: 200 }; },
    now: () => currentTime + 120_000,
    wait: async () => {},
  });
  assert.equal(posts, 1);
  assert.equal(due.pendingCount, 0);
});

test("ambiguous POST outcome is held and never automatically replayed", async () => {
  const before = pageMap([[homepage, digest("a")]]);
  const candidate = pageMap([[homepage, digest("b")]]);
  const saved = [];
  let posts = 0;
  const first = await publishIndexNowChanges({
    beforePages: before,
    candidatePages: candidate,
    saveState: async (value) => saved.push(copyState(value)),
    readLiveSnapshot: async () => ({ pages: candidate }),
    verifyDeleted: async () => true,
    submit: async () => { posts += 1; throw new Error("connection closed after sending"); },
    wait: async () => {},
  });
  assert.match(first.failure, /ambiguous/);
  assert.equal(saved.at(-1).pending[0].status, "blocked");
  assert.equal(saved.at(-1).pending[0].attempts, 1);

  const retry = await publishIndexNowChanges({
    beforePages: candidate,
    candidatePages: candidate,
    previousState: saved.at(-1),
    retryOnly: true,
    saveState: async () => {},
    readLiveSnapshot: async () => ({ pages: candidate }),
    verifyDeleted: async () => true,
    submit: async () => { posts += 1; return { submitted: true, status: 200 }; },
    wait: async () => {},
  });
  assert.equal(retry.submitted, false);
  assert.equal(posts, 1);
});

test("permanent HTTP rejection is held without an automatic retry", async () => {
  const before = pageMap([[homepage, digest("a")]]);
  const candidate = pageMap([[homepage, digest("b")]]);
  const saved = [];
  let posts = 0;
  const result = await publishIndexNowChanges({
    beforePages: before,
    candidatePages: candidate,
    saveState: async (value) => saved.push(copyState(value)),
    readLiveSnapshot: async () => ({ pages: candidate }),
    verifyDeleted: async () => true,
    submit: async () => { posts += 1; return { submitted: false, status: 400 }; },
    wait: async () => {},
  });
  assert.match(result.failure, /permanent HTTP 400/);
  assert.equal(saved.at(-1).pending[0].status, "blocked");
  assert.match(saved.at(-1).pending[0].reason, /permanent HTTP 400/);
  const retry = await publishIndexNowChanges({
    beforePages: candidate,
    candidatePages: candidate,
    previousState: saved.at(-1),
    retryOnly: true,
    saveState: async () => {},
    readLiveSnapshot: async () => ({ pages: candidate }),
    verifyDeleted: async () => true,
    submit: async () => { posts += 1; return { submitted: true, status: 200 }; },
    wait: async () => {},
  });
  assert.equal(retry.submitted, false);
  assert.equal(posts, 1);
});

test("ready queue is sent in 100-URL batches and persisted before each POST", async () => {
  const current = pageMap([[homepage, digest("a")]]);
  const pending = Array.from({ length: MAX_NOTIFICATION_URLS + 1 }, (_, index) => entry(
    `https://arrivewithin.com/queued/${index}`,
    digest("a"),
  ));
  const saved = [];
  const batches = [];
  const result = await publishIndexNowChanges({
    beforePages: current,
    candidatePages: current,
    previousState: state(current, pending),
    retryOnly: true,
    saveState: async (value) => saved.push(copyState(value)),
    readLiveSnapshot: async () => ({ pages: current }),
    verifyDeleted: async () => true,
    submit: async (urls) => { batches.push(urls); return { submitted: true, count: urls.length, status: 200 }; },
    wait: async () => {},
  });
  assert.deepEqual(batches.map((batch) => batch.length), [100, 1]);
  assert.equal(result.batches, 2);
  assert.equal(result.count, 101);
  assert.ok(saved.some((value) => value.pending.some((item) => item.status === "in_flight")));
  assert.equal(saved.at(-1).pending.length, 0);
});

test("propagation mismatch never posts and retains the candidate delta for a later explicit retry", async () => {
  const before = pageMap([[homepage, digest("a")]]);
  const candidate = pageMap([[homepage, digest("b")]]);
  const stale = pageMap([[homepage, digest("a")]]);
  const saved = [];
  let reads = 0;
  let posts = 0;
  const delays = [];
  await assert.rejects(publishIndexNowChanges({
    beforePages: before,
    candidatePages: candidate,
    saveState: async (value) => saved.push(copyState(value)),
    readLiveSnapshot: async () => { reads += 1; return { pages: stale }; },
    verifyDeleted: async () => true,
    submit: async () => { posts += 1; return { submitted: true, status: 200 }; },
    wait: async (milliseconds) => delays.push(milliseconds),
  }), /live deployment did not match the candidate/);
  assert.equal(reads, 3);
  assert.deepEqual(delays, [250, 750]);
  assert.equal(posts, 0);
  const pendingState = saved.at(-1);
  assert.equal(pendingState.pending[0].status, "ready");

  await publishIndexNowChanges({
    beforePages: candidate,
    candidatePages: candidate,
    previousState: pendingState,
    retryOnly: true,
    saveState: async (value) => saved.push(copyState(value)),
    readLiveSnapshot: async () => ({ pages: candidate }),
    verifyDeleted: async () => true,
    submit: async () => { posts += 1; return { submitted: true, status: 200 }; },
    wait: async () => {},
  });
  assert.equal(posts, 1);
});

test("failed deployment never enters the IndexNow publication callback", async () => {
  let posts = 0;
  await assert.rejects(afterSuccessfulDeployment(
    async () => { throw new Error("deployment failed"); },
    async () => { posts += 1; },
  ), /deployment failed/);
  assert.equal(posts, 0);
});

test("candidate delta is durably queued before deployment begins", async () => {
  const before = pageMap([[homepage, digest("a")]]);
  const candidate = pageMap([[homepage, digest("b")]]);
  const saved = [];
  const prepared = await prepareIndexNowChanges({
    beforePages: before,
    candidatePages: candidate,
    saveState: async (value) => saved.push(copyState(value)),
  });
  assert.deepEqual(saved[0], prepared);
  assert.equal(prepared.pending[0].status, "ready");
  let publicationStarted = false;
  await assert.rejects(afterSuccessfulDeployment(
    async () => { throw new Error("provider did not activate candidate"); },
    async () => { publicationStarted = true; },
  ), /provider did not activate candidate/);
  assert.equal(publicationStarted, false);
  assert.equal(saved[0].pending.length, 1);
});

test("Wrangler deploy version must match provider readback at 100 percent traffic", () => {
  const versionId = "f782c6bc-0d78-4f55-babd-8a0a8f687d27";
  const deployment = parseWranglerDeployEvents(JSON.stringify({
    type: "deploy", version: 1, worker_name: WORKER_NAME, version_id: versionId, targets: ["production"],
  }));
  assert.deepEqual(assertDeploymentReadback(deployment, JSON.stringify({ versions: [{ version_id: versionId, percentage: 100 }] })), {
    workerName: WORKER_NAME, versionId, percentage: 100,
  });
  assert.throws(() => assertDeploymentReadback(deployment, JSON.stringify({ versions: [{ version_id: "old", percentage: 100 }] })), /exact candidate/);
  assert.throws(() => assertDeploymentReadback(deployment, JSON.stringify({ versions: [{ version_id: versionId, percentage: 10 }] })), /100%/);
});

test("publisher state round-trips privately, migrates the old schema, and blocks interrupted in-flight work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "arrive-indexnow-state-"));
  const directory = path.join(root, ".indexnow-state");
  const savedState = state(pageMap([[homepage, digest("a")]]), [entry(supportPage, digest("b"), "waiting", {
    attempts: 2, notBefore: "2026-10-12T00:02:00.000Z", reason: "HTTP 429; delayed retry scheduled",
  })]);
  try {
    await savePublisherState(directory, savedState);
    const loaded = await loadPublisherState(directory);
    assert.deepEqual(loaded, savedState);
    const file = path.join(directory, "publisher-state.json");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.match(await readFile(file, "utf8"), /acknowledged_pages/);
    assert.doesNotMatch(await readFile(file, "utf8"), /token|secret/i);

    const interrupted = parsePublisherState(JSON.stringify({
      schema_version: 2,
      acknowledged_pages: { [homepage]: digest("a") },
      pending: [entry(supportPage, digest("b"), "in_flight", { attempts: 1 })],
    }));
    assert.equal(interrupted.pending[0].status, "blocked");
    assert.match(interrupted.pending[0].reason, /ambiguous in-flight/);

    const exhausted = parsePublisherState(JSON.stringify({
      schema_version: 2,
      acknowledged_pages: { [homepage]: digest("a") },
      pending: [entry(supportPage, digest("b"), "waiting", { attempts: 5, notBefore: "2026-10-12T00:02:00.000Z" })],
    }));
    assert.equal(exhausted.pending[0].status, "blocked");
    assert.match(exhausted.pending[0].reason, /retry limit/);

    const migrated = parsePublisherState(JSON.stringify({
      schema_version: 1,
      acknowledged_pages: { [homepage]: digest("a") },
      pending_urls: [supportPage],
    }));
    assert.equal(migrated.pending[0].fingerprint, "legacy");
    assert.match(serializePublisherState(migrated), /"schema_version": 2/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
