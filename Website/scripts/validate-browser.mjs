import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appStoreURL } from "../src/content.mjs";
import { UNBOUND_PUBLIC_BASE_URL } from "./lib.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const REPOSITORY_ROOT = path.resolve(ROOT, "..");
const DIST = path.join(ROOT, "dist");
const REPORT = path.join(REPOSITORY_ROOT, "docs", "qa", "website", "browser-matrix.json");
const REVIEW_ROOT = path.join(REPOSITORY_ROOT, "docs", "qa", "website", "seo-review-2026-08-28");
const REVIEW_MATRIX = path.join(REVIEW_ROOT, "route-seo-matrix.json");
const ORIGIN = UNBOUND_PUBLIC_BASE_URL;
const ROUTES = ["/", "/de", "/support", "/de/support", "/privacy", "/de/privacy", "/open-source", "/de/open-source"];
const ROUTE_CONTRACTS = {
  "/": { locale: "en", alternate: "/de", xDefault: "/", schema: ["Organization", "WebSite", "SoftwareApplication"] },
  "/de": { locale: "de", alternate: "/", xDefault: "/", schema: ["Organization", "WebSite", "SoftwareApplication"] },
  "/support": { locale: "en", alternate: "/de/support", xDefault: "/support", schema: ["Organization", "WebSite", "BreadcrumbList"] },
  "/de/support": { locale: "de", alternate: "/support", xDefault: "/support", schema: ["Organization", "WebSite", "BreadcrumbList"] },
  "/privacy": { locale: "en", alternate: "/de/privacy", xDefault: "/privacy", schema: ["Organization", "WebSite", "BreadcrumbList"] },
  "/de/privacy": { locale: "de", alternate: "/privacy", xDefault: "/privacy", schema: ["Organization", "WebSite", "BreadcrumbList"] },
  "/open-source": { locale: "en", alternate: "/de/open-source", xDefault: "/open-source", schema: ["Organization", "WebSite", "BreadcrumbList"] },
  "/de/open-source": { locale: "de", alternate: "/open-source", xDefault: "/open-source", schema: ["Organization", "WebSite", "BreadcrumbList"] },
};
const VIEWPORTS = [
  { id: "desktop", width: 1440, height: 1000 },
  { id: "mobile", width: 390, height: 844 },
  { id: "compact", width: 320, height: 700 },
];
const CAPTURE_REVIEW = process.argv.includes("--capture-review");
const unexpectedArguments = process.argv.slice(2).filter((argument) => argument !== "--capture-review");
if (unexpectedArguments.length) throw new Error(`unsupported browser validation arguments: ${unexpectedArguments.join(", ")}`);
const SCREENSHOT_CASES = new Map([
  ["desktop:/", "en-home-desktop.png"],
  ["mobile:/de", "de-home-mobile.png"],
  ["mobile:/support", "en-support-mobile.png"],
  ["desktop:/de/open-source", "de-open-source-desktop.png"],
]);
const AVAILABILITY_SCREENSHOT_CASES = new Map([
  ["desktop:/", "en-availability-desktop.png"],
  ["mobile:/de", "de-availability-mobile.png"],
]);

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
  const contract = ROUTE_CONTRACTS[route];
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
    const schemaTypes = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .flatMap((script) => {
        const payload = JSON.parse(script.textContent || "{}");
        return Array.isArray(payload["@graph"]) ? payload["@graph"].map((item) => item["@type"]) : [];
      });
    const links = [...document.querySelectorAll("a[href]")].map((link) => ({
      href: /** @type {HTMLAnchorElement} */ (link).href,
      text: link.textContent?.trim() || link.getAttribute("aria-label") || "",
    }));
    return {
      alternateLinks: [...document.querySelectorAll('link[rel="alternate"]')].map((link) => ({
        hreflang: /** @type {HTMLLinkElement} */ (link).hreflang,
        href: /** @type {HTMLLinkElement} */ (link).href,
      })),
      appStoreLinkCount: links.filter((link) => link.href === "https://apps.apple.com/app/id6800192697").length,
      brandIconCount: document.querySelectorAll("img.brand-mark").length,
      brandIconsLoaded: [...document.querySelectorAll("img.brand-mark")].every((image) => image.complete && image.naturalWidth === 180 && image.naturalHeight === 180),
      breadcrumbCount: document.querySelectorAll(".breadcrumbs").length,
      breadcrumbItems: [...document.querySelectorAll(".breadcrumbs li")].map((item) => ({
        text: item.textContent?.trim() || "",
        href: item.querySelector("a") ? /** @type {HTMLAnchorElement} */ (item.querySelector("a")).pathname : null,
        current: item.getAttribute("aria-current") || null,
      })),
      browserIconPath: icon ? new URL(/** @type {HTMLLinkElement} */ (icon).href).pathname : null,
      canonical: /** @type {HTMLLinkElement | null} */ (document.querySelector('link[rel="canonical"]'))?.href || null,
      documentLanguage: document.documentElement.lang,
      externalLinks: [...new Set(links.map((link) => link.href).filter((href) => new URL(href).origin !== location.origin))].sort(),
      footerVisible: Boolean(document.querySelector("footer")?.getBoundingClientRect().height),
      h1Count: document.querySelectorAll("h1").length,
      h1Text: document.querySelector("h1")?.innerText || null,
      headerLinkCount: headerLinks.length,
      hiddenHeaderLinks: headerLinks.filter((element) => {
        const style = getComputedStyle(element);
        return style.display === "none" || style.visibility === "hidden";
      }).length,
      imageCount: document.images.length,
      imagesMissingAlt: [...document.images].filter((image) => !image.hasAttribute("alt") || (!image.alt.trim() && image.getAttribute("aria-hidden") !== "true")).length,
      internalLinkPaths: [...new Set(links.map((link) => link.href).filter((href) => new URL(href).origin === location.origin).map((href) => `${new URL(href).pathname}${new URL(href).hash}`))].sort(),
      mainCount: document.querySelectorAll("main").length,
      metaDescription: document.querySelector('meta[name="description"]')?.getAttribute("content") || null,
      ogLocaleAlternate: document.querySelector('meta[property="og:locale:alternate"]')?.getAttribute("content") || null,
      overflowPixels: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") || null,
      schemaTypes,
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
  if (!facts.metaDescription) failures.push("meta description is missing");
  if (facts.robots !== "index,follow") failures.push(`robots policy ${facts.robots}`);
  if (facts.canonical !== `${ORIGIN}${route}`) failures.push(`canonical ${facts.canonical}`);
  const counterpart = contract.locale === "en" ? "de" : "en";
  const expectedAlternates = [
    { hreflang: contract.locale, href: `${ORIGIN}${route}` },
    { hreflang: counterpart, href: `${ORIGIN}${contract.alternate}` },
    { hreflang: "x-default", href: `${ORIGIN}${contract.xDefault}` },
  ];
  if (JSON.stringify(facts.alternateLinks) !== JSON.stringify(expectedAlternates)) failures.push("hreflang set mismatch");
  if (facts.ogLocaleAlternate !== (contract.locale === "en" ? "de_DE" : "en_US")) failures.push(`Open Graph alternate locale ${facts.ogLocaleAlternate}`);
  if (JSON.stringify(facts.schemaTypes) !== JSON.stringify(contract.schema)) failures.push(`schema types ${facts.schemaTypes.join(",")}`);
  const expectedBreadcrumbCount = contract.schema.includes("BreadcrumbList") ? 1 : 0;
  if (facts.breadcrumbCount !== expectedBreadcrumbCount) failures.push(`breadcrumb count ${facts.breadcrumbCount}`);
  if (facts.appStoreLinkCount !== (route === "/" || route === "/de" ? 2 : 1)) failures.push(`App Store discovery link count ${facts.appStoreLinkCount}`);
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

  const screenshotName = SCREENSHOT_CASES.get(`${viewport.id}:${route}`);
  if (CAPTURE_REVIEW && screenshotName) {
    await page.waitForTimeout(1_600);
    await page.screenshot({ path: path.join(REVIEW_ROOT, screenshotName), fullPage: false });
    const availabilityScreenshotName = AVAILABILITY_SCREENSHOT_CASES.get(`${viewport.id}:${route}`);
    if (availabilityScreenshotName) {
      await page.locator(".availability-section").screenshot({ path: path.join(REVIEW_ROOT, availabilityScreenshotName) });
    }
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

function browserReportCase(item) {
  const facts = item.facts;
  return {
    ...item,
    facts: {
      brandIconCount: facts.brandIconCount,
      brandIconsLoaded: facts.brandIconsLoaded,
      browserIconPath: facts.browserIconPath,
      documentLanguage: facts.documentLanguage,
      footerVisible: facts.footerVisible,
      h1Count: facts.h1Count,
      headerLinkCount: facts.headerLinkCount,
      hiddenHeaderLinks: facts.hiddenHeaderLinks,
      imageCount: facts.imageCount,
      imagesMissingAlt: facts.imagesMissingAlt,
      mainCount: facts.mainCount,
      overflowPixels: facts.overflowPixels,
      tapTargetFailures: facts.tapTargetFailures,
      title: facts.title,
      touchIconPath: facts.touchIconPath,
      videoCount: facts.videoCount,
    },
  };
}

async function main() {
  let browser;
  try {
    if (CAPTURE_REVIEW) await mkdir(REVIEW_ROOT, { recursive: true });
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
      cases: cases.map(browserReportCase),
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
    if (CAPTURE_REVIEW) {
      const routeEvidence = cases
        .filter((item) => item.viewport === "desktop")
        .map((item) => ({
          route: item.route,
          title: item.facts.title,
          meta_description: item.facts.metaDescription,
          h1: item.facts.h1Text,
          canonical: item.facts.canonical,
          hreflang: item.facts.alternateLinks,
          robots: item.facts.robots,
          schema_types: item.facts.schemaTypes,
          breadcrumbs: item.facts.breadcrumbItems,
          app_store_link_count: item.facts.appStoreLinkCount,
          internal_link_paths: item.facts.internalLinkPaths,
          external_links: item.facts.externalLinks,
          screenshots: [
            [...SCREENSHOT_CASES.entries()].find(([key]) => key.endsWith(`:${item.route}`))?.[1],
            [...AVAILABILITY_SCREENSHOT_CASES.entries()].find(([key]) => key.endsWith(`:${item.route}`))?.[1],
          ].filter(Boolean),
        }));
      const reviewMatrix = {
        schema_version: 1,
        status: report.status,
        generated_at: null,
        generation_time_policy: "omitted-for-byte-reproducibility",
        evidence_origin: ORIGIN,
        evidence_boundary: "local deterministic build; not deployment or storefront proof",
        browser: report.browser,
        routes: routeEvidence,
      };
      await writeFile(REVIEW_MATRIX, `${JSON.stringify(reviewMatrix, null, 2)}\n`);
    }
    if (report.status !== "passed") throw new Error(`browser matrix failed: ${failedCases.length} route cases failed`);
    process.stdout.write(`Website browser matrix passed: ${cases.length}/${cases.length} route/viewport cases, ${homeVideoCases.length}/${homeVideoCases.length} video loads/seeks, canonical/hreflang/schema/breadcrumb checks, selected browser/touch/visible icons, 44px link targets, reduced motion, and 0 external requests${CAPTURE_REVIEW ? "; review matrix and 6 screenshots captured" : ""}.\n`);
  } finally {
    await browser?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
