#!/usr/bin/env node

// Optional host-integrated visual proof. The credential-free scripts/check and
// scripts/goal gates deliberately do not invoke this localhost/Chromium helper.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendererRoot = join(projectRoot, "Renderer");
const playwright = await import(
  pathToFileURL(join(projectRoot, "Marketing/AppStoreScreenshots/node_modules/playwright/index.mjs"))
);
const outputRoot = await resolveOutput(process.argv.slice(2));
const port = Number.parseInt(process.env.ARRIVE_WITHIN_GARDEN_QA_PORT ?? "4318", 10);
if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
  throw new Error("ARRIVE_WITHIN_GARDEN_QA_PORT must be an unprivileged TCP port.");
}

const server = spawn(
  process.execPath,
  [join(rendererRoot, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
  { cwd: rendererRoot, stdio: ["ignore", "ignore", "pipe"] },
);
let serverError = "";
server.stderr.setEncoding("utf8");
server.stderr.on("data", (chunk) => { serverError += chunk; });

let browser;
try {
  await waitForServer(`http://127.0.0.1:${port}/design-lab/`, server, () => serverError);
  browser = await playwright.chromium.launch({ headless: true });

  const viewports = [
    { id: "iphone", width: 430, height: 932 },
    { id: "ipad-portrait", width: 1_024, height: 1_366 },
    { id: "ipad-landscape", width: 1_366, height: 1_024 },
  ];
  const states = [
    { id: "early", preset: "first-growth" },
    { id: "mature", preset: "mature" },
  ];
  const phases = ["day", "night"];
  const results = [];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const state of states) {
      for (const phase of phases) {
        const url = new URL(`http://127.0.0.1:${port}/design-lab/`);
        url.searchParams.set("direction", "twilight-refuge");
        url.searchParams.set("preset", state.preset);
        url.searchParams.set("phase", phase);
        url.searchParams.set("reduceMotion", "1");
        url.searchParams.set("theme", "dark");
        await page.goto(url.href, { waitUntil: "networkidle" });
        await page.waitForFunction(() => window.arriveWithinGardenDesignLab?.ready === true);
        await page.waitForTimeout(180);

        const baseline = await diagnostics(page);
        assert(baseline.dayPhase === phase, `${viewport.id}/${state.id}/${phase} resolved the wrong phase`);
        assert(baseline.revealActive === false, `${viewport.id}/${state.id}/${phase} retained motion`);
        const canvas = await page.locator("#garden-canvas").boundingBox();
        assert(canvas !== null, `${viewport.id}/${state.id}/${phase} has no rendered canvas`);

        const right = await orbit(page, canvas, 0.5, 0.8);
        assert(right.orbitAngle > 0, `${viewport.id}/${state.id}/${phase} did not orbit right`);
        assertLightingInvariant(baseline, right, `${viewport.id}/${state.id}/${phase}/right`);

        await page.evaluate(() => window.arriveWithinGardenDesignLab?.resetView());
        const reset = await diagnostics(page);
        assert(reset.orbitAngle === 0, `${viewport.id}/${state.id}/${phase} did not reset`);
        assertLightingInvariant(baseline, reset, `${viewport.id}/${state.id}/${phase}/reset`);

        const left = await orbit(page, canvas, 0.5, 0.2);
        assert(left.orbitAngle < 0, `${viewport.id}/${state.id}/${phase} did not orbit left`);
        assertLightingInvariant(baseline, left, `${viewport.id}/${state.id}/${phase}/left`);
        await page.evaluate(() => window.arriveWithinGardenDesignLab?.resetView());

        const filename = `${viewport.id}-${state.id}-${phase}.png`;
        const screenshotPath = join(outputRoot, filename);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        const screenshot = await readFile(screenshotPath);
        assert(screenshot.byteLength > 20_000, `${filename} is not a substantive render`);
        results.push({
          viewport: viewport.id,
          width: viewport.width,
          height: viewport.height,
          state: state.id,
          phase,
          screenshot: filename,
          sha256: createHash("sha256").update(screenshot).digest("hex"),
          lighting: stableLighting(baseline),
        });
      }
    }
    await context.close();
  }

  assertDistinctRenderedStates(results);
  await proveReduceMotionInterruption(browser, port);
  const manifest = {
    schema_version: 1,
    fidelity: "headless Chromium WebGL2 design-lab with production scene and selected visual direction",
    direction: "twilight-refuge",
    matrix: results,
    assertions: {
      rendered_matrix: "3 viewports x 2 maturity states x 2 local phases",
      orbit: "reset, left, and right preserve exposure and every authored world-light value",
      reduce_motion: "activation settles an in-progress milestone reveal immediately",
      screenshot_hashes: "day/night and early/mature renders are distinct for every viewport",
    },
  };
  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`PASS Garden rendered QA: 12 renders, stable orbit lighting, Reduce Motion interruption; output=${outputRoot}\n`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

async function resolveOutput(args) {
  if (args.length === 0) return mkdtemp(join(tmpdir(), "arrive-within-garden-qa-"));
  if (args.length !== 2 || args[0] !== "--output") {
    throw new Error("Usage: node scripts/prove_garden_rendering.mjs [--output OUTPUT_DIRECTORY]");
  }
  const directory = resolve(args[1]);
  await mkdir(directory, { recursive: true });
  return directory;
}

async function waitForServer(url, child, readError) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Renderer server exited before readiness: ${readError()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Renderer server did not become ready: ${readError()}`);
}

async function diagnostics(page) {
  return page.evaluate(() => {
    const api = window.arriveWithinGardenDesignLab;
    if (api === undefined) throw new Error("Garden design-lab API is unavailable.");
    return api.diagnostics();
  });
}

async function orbit(page, canvas, from, to) {
  const y = canvas.y + canvas.height * 0.5;
  await page.mouse.move(canvas.x + canvas.width * from, y);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * to, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(50);
  return diagnostics(page);
}

function stableLighting(value) {
  return {
    toneMappingExposure: value.toneMappingExposure,
    hemisphereIntensity: value.hemisphereIntensity,
    sunIntensity: value.sunIntensity,
    sunPosition: value.sunPosition,
    fillIntensity: value.fillIntensity,
    fillPosition: value.fillPosition,
  };
}

function assertLightingInvariant(expected, actual, label) {
  assert(
    JSON.stringify(stableLighting(actual)) === JSON.stringify(stableLighting(expected)),
    `${label} changed world lighting or exposure`,
  );
  assert(actual.rebuildCount === expected.rebuildCount, `${label} rebuilt the world during orbit`);
}

function assertDistinctRenderedStates(results) {
  for (const viewport of new Set(results.map((result) => result.viewport))) {
    const viewportResults = results.filter((result) => result.viewport === viewport);
    assert(new Set(viewportResults.map((result) => result.sha256)).size === 4, `${viewport} render states are not distinct`);
  }
}

async function proveReduceMotionInterruption(browser, port) {
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  const page = await context.newPage();
  await page.goto(
    `http://127.0.0.1:${port}/design-lab/?direction=twilight-refuge&preset=first-growth&phase=night`,
    { waitUntil: "networkidle" },
  );
  await page.waitForFunction(() => window.arriveWithinGardenDesignLab?.ready === true);
  await page.evaluate(() => {
    const api = window.arriveWithinGardenDesignLab;
    if (api === undefined) throw new Error("Garden design-lab API is unavailable.");
    api.setPreset("mature");
    api.setReduceMotion(true);
  });
  const state = await diagnostics(page);
  assert(state.revealActive === false, "Reduce Motion did not settle the active reveal");
  assert(state.rebuildCount === 2, "Reduce Motion changed geometry instead of settling motion");
  await context.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
