#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendererRoot = join(root, "Renderer");
const playwright = await import(pathToFileURL(join(root, "Marketing/AppStoreScreenshots/node_modules/playwright/index.mjs")));
const port = 4186;
const origin = `http://127.0.0.1:${port}`;
const durationSeconds = Number(process.env.ARRIVE_WITHIN_RENDERER_SOAK_SECONDS ?? "1200");
if (!Number.isInteger(durationSeconds) || durationSeconds < 60) {
  throw new Error("Renderer soak duration must be an integer of at least 60 seconds.");
}

const output = join(root, ".evidence", "renderer", "selected-twilight-soak.json");
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
const server = spawn(process.execPath, [join(rendererRoot, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: rendererRoot,
  env: { ...process.env, NO_COLOR: "1" },
  stdio: ["ignore", "ignore", "pipe"],
});

let browser;
let context;
try {
  await waitForServer(server);
  browser = await playwright.chromium.launch({ headless: true });
  context = await browser.newContext({
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    locale: "en-US",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const externalRequests = [];
  const browserErrors = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" && url.port === String(port)) return route.continue();
    externalRequests.push(route.request().url());
    return route.abort("blockedbyclient");
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto(`${origin}/design-lab/?direction=twilight-refuge&preset=mature&theme=dark`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.arriveWithinGardenDesignLab?.ready === true);

  const startedAt = Date.now();
  const samples = [];
  const intervalSeconds = 10;
  while ((Date.now() - startedAt) / 1000 < durationSeconds) {
    await page.waitForTimeout(intervalSeconds * 1000);
    samples.push(await page.evaluate(() => ({
      elapsedMilliseconds: performance.now(),
      diagnostics: window.arriveWithinGardenDesignLab?.diagnostics(),
      frameMilliseconds: Number(document.body.dataset.frameMilliseconds ?? "NaN"),
      context: document.body.dataset.context ?? "available",
    })));
  }

  const final = samples.at(-1);
  const numericFrames = samples.map((sample) => sample.frameMilliseconds).filter(Number.isFinite);
  const resourceKeys = ["drawCalls", "triangles", "geometries", "textures", "programs"];
  const firstResources = Object.fromEntries(resourceKeys.map((key) => [key, samples[0]?.diagnostics?.[key]]));
  const finalResources = Object.fromEntries(resourceKeys.map((key) => [key, final?.diagnostics?.[key]]));
  const stableResources = resourceKeys.every((key) => firstResources[key] === finalResources[key]);
  const result = {
    schema_version: 1,
    status: externalRequests.length === 0 && browserErrors.length === 0 && stableResources && final?.diagnostics?.context === "available" ? "passed-local-browser-soak" : "failed",
    fidelity: "headless Chromium selected-renderer design-lab; not app-hosted simulator or physical-device proof",
    requested_duration_seconds: durationSeconds,
    elapsed_wall_seconds: (Date.now() - startedAt) / 1000,
    sample_interval_seconds: intervalSeconds,
    sample_count: samples.length,
    direction: final?.diagnostics?.direction,
    resource_baseline: firstResources,
    resource_final: finalResources,
    resource_counts_stable: stableResources,
    rebuild_count_initial: samples[0]?.diagnostics?.rebuildCount,
    rebuild_count_final: final?.diagnostics?.rebuildCount,
    context_final: final?.diagnostics?.context,
    measured_frame_milliseconds: {
      minimum: numericFrames.length ? Math.min(...numericFrames) : null,
      maximum: numericFrames.length ? Math.max(...numericFrames) : null,
      average: numericFrames.length ? numericFrames.reduce((sum, value) => sum + value, 0) / numericFrames.length : null,
    },
    external_requests_observed: externalRequests,
    browser_errors: browserErrors,
    source: {
      script: relative(root, fileURLToPath(import.meta.url)),
      renderer_bundle_manifest: JSON.parse(await readFile(join(rendererRoot, "dist", "renderer-manifest.json"), "utf8")),
    },
    claim_boundary: "This proves a genuine wall-clock selected-renderer browser soak with stable bounded resources. It does not prove SwiftUI/app-hosted, physical-device, frame pacing, working memory, thermal, energy, battery, audio interaction, or upgrade behavior.",
  };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  if (result.status !== "passed-local-browser-soak") throw new Error("Selected renderer soak failed its bounded checks.");
  process.stdout.write(`Selected Twilight renderer soak passed: ${result.elapsed_wall_seconds.toFixed(1)}s, ${result.sample_count} samples, stable ${resourceKeys.join("/")}.\n`);
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (server.exitCode === null) server.kill("SIGTERM");
}

async function waitForServer(process) {
  let stderr = "";
  process.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`Renderer server exited before readiness: ${stderr}`);
    try {
      const response = await fetch(`${origin}/design-lab/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Renderer server did not become ready: ${stderr}`);
}
