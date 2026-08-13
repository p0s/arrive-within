import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UNBOUND_PUBLIC_BASE_URL } from "./lib.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const REPOSITORY_ROOT = path.resolve(ROOT, "..");
const DIST = path.join(ROOT, "dist");
const REPORT = path.join(REPOSITORY_ROOT, "docs", "qa", "website", "browser-matrix.json");
const ORIGIN = UNBOUND_PUBLIC_BASE_URL;
const ROUTES = ["/", "/de", "/support", "/de/support", "/privacy", "/de/privacy", "/open-source", "/de/open-source"];
const VIEWPORTS = [
  { id: "desktop", width: 1440, height: 1000 },
  { id: "mobile", width: 390, height: 844 },
  { id: "compact", width: 320, height: 700 },
];

const requireFromMarketing = createRequire(
  path.join(REPOSITORY_ROOT, "Marketing", "AppStoreScreenshots", "package.json"),
);
let chromium;
try {
  ({ chromium } = requireFromMarketing("playwright"));
} catch {
  throw new Error("Playwright 1.61.1 is required; install Marketing/AppStoreScreenshots with its frozen lockfile first");
}

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".json", "application/json; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
]);

function outputPathFor(requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  if (!path.extname(pathname)) pathname += "/index.html";
  const output = path.resolve(DIST, `.${pathname}`);
  if (output !== DIST && !output.startsWith(`${DIST}${path.sep}`)) return null;
  return output;
}

async function fulfillFromDist(requestRoute, externalRequests) {
  const request = requestRoute.request();
  if (new URL(request.url()).origin !== ORIGIN) {
    externalRequests.push(request.url());
    await requestRoute.abort("blockedbyclient");
    return;
  }
  const output = outputPathFor(request.url());
  if (!output) {
    await requestRoute.fulfill({ status: 400, body: "Bad request" });
    return;
  }
  try {
    const body = await readFile(output);
    const range = request.headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const contentType = contentTypes.get(path.extname(output)) ?? "application/octet-stream";
    if (range) {
      const start = Number(range[1]);
      const requestedEnd = range[2] ? Number(range[2]) : body.byteLength - 1;
      const end = Math.min(requestedEnd, body.byteLength - 1);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= body.byteLength) {
        await requestRoute.fulfill({ status: 416, headers: { "content-range": `bytes */${body.byteLength}` }, body: Buffer.alloc(0) });
        return;
      }
      const partial = body.subarray(start, end + 1);
      await requestRoute.fulfill({
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "cache-control": "no-store",
          "content-length": String(partial.byteLength),
          "content-range": `bytes ${start}-${end}/${body.byteLength}`,
          "content-type": contentType,
        },
        body: partial,
      });
      return;
    }
    await requestRoute.fulfill({
      status: 200,
      headers: {
        "accept-ranges": "bytes",
        "cache-control": "no-store",
        "content-length": String(body.byteLength),
        "content-type": contentType,
      },
      body,
    });
  } catch (error) {
    await requestRoute.fulfill({ status: error?.code === "ENOENT" ? 404 : 500, body: error?.code === "ENOENT" ? "Not found" : "Read error" });
  }
}

async function inspectRoute(browser, route, viewport) {
  const context = await browser.newContext({
    locale: route.startsWith("/de") ? "de-DE" : "en-US",
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  const browserMessages = [];
  const externalRequests = [];
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") {
      browserMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => browserMessages.push({ type: "pageerror", text: error.message }));
  await page.route("**/*", (requestRoute) => fulfillFromDist(requestRoute, externalRequests));

  const response = await page.goto(`${ORIGIN}${route}`, { waitUntil: "load" });
  await page.locator(".brand-mark").first().evaluate(async (element) => {
    await /** @type {HTMLImageElement} */ (element).decode();
  });
  const expectedLanguage = route.startsWith("/de") ? "de" : "en";
  const facts = await page.evaluate(() => {
    const headerLinks = [...document.querySelectorAll(".navigation a")];
    const tapTargets = [...document.querySelectorAll(".navigation a, main a, .site-footer nav a")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return !element.closest("video") && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.textContent?.trim() || element.getAttribute("aria-label") || element.getAttribute("href"),
          width: Number(rect.width.toFixed(2)),
          height: Number(rect.height.toFixed(2)),
        };
      });
    const icon = document.querySelector('link[rel="icon"]');
    const touchIcon = document.querySelector('link[rel="apple-touch-icon"]');
    return {
      brandIconCount: document.querySelectorAll("img.brand-mark").length,
      brandIconsLoaded: [...document.querySelectorAll("img.brand-mark")].every((image) => image.complete && image.naturalWidth === 180 && image.naturalHeight === 180),
      browserIconPath: icon ? new URL(/** @type {HTMLLinkElement} */ (icon).href).pathname : null,
      documentLanguage: document.documentElement.lang,
      footerVisible: Boolean(document.querySelector("footer")?.getBoundingClientRect().height),
      h1Count: document.querySelectorAll("h1").length,
      headerLinkCount: headerLinks.length,
      hiddenHeaderLinks: headerLinks.filter((element) => {
        const style = getComputedStyle(element);
        return style.display === "none" || style.visibility === "hidden";
      }).length,
      imageCount: document.images.length,
      imagesMissingAlt: [...document.images].filter((image) => !image.hasAttribute("alt") || (!image.alt.trim() && image.getAttribute("aria-hidden") !== "true")).length,
      mainCount: document.querySelectorAll("main").length,
      overflowPixels: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      tapTargetFailures: tapTargets.filter((target) => target.width < 44 || target.height < 44),
      title: document.title,
      touchIconPath: touchIcon ? new URL(/** @type {HTMLLinkElement} */ (touchIcon).href).pathname : null,
      videoCount: document.querySelectorAll("video").length,
    };
  });

  let video = null;
  if (route === "/" || route === "/de") {
    video = await page.locator("video").evaluate(async (element) => {
      const media = /** @type {HTMLVideoElement} */ (element);
      if (media.readyState < HTMLMediaElement.HAVE_METADATA) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("video metadata timeout")), 10_000);
          media.addEventListener("loadedmetadata", () => { clearTimeout(timeout); resolve(); }, { once: true });
          media.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("video metadata error")); }, { once: true });
          media.load();
        });
      }
      const seekTarget = Math.min(5, Math.max(0, media.duration - 0.25));
      if (seekTarget > 0) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("video seek timeout")), 10_000);
          media.addEventListener("seeked", () => { clearTimeout(timeout); resolve(); }, { once: true });
          media.currentTime = seekTarget;
        });
      }
      return {
        autoplay: media.autoplay,
        controls: media.controls,
        currentTime: Number(media.currentTime.toFixed(3)),
        duration: Number(media.duration.toFixed(3)),
        paused: media.paused,
        poster: new URL(media.poster).pathname,
        readyState: media.readyState,
        videoHeight: media.videoHeight,
        videoWidth: media.videoWidth,
      };
    });
  }

  const failures = [];
  if (response?.status() !== 200) failures.push(`HTTP status ${response?.status() ?? "missing"}`);
  if (facts.documentLanguage !== expectedLanguage) failures.push(`document language ${facts.documentLanguage}`);
  if (facts.mainCount !== 1) failures.push(`main count ${facts.mainCount}`);
  if (facts.h1Count !== 1) failures.push(`H1 count ${facts.h1Count}`);
  if (!facts.footerVisible) failures.push("footer is not rendered");
  if (facts.imagesMissingAlt !== 0) failures.push(`${facts.imagesMissingAlt} images missing alt text`);
  if (facts.brandIconCount !== 2 || !facts.brandIconsLoaded) failures.push("visible brand icons did not load at the canonical size");
  if (facts.browserIconPath !== "/assets/brand-icon-40.png" || facts.touchIconPath !== "/assets/brand-icon-180.png") failures.push("browser/platform icon metadata mismatch");
  if (facts.headerLinkCount !== 6 || facts.hiddenHeaderLinks !== 0) failures.push(`header navigation exposure mismatch (${facts.headerLinkCount} links, ${facts.hiddenHeaderLinks} hidden)`);
  if (facts.tapTargetFailures.length) failures.push(`${facts.tapTargetFailures.length} visible links below 44x44 CSS pixels`);
  if (facts.overflowPixels > 1) failures.push(`horizontal overflow ${facts.overflowPixels}px`);
  if (browserMessages.length) failures.push(`${browserMessages.length} browser warnings/errors`);
  if (externalRequests.length) failures.push(`${externalRequests.length} external requests`);
  if (route === "/" || route === "/de") {
    if (facts.videoCount !== 1) failures.push(`video count ${facts.videoCount}`);
    if (!video?.controls || video?.autoplay || !video?.paused) failures.push("video control/autoplay policy mismatch");
    if (video?.poster !== "/assets/garden-growth-poster.png") failures.push("video poster mismatch");
    if (video?.videoWidth !== 1280 || video?.videoHeight !== 720) failures.push("video dimensions mismatch");
    if (!video || video.duration < 9 || video.duration > 11 || video.currentTime < 4.5) failures.push("video metadata/seek mismatch");
  } else if (facts.videoCount !== 0) {
    failures.push(`unexpected video count ${facts.videoCount}`);
  }

  await context.close();
  return {
    route,
    viewport: viewport.id,
    dimensions: `${viewport.width}x${viewport.height}`,
    status: failures.length ? "failed" : "passed",
    failures,
    facts,
    video,
    browser_messages: browserMessages,
    external_requests: externalRequests,
  };
}

async function inspectLanguageRoundTrip(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const externalRequests = [];
  await page.route("**/*", (requestRoute) => fulfillFromDist(requestRoute, externalRequests));
  await page.goto(`${ORIGIN}/`, { waitUntil: "load" });
  await page.locator("a.language-link").click();
  const german = { path: new URL(page.url()).pathname, language: await page.locator("html").getAttribute("lang"), h1: await page.locator("h1").innerText() };
  await page.locator("a.language-link").click();
  const english = { path: new URL(page.url()).pathname, language: await page.locator("html").getAttribute("lang"), h1: await page.locator("h1").innerText() };
  await context.close();
  const passed = german.path === "/de" && german.language === "de" && english.path === "/" && english.language === "en" && externalRequests.length === 0;
  return { status: passed ? "passed" : "failed", german, english, external_requests: externalRequests };
}

async function inspectReducedMotion(browser) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const externalRequests = [];
  await page.route("**/*", (requestRoute) => fulfillFromDist(requestRoute, externalRequests));
  await page.goto(`${ORIGIN}/`, { waitUntil: "load" });
  const facts = await page.evaluate(() => ({
    copyAnimation: getComputedStyle(document.querySelector(".hero-copy > *")).animationName,
    imageAnimation: getComputedStyle(document.querySelector(".hero-atmosphere img")).animationName,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
  }));
  await context.close();
  const passed = facts.copyAnimation === "none" && facts.imageAnimation === "none" && facts.scrollBehavior === "auto" && externalRequests.length === 0;
  return { status: passed ? "passed" : "failed", facts, external_requests: externalRequests };
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const cases = [];
    for (const viewport of VIEWPORTS) {
      for (const route of ROUTES) cases.push(await inspectRoute(browser, route, viewport));
    }
    const languageRoundTrip = await inspectLanguageRoundTrip(browser);
    const reducedMotion = await inspectReducedMotion(browser);
    const failedCases = cases.filter((item) => item.status !== "passed");
    const homeVideoCases = cases.filter((item) => item.video);
    const report = {
      schema_version: 1,
      status: failedCases.length || languageRoundTrip.status !== "passed" || reducedMotion.status !== "passed" ? "failed" : "passed",
      generated_at: null,
      generation_time_policy: "omitted-for-byte-reproducibility",
      browser: "Playwright Chromium 1.61.1",
      served_from: "Playwright route fulfillment from Website/dist without a listening socket",
      external_network_policy: "blocked and treated as failure",
      routes: ROUTES,
      viewports: VIEWPORTS,
      cases,
      language_round_trip: languageRoundTrip,
      reduced_motion: reducedMotion,
      summary: {
        cases_total: cases.length,
        cases_passed: cases.length - failedCases.length,
        cases_failed: failedCases.length,
        browser_warnings_or_errors: cases.reduce((sum, item) => sum + item.browser_messages.length, 0),
        external_requests: cases.reduce((sum, item) => sum + item.external_requests.length, 0),
        horizontal_overflow_failures: cases.filter((item) => item.facts.overflowPixels > 1).length,
        tap_target_failures: cases.reduce((sum, item) => sum + item.facts.tapTargetFailures.length, 0),
        home_video_cases: homeVideoCases.length,
        home_video_cases_passed: homeVideoCases.filter((item) => item.status === "passed").length,
      },
    };
    await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "passed") throw new Error(`browser matrix failed: ${failedCases.length} route cases failed`);
    process.stdout.write(`Website browser matrix passed: ${cases.length}/${cases.length} route/viewport cases, ${homeVideoCases.length}/${homeVideoCases.length} video loads/seeks, selected browser/touch/visible icons, 44px link targets, reduced motion, and 0 external requests.\n`);
  } finally {
    await browser?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
