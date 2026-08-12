import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const REPOSITORY_ROOT = path.resolve(ROOT, "..");
const DIST = path.join(ROOT, "dist");
const REPORT = path.join(REPOSITORY_ROOT, "docs", "qa", "website", "browser-matrix.json");
const ROUTES = ["/", "/de", "/support", "/de/support", "/privacy", "/de/privacy", "/open-source", "/de/open-source"];
const VIEWPORTS = [
  { id: "desktop", width: 1440, height: 1000 },
  { id: "mobile", width: 390, height: 844 },
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

function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      try {
        const output = outputPathFor(request.url ?? "/");
        if (!output) {
          response.writeHead(400).end("Bad request");
          return;
        }
        const body = await readFile(output);
        const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        if (range) {
          const start = Number(range[1]);
          const requestedEnd = range[2] ? Number(range[2]) : body.byteLength - 1;
          const end = Math.min(requestedEnd, body.byteLength - 1);
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= body.byteLength) {
            response.writeHead(416, { "Content-Range": `bytes */${body.byteLength}` }).end();
            return;
          }
          const partial = body.subarray(start, end + 1);
          response.writeHead(206, {
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
            "Content-Length": partial.byteLength,
            "Content-Range": `bytes ${start}-${end}/${body.byteLength}`,
            "Content-Type": contentTypes.get(path.extname(output)) ?? "application/octet-stream",
          });
          response.end(partial);
          return;
        }
        response.writeHead(200, {
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
          "Content-Length": body.byteLength,
          "Content-Type": contentTypes.get(path.extname(output)) ?? "application/octet-stream",
        });
        response.end(body);
      } catch (error) {
        const status = error?.code === "ENOENT" ? 404 : 500;
        response.writeHead(status).end(status === 404 ? "Not found" : "Server error");
      }
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("local server did not expose a TCP port"));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function inspectRoute(browser, origin, route, viewport) {
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
  await page.route("**/*", async (requestRoute) => {
    const requestOrigin = new URL(requestRoute.request().url()).origin;
    if (requestOrigin !== origin) {
      externalRequests.push(requestRoute.request().url());
      await requestRoute.abort("blockedbyclient");
      return;
    }
    await requestRoute.continue();
  });

  const response = await page.goto(`${origin}${route}`, { waitUntil: "load" });
  const expectedLanguage = route.startsWith("/de") ? "de" : "en";
  const facts = await page.evaluate(() => ({
    documentLanguage: document.documentElement.lang,
    footerVisible: Boolean(document.querySelector("footer")?.getBoundingClientRect().height),
    h1Count: document.querySelectorAll("h1").length,
    imageCount: document.images.length,
    imagesMissingAlt: [...document.images].filter((image) => !image.alt.trim()).length,
    mainCount: document.querySelectorAll("main").length,
    overflowPixels: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    title: document.title,
    videoCount: document.querySelectorAll("video").length,
  }));

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

async function inspectLanguageRoundTrip(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${origin}/`, { waitUntil: "load" });
  await page.locator("a.language-link").click();
  const german = { path: new URL(page.url()).pathname, language: await page.locator("html").getAttribute("lang"), h1: await page.locator("h1").innerText() };
  await page.locator("a.language-link").click();
  const english = { path: new URL(page.url()).pathname, language: await page.locator("html").getAttribute("lang"), h1: await page.locator("h1").innerText() };
  await context.close();
  const passed = german.path === "/de" && german.language === "de" && english.path === "/" && english.language === "en";
  return { status: passed ? "passed" : "failed", german, english };
}

async function main() {
  const { server, origin } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const cases = [];
    for (const viewport of VIEWPORTS) {
      for (const route of ROUTES) cases.push(await inspectRoute(browser, origin, route, viewport));
    }
    const languageRoundTrip = await inspectLanguageRoundTrip(browser, origin);
    const failedCases = cases.filter((item) => item.status !== "passed");
    const report = {
      schema_version: 1,
      status: failedCases.length || languageRoundTrip.status !== "passed" ? "failed" : "passed",
      generated_at: null,
      generation_time_policy: "omitted-for-byte-reproducibility",
      browser: "Playwright Chromium 1.61.1",
      served_from: "127.0.0.1 ephemeral port",
      external_network_policy: "blocked and treated as failure",
      routes: ROUTES,
      viewports: VIEWPORTS,
      cases,
      language_round_trip: languageRoundTrip,
      summary: {
        cases_total: cases.length,
        cases_passed: cases.length - failedCases.length,
        cases_failed: failedCases.length,
        browser_warnings_or_errors: cases.reduce((sum, item) => sum + item.browser_messages.length, 0),
        external_requests: cases.reduce((sum, item) => sum + item.external_requests.length, 0),
        horizontal_overflow_failures: cases.filter((item) => item.facts.overflowPixels > 1).length,
        home_video_cases: cases.filter((item) => item.video).length,
        home_video_cases_passed: cases.filter((item) => item.video && item.status === "passed").length,
      },
    };
    await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "passed") throw new Error(`browser matrix failed: ${failedCases.length} route cases failed`);
    process.stdout.write(`Website browser matrix passed: ${cases.length}/${cases.length} route/viewport cases, 4/4 video loads/seeks, 0 external requests.\n`);
  } finally {
    await browser?.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
