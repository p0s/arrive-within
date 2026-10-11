import assert from "node:assert/strict";
import { test } from "node:test";

import {
  diffPublicURLs,
  isRobotsAllowed,
  MAX_NOTIFICATION_URLS,
  parsePublicSitemap,
} from "./indexnow.mjs";

const sitemap = (entries) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`;

test("sitemap parsing counts page locs and ignores image locs", () => {
  const xml = sitemap(`<url><loc>https://arrivewithin.com/</loc><image:image><image:loc>https://arrivewithin.com/photo.png</image:loc></image:image></url><url><loc>https://arrivewithin.com/de</loc></url>`);
  assert.deepEqual(parsePublicSitemap(xml), ["https://arrivewithin.com/", "https://arrivewithin.com/de"]);
});

test("sitemap parsing rejects off-host, insecure, query, private, and duplicate URLs", () => {
  for (const url of [
    "http://arrivewithin.com/",
    "https://www.arrivewithin.com/",
    "https://arrivewithin.com/?source=private",
    "https://arrivewithin.com/analytics/",
    "https://arrivewithin.com/%61nalytics/",
  ]) {
    assert.throws(() => parsePublicSitemap(sitemap(`<url><loc>${url}</loc></url>`)));
  }
  assert.throws(() => parsePublicSitemap(sitemap("<url><loc>https://arrivewithin.com/</loc></url><url><loc>https://arrivewithin.com/</loc></url>")), /duplicate/);
  assert.throws(() => parsePublicSitemap("<sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"><sitemap><loc>https://arrivewithin.com/sitemap-1.xml</loc></sitemap></sitemapindex>"));
});

test("URL deltas include new, changed, and removed public pages", () => {
  const before = new Map([
    ["https://arrivewithin.com/", "a"],
    ["https://arrivewithin.com/de", "same"],
    ["https://arrivewithin.com/old", "gone"],
  ]);
  const after = new Map([
    ["https://arrivewithin.com/", "changed"],
    ["https://arrivewithin.com/de", "same"],
    ["https://arrivewithin.com/new", "added"],
  ]);
  assert.deepEqual(diffPublicURLs(before, after), [
    "https://arrivewithin.com/",
    "https://arrivewithin.com/new",
    "https://arrivewithin.com/old",
  ]);
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
