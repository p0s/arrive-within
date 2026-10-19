#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rendererRoot = join(projectRoot, "Renderer");
const outputRoot = join(projectRoot, "Apps/ArriveWithin/Resources/GardenPreviews");
const playwright = await import(
  pathToFileURL(join(projectRoot, "Marketing/AppStoreScreenshots/node_modules/playwright/index.mjs")),
);
const port = Number.parseInt(process.env.ARRIVE_WITHIN_PREVIEW_PORT ?? "4319", 10);
const origin = `http://127.0.0.1:${port}`;
const styles = ["twilight", "hand-drawn", "stop-motion", "crochet", "claymation"];
const width = 612;
const height = 309;

await mkdir(outputRoot, { recursive: true });
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
  await waitForServer(`${origin}/design-lab/`, server, () => serverError);
  browser = await playwright.chromium.launch({ headless: true });
  for (const style of styles) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto(
      `${origin}/design-lab/?style=${encodeURIComponent(style)}&preset=mature&phase=day&reduceMotion=1&theme=dark`,
      { waitUntil: "networkidle" },
    );
    await page.waitForFunction(() => window.arriveWithinGardenDesignLab?.ready === true);
    await page.addStyleTag({ content: `
      html, body { width: ${width}px !important; height: ${height}px !important; margin: 0 !important; }
      body { padding: 0 !important; }
      #lab { width: ${width}px !important; height: ${height}px !important; display: block !important; }
      #lab-header, #lab-footer, #renderer-status { display: none !important; }
      #garden { width: ${width}px !important; height: ${height}px !important; border: 0 !important; border-radius: 18px !important; box-shadow: none !important; }
      #garden-canvas { width: ${width}px !important; height: ${height}px !important; }
    ` });
    await page.evaluate(() => window.arriveWithinGardenDesignLab?.resetView());
    await page.waitForTimeout(180);
    const diagnostics = await page.evaluate(() => window.arriveWithinGardenDesignLab?.diagnostics());
    if (diagnostics?.direction !== (style === "twilight" ? "twilight-refuge" : style)) {
      throw new Error(`Preview ${style} resolved the wrong renderer direction.`);
    }
    if (diagnostics?.dayPhase !== "day" || diagnostics.worldRootCount !== 1 || diagnostics.revealActive) {
      throw new Error(`Preview ${style} did not settle at the fixed mature day state.`);
    }
    const outputPath = join(outputRoot, `garden-preview-${style}.png`);
    await page.locator("#garden").screenshot({ path: outputPath, type: "png", animations: "disabled" });
    const png = await readFile(outputPath);
    if (png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) {
      throw new Error(`Preview ${style} is not ${width}x${height}.`);
    }
    await context.close();
  }
  process.stdout.write(`Captured ${styles.length} deterministic Garden previews at ${width}x${height}.\n`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

async function waitForServer(url, child, readError) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Renderer preview server exited: ${readError()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Renderer preview server did not become ready: ${readError()}`);
}
