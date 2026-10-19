#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const labRoot = resolve(scriptDirectory, "..");
const projectRoot = resolve(labRoot, "../..");
const rendererRoot = join(projectRoot, "Renderer");
const outputRoot = join(labRoot, "output");
const playwrightRoot = join(projectRoot, "Marketing/AppStoreScreenshots/node_modules");
const playwright = await import(pathToFileURL(join(playwrightRoot, "playwright/index.mjs")));
const sharpModule = await import(pathToFileURL(join(playwrightRoot, "sharp/dist/index.mjs")));
const sharp = sharpModule.default;
const port = 4183;
const origin = `http://127.0.0.1:${port}`;
const directions = ["verdant-atelier", "paper-sanctuary", "twilight-refuge"];
const presets = ["empty", "first-growth", "milestone-reveal", "micro-growth", "mature"];
const devices = {
  iphone: { width: 430, height: 932 },
  ipad: { width: 1024, height: 1366 },
};

mkdirSync(outputRoot, { recursive: true });
const temporaryFrames = mkdtempSync(join(tmpdir(), "arrive-within-garden-lab-"));
const server = startRendererServer();
let browser;
try {
  await waitForRenderer(server);
  browser = await playwright.chromium.launch({ headless: true });
  const results = [];
  const milestoneResults = [];
  const blockedRequests = [];
  const browserErrors = [];

  for (const [device, viewport] of Object.entries(devices)) {
    for (const direction of directions) {
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        locale: "en-US",
        colorScheme: "dark",
        reducedMotion: "no-preference",
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      await page.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === "127.0.0.1" && url.port === String(port)) return route.continue();
        blockedRequests.push(route.request().url());
        return route.abort("blockedbyclient");
      });
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });

      await page.goto(`${origin}/design-lab/?direction=${direction}&preset=empty&theme=dark`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.arriveWithinGardenDesignLab?.ready === true);
      const directionRoot = join(outputRoot, direction, device);
      mkdirSync(directionRoot, { recursive: true });
      for (const preset of presets) {
        await page.evaluate((value) => window.arriveWithinGardenDesignLab?.setPreset(value), preset);
        await page.waitForTimeout(preset === "milestone-reveal" ? 1_200 : 700);
        const path = join(directionRoot, `${preset}.png`);
        await page.screenshot({ path, type: "png", animations: "disabled" });
        const metadata = await sharp(path).metadata();
        if (metadata.format !== "png" || metadata.width !== viewport.width || metadata.height !== viewport.height || metadata.hasAlpha === true) {
          throw new Error(`${relative(projectRoot, path)} is not an opaque ${viewport.width} x ${viewport.height} PNG.`);
        }
        const diagnostics = await page.evaluate(() => window.arriveWithinGardenDesignLab?.diagnostics());
        results.push({
          direction,
          device,
          preset,
          path: relative(labRoot, path),
          sha256: sha256File(path),
          bytes: statSync(path).size,
          diagnostics,
        });
      }
      await context.close();
    }
  }

  for (const direction of directions) {
    const context = await browser.newContext({
      viewport: { width: 960, height: 720 },
      deviceScaleFactor: 1,
      locale: "en-US",
      colorScheme: "dark",
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1" && url.port === String(port)) return route.continue();
      blockedRequests.push(route.request().url());
      return route.abort("blockedbyclient");
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto(`${origin}/design-lab/?direction=${direction}&preset=first-growth&theme=dark&reduceMotion=1`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.arriveWithinGardenDesignLab?.ready === true);
    const milestoneRoot = join(outputRoot, direction, "milestones");
    mkdirSync(milestoneRoot, { recursive: true });
    for (let milestone = 1; milestone <= 15; milestone += 1) {
      await page.evaluate((value) => window.arriveWithinGardenDesignLab?.setMilestone(value), milestone);
      await page.waitForTimeout(220);
      const path = join(milestoneRoot, `${String(milestone).padStart(2, "0")}.png`);
      await page.screenshot({ path, type: "png", animations: "disabled" });
      milestoneResults.push({
        direction,
        milestone,
        path: relative(labRoot, path),
        sha256: sha256File(path),
        diagnostics: await page.evaluate(() => window.arriveWithinGardenDesignLab?.diagnostics()),
      });
    }
    await context.close();
  }

  if (blockedRequests.length > 0) throw new Error(`External network attempted: ${blockedRequests.join(", ")}`);
  if (browserErrors.length > 0) throw new Error(`Browser errors: ${browserErrors.join(" | ")}`);

  const contactSheets = [];
  for (const direction of directions) {
    const entries = results.filter((result) => result.direction === direction);
    const path = join(outputRoot, `${direction}-contact-sheet.jpg`);
    await createContactSheet(entries, path, direction);
    contactSheets.push({ direction, path: relative(labRoot, path), sha256: sha256File(path), bytes: statSync(path).size });
    const milestonePath = join(outputRoot, `${direction}-milestones.jpg`);
    await createContactSheet(
      milestoneResults.filter((entry) => entry.direction === direction).map((entry) => ({ ...entry, device: "matrix", preset: `milestone-${String(entry.milestone).padStart(2, "0")}` })),
      milestonePath,
      `${direction} · 15 milestones`,
    );
    contactSheets.push({ direction, kind: "milestones", path: relative(labRoot, milestonePath), sha256: sha256File(milestonePath), bytes: statSync(milestonePath).size });
  }

  const motionClips = [];
  for (const direction of directions) {
    for (const reducedMotion of [false, true]) {
      const path = join(outputRoot, direction, `motion-${reducedMotion ? "reduced" : "standard"}.mp4`);
      mkdirSync(dirname(path), { recursive: true });
      const clip = await captureMotionClip(browser, direction, reducedMotion, path, temporaryFrames);
      motionClips.push(clip);
    }
  }

  const sourceFiles = [
    "Renderer/src/scene.ts",
    "Renderer/src/visual-design.ts",
    "Renderer/src/visual-directions/verdant-atelier.ts",
    "Renderer/src/visual-directions/paper-sanctuary.ts",
    "Renderer/src/visual-directions/twilight-refuge.ts",
    "Renderer/design-lab/index.html",
    "Renderer/design-lab/lab.css",
    "Renderer/design-lab/lab.ts",
  ];
  const manifest = {
    schema_version: 1,
    state: "local-design-candidates-owner-selection-pending",
    generated_at: new Date().toISOString(),
    source: {
      generator: relative(projectRoot, fileURLToPath(import.meta.url)),
      generator_sha256: sha256File(fileURLToPath(import.meta.url)),
      files: sourceFiles.map((path) => ({ path, sha256: sha256File(join(projectRoot, path)) })),
    },
    capture: {
      renderer_authority: "shared-versioned-GardenState-v1",
      external_network: "blocked",
      external_requests_observed: 0,
      device_viewports: devices,
      directions,
      presets,
      stills: results,
      milestone_stills: milestoneResults,
      contact_sheets: contactSheets,
      motion_clips: motionClips,
    },
    shipping_boundary: {
      lab_route_in_app_bundle: false,
      unselected_direction_code_in_current_renderer_bundle: false,
      verified_by: "shipping renderer string exclusion plus Xcode resource boundary",
    },
    rights: {
      origin: "original procedural compositions",
      third_party_visual_assets: [],
      code_license: "MIT",
      media_license: "CC-BY-4.0",
    },
    review: {
      owner_selection: "pending",
      visual_qa: "pending",
      physical_performance: "pending",
    },
    claim_boundary: "Local deterministic design evidence only; it is not selected production art, physical-device performance, final TestFlight, or App Store proof.",
  };
  writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(outputRoot, "validation.json"), `${JSON.stringify({
    status: "passed-objective-generation",
    direction_count: directions.length,
    still_count: results.length,
    milestone_still_count: milestoneResults.length,
    motion_clip_count: motionClips.length,
    external_requests_observed: 0,
    owner_selection: "pending",
  }, null, 2)}\n`);
  writeFileSync(join(outputRoot, "validation.txt"), [
    "status: passed-objective-generation",
    `directions: ${directions.length}`,
    `stills: ${results.length}`,
    `milestone_stills: ${milestoneResults.length}`,
    `motion_clips: ${motionClips.length}`,
    "external_requests_observed: 0",
    "owner_selection: pending",
    "physical_performance: pending",
    "",
  ].join("\n"));
  writeFileSync(join(outputRoot, "DECISION_PACKET.md"), decisionPacket(results, milestoneResults, contactSheets, motionClips));
  console.log(`Garden design lab generated: ${results.length} stills, ${milestoneResults.length} milestone stills, ${motionClips.length} motion clips, ${contactSheets.length} contact sheets.`);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
  rmSync(temporaryFrames, { recursive: true, force: true });
}

async function captureMotionClip(browserInstance, direction, reducedMotion, outputPath, temporaryRoot) {
  const frameRoot = join(temporaryRoot, `${direction}-${reducedMotion ? "reduced" : "standard"}`);
  mkdirSync(frameRoot, { recursive: true });
  const context = await browserInstance.newContext({
    viewport: { width: 960, height: 720 },
    deviceScaleFactor: 1,
    locale: "en-US",
    colorScheme: "dark",
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" && url.port === String(port)) return route.continue();
    return route.abort("blockedbyclient");
  });
  await page.goto(`${origin}/design-lab/?direction=${direction}&preset=mature&theme=dark&reduceMotion=${reducedMotion ? "1" : "0"}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.arriveWithinGardenDesignLab?.ready === true);
  let frame = 0;
  const capture = async (count, interval) => {
    for (let index = 0; index < count; index += 1) {
      await page.screenshot({ path: join(frameRoot, `frame-${String(frame).padStart(4, "0")}.png`), animations: "allow" });
      frame += 1;
      await page.waitForTimeout(interval);
    }
  };
  await capture(8, 80);
  await page.evaluate(() => window.arriveWithinGardenDesignLab?.setPreset("micro-growth"));
  await capture(reducedMotion ? 8 : 14, 80);
  await page.evaluate(() => window.arriveWithinGardenDesignLab?.setPreset("pre-milestone"));
  await page.waitForTimeout(250);
  await page.evaluate(() => window.arriveWithinGardenDesignLab?.setPreset("milestone-reveal"));
  await capture(reducedMotion ? 10 : 18, 80);
  if (!reducedMotion) {
    const canvas = page.locator("#garden-canvas");
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.5);
      await page.mouse.down();
      for (let index = 0; index < 10; index += 1) {
        await page.mouse.move(box.x + box.width * (0.46 + index * 0.018), box.y + box.height * 0.5, { steps: 2 });
        await capture(1, 60);
      }
      await page.mouse.up();
      await page.evaluate(() => window.arriveWithinGardenDesignLab?.resetView());
      await capture(8, 70);
    }
  }
  await context.close();

  const ffmpeg = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-framerate", "12",
    "-i", join(frameRoot, "frame-%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", outputPath,
  ], { encoding: "utf8" });
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed for ${direction}: ${ffmpeg.stderr}`);
  return {
    direction,
    reduce_motion: reducedMotion,
    semantic_states: ["ordinary-micro-growth", "major-milestone-reveal", ...(reducedMotion ? [] : ["user-orbit", "reset"])],
    frame_count: frame,
    path: relative(labRoot, outputPath),
    sha256: sha256File(outputPath),
    bytes: statSync(outputPath).size,
  };
}

async function createContactSheet(entries, outputPath, title) {
  const cardWidth = 430;
  const cardHeight = 320;
  const columns = 5;
  const rows = Math.ceil(entries.length / columns);
  const composites = [];
  for (const [index, entry] of entries.entries()) {
    const image = await sharp(join(labRoot, entry.path)).resize(cardWidth, cardHeight - 44, { fit: "cover", position: "centre" }).jpeg({ quality: 88 }).toBuffer();
    const label = Buffer.from(`<svg width="${cardWidth}" height="44"><rect width="100%" height="100%" fill="#16231f"/><text x="14" y="28" fill="#f7f3e8" font-family="system-ui" font-size="16">${escapeXML(`${entry.device} · ${entry.preset}`)}</text></svg>`);
    const left = (index % columns) * cardWidth;
    const top = Math.floor(index / columns) * cardHeight;
    composites.push({ input: image, left, top });
    composites.push({ input: label, left, top: top + cardHeight - 44 });
  }
  const heading = Buffer.from(`<svg width="${columns * cardWidth}" height="72"><rect width="100%" height="100%" fill="#0f1b18"/><text x="24" y="46" fill="#f7f3e8" font-family="system-ui" font-size="30">${escapeXML(title)}</text></svg>`);
  await sharp({ create: { width: columns * cardWidth, height: rows * cardHeight + 72, channels: 3, background: "#0f1b18" } })
    .composite([{ input: heading, left: 0, top: 0 }, ...composites.map((item) => ({ ...item, top: item.top + 72 }))])
    .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
}

function startRendererServer() {
  const viteScript = join(rendererRoot, "node_modules/vite/bin/vite.js");
  return spawn(process.execPath, [viteScript, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: rendererRoot,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

async function waitForRenderer(serverProcess) {
  let output = "";
  serverProcess.stderr.on("data", (chunk) => { output += chunk.toString(); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (serverProcess.exitCode !== null) throw new Error(`Vite exited before readiness: ${output}`);
    try {
      const response = await fetch(`${origin}/design-lab/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Vite did not become ready: ${output}`);
}

function sha256File(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function escapeXML(value) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }

function decisionPacket(stills, milestones, contactSheets, motionClips) {
  const descriptions = {
    "verdant-atelier": ["Warm, alive, botanical", "Daylight tree remains the focal point", "Moderate geometry; highest foliage detail", "Natural-color contrast requires final UI sweep"],
    "paper-sanctuary": ["Tactile, quiet, illustrated", "Layered leaves create storybook depth", "Moderate draw-call cost; no texture assets", "Thin paper layers need final small-screen review"],
    "twilight-refuge": ["Sheltered, contemplative, luminous", "Amber growth accents read against indigo", "Moderate geometry; restrained particles", "Dark-value separation needs increased-contrast review"],
  };
  const rows = directions.map((direction) => {
    const metrics = [...stills, ...milestones].filter((entry) => entry.direction === direction).map((entry) => entry.diagnostics).filter(Boolean);
    const max = (key) => Math.max(...metrics.map((metric) => metric[key] ?? 0));
    const [emotion, hierarchy, complexity, risk] = descriptions[direction];
    return `| ${direction} | ${emotion} | ${hierarchy} | ${max("drawCalls")} | ${max("triangles")} | ${max("geometries")} | ${complexity} | ${risk} |`;
  });
  const links = directions.map((direction) => {
    const key = contactSheets.find((sheet) => sheet.direction === direction && sheet.kind !== "milestones");
    const matrix = contactSheets.find((sheet) => sheet.direction === direction && sheet.kind === "milestones");
    const standard = motionClips.find((clip) => clip.direction === direction && !clip.reduce_motion);
    const reduced = motionClips.find((clip) => clip.direction === direction && clip.reduce_motion);
    const link = (value) => value.replace(/^output\//, "");
    return `- **${direction}**: [matched phone/tablet states](${link(key.path)}) · [15 milestones](${link(matrix.path)}) · [standard motion](${link(standard.path)}) · [Reduced Motion](${link(reduced.path)})`;
  });
  return [
    "# Garden visual decision packet",
    "",
    "All three directions render the same validated GardenState, progression, milestone matrix, bridge, recovery behavior, and native fallback boundary. No third-party visual assets or network requests are used.",
    "",
    ...links,
    "- **Current safe baseline**: [previous deterministic milestone matrix](../../RendererVisualMatrix/output/contact-sheet-a.jpg)",
    "",
    "| Direction | Emotional quality | Visual hierarchy | Max draw calls | Max triangles | Max geometries | Complexity / package cost | Principal risk |",
    "| --- | --- | --- | ---: | ---: | ---: | --- | --- |",
    ...rows,
    "",
    "## Module pick sheet",
    "",
    "A selection can name one whole direction or explicitly combine: tree silhouette, palette, lighting, water treatment, ground flora, particles, camera composition, micro-growth, and milestone reveal. The result must be reconciled into one coherent production path; unselected modules and the lab route remain outside the app bundle.",
    "",
    "Owner selection: **pending**",
    "",
    "Claim boundary: local deterministic visual evidence only. Physical performance, final candidate integration, TestFlight, and App Store proof remain separate.",
    "",
  ].join("\n");
}
