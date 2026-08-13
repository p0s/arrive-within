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
  const styles = ["twilight", "hand-drawn", "stop-motion", "crochet", "claymation"];
  const phases = ["day", "dusk", "night"];
  const results = [];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const style of styles) {
      for (const state of states) {
        for (const phase of phases) {
        const url = new URL(`http://127.0.0.1:${port}/design-lab/`);
        url.searchParams.set("style", style);
        url.searchParams.set("preset", state.preset);
        url.searchParams.set("phase", phase);
        url.searchParams.set("reduceMotion", "1");
        url.searchParams.set("theme", "dark");
        await page.goto(url.href, { waitUntil: "networkidle" });
        await page.waitForFunction(() => window.arriveWithinGardenDesignLab?.ready === true);
        await page.waitForTimeout(180);

        const baseline = await diagnostics(page);
        const label = `${viewport.id}/${style}/${state.id}/${phase}`;
        assert(baseline.dayPhase === phase, `${label} resolved the wrong phase`);
        assert(baseline.revealActive === false, `${label} retained motion`);
        assert(baseline.worldRootCount === 1, `${label} retained more than one world root`);

        const alternateStyle = style === "twilight" ? "hand-drawn" : "twilight";
        await page.evaluate((value) => window.arriveWithinGardenDesignLab?.setStyle(value), alternateStyle);
        const switched = await diagnostics(page);
        const expectedAlternateDirection = alternateStyle === "twilight" ? "twilight-refuge" : alternateStyle;
        assert(switched.direction === expectedAlternateDirection, `${label} did not switch styles`);
        assert(switched.worldRootCount === 1, `${label} retained duplicate world roots after switching`);
        assert(switched.rebuildCount === baseline.rebuildCount + 1, `${label} did not atomically rebuild once`);
        await page.evaluate((value) => window.arriveWithinGardenDesignLab?.setStyle(value), style);
        const restored = await diagnostics(page);
        const expectedDirection = style === "twilight" ? "twilight-refuge" : style;
        assert(restored.direction === expectedDirection, `${label} did not restore its style`);
        assert(restored.worldRootCount === 1, `${label} retained duplicate roots after style restore`);
        assert(restored.rebuildCount === baseline.rebuildCount + 2, `${label} style restore rebuilt unexpectedly`);

        await page.evaluate(() => window.arriveWithinGardenDesignLab?.setQuality("low"));
        const lowQuality = await diagnostics(page);
        assert(lowQuality.styleDetailEnabled === false, `${label} kept style detail at low quality`);
        assert(lowQuality.worldRootCount === 1, `${label} retained duplicate roots at low quality`);
        assert(lowQuality.worldFeatureCount === baseline.worldFeatureCount, `${label} lost authored features at low quality`);
        if (baseline.styleTextureCount > 0) {
          assert(lowQuality.styleTextureCount < baseline.styleTextureCount, `${label} did not reduce style textures at low quality`);
        }
        await page.evaluate(() => window.arriveWithinGardenDesignLab?.setQuality("high"));
        const orbitBaseline = await diagnostics(page);
        assert(orbitBaseline.styleDetailEnabled === true, `${label} did not restore style detail`);
        const canvas = await page.locator("#garden-canvas").boundingBox();
        assert(canvas !== null, `${label} has no rendered canvas`);

        const reducedOrbit = await orbit(page, canvas, 0.5, 0.8);
        assert(reducedOrbit.orbitAngle === 0, `${label} moved the camera under Reduce Motion`);
        await page.evaluate(() => window.arriveWithinGardenDesignLab?.setReduceMotion(false));

        const right = await orbit(page, canvas, 0.5, 0.8);
        assert(right.orbitAngle > 0, `${label} did not orbit right`);
        assertLightingInvariant(orbitBaseline, right, `${label}/right`);

        await page.evaluate(() => window.arriveWithinGardenDesignLab?.resetView());
        const reset = await diagnostics(page);
        assert(reset.orbitAngle === 0, `${label} did not reset`);
        assertLightingInvariant(orbitBaseline, reset, `${label}/reset`);

        const left = await orbit(page, canvas, 0.5, 0.2);
        assert(left.orbitAngle < 0, `${label} did not orbit left`);
        assertLightingInvariant(orbitBaseline, left, `${label}/left`);
        await page.evaluate(() => window.arriveWithinGardenDesignLab?.resetView());
        await page.evaluate(() => window.arriveWithinGardenDesignLab?.setReduceMotion(true));

        const filename = `${viewport.id}-${style}-${state.id}-${phase}.png`;
        const screenshotPath = join(outputRoot, filename);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        const screenshot = await readFile(screenshotPath);
        assert(screenshot.byteLength > 20_000, `${filename} is not a substantive render`);
        results.push({
          viewport: viewport.id,
          style,
          width: viewport.width,
          height: viewport.height,
          state: state.id,
          phase,
          screenshot: filename,
          sha256: createHash("sha256").update(screenshot).digest("hex"),
          lighting: stableLighting(orbitBaseline),
          topology: stableTopology(orbitBaseline),
        });
        }
      }
    }
    await context.close();
  }

  assertDistinctRenderedStates(results);
  await proveReduceMotionInterruption(browser, port);
  const manifest = {
    schema_version: 1,
    fidelity: "headless Chromium WebGL2 design-lab with production scene and selected visual direction",
    direction: "one-world-five-material-styles",
    matrix: results,
    assertions: {
      rendered_matrix: "5 styles x 3 viewports x 2 maturity states x 3 local phases",
      orbit: "reset, left, and right preserve exposure and every authored world-light value",
      style_switch: "each switch and restore leaves exactly one live world root and releases the previous style root",
      low_quality: "low quality removes style detail and texture work while retaining authored milestone features",
      reduce_motion: "activation settles an in-progress milestone reveal and locks the authored camera",
      screenshot_hashes: "day/dusk/night and early/mature renders are distinct for every viewport",
      topology: "every render retains one world root and the same authoritative feature/detail/wildlife counts",
    },
  };
  await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`PASS Garden rendered QA: 90 renders, stable topology and orbit lighting, Reduce Motion interruption; output=${outputRoot}\n`);
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

function stableTopology(value) {
  return {
    worldRootCount: value.worldRootCount,
    worldFeatureCount: value.worldFeatureCount,
    worldDetailCount: value.worldDetailCount,
    worldBirdCount: value.worldBirdCount,
    worldGroundAnimalCount: value.worldGroundAnimalCount,
  };
}

function assertLightingInvariant(expected, actual, label) {
  assert(
    JSON.stringify(stableLighting(actual)) === JSON.stringify(stableLighting(expected)),
    `${label} changed world lighting or exposure`,
  );
  assert(actual.rebuildCount === expected.rebuildCount, `${label} rebuilt the world during orbit`);
  assert(
    JSON.stringify(stableTopology(actual)) === JSON.stringify(stableTopology(expected)),
    `${label} changed authoritative world topology`,
  );
}

function assertDistinctRenderedStates(results) {
  for (const viewport of new Set(results.map((result) => result.viewport))) {
    for (const style of new Set(results.map((result) => result.style))) {
      const viewportResults = results.filter((result) => result.viewport === viewport && result.style === style);
      assert(new Set(viewportResults.map((result) => result.sha256)).size === 6, `${viewport}/${style} early/mature day/dusk/night render states are not distinct`);
    }
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
