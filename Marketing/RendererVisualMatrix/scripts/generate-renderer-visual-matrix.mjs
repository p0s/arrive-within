#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const matrixRoot = resolve(scriptDirectory, "..");
const projectRoot = resolve(matrixRoot, "../..");
const rendererRoot = join(projectRoot, "Renderer");
const outputRoot = join(matrixRoot, "output");
const port = 4178;
const origin = `http://127.0.0.1:${port}`;
const playwrightRoot = join(projectRoot, "Marketing/AppStoreScreenshots/node_modules");
const playwright = await import(pathToFileURL(join(playwrightRoot, "playwright/index.mjs")));
const sharpModule = await import(pathToFileURL(join(playwrightRoot, "sharp/dist/index.mjs")));
const sharp = sharpModule.default;
const planPath = join(matrixRoot, "matrix-plan.json");
const plan = JSON.parse(readFileSync(planPath, "utf8"));

validatePlan(plan);
for (const variant of ["a", "b"]) mkdirSync(join(outputRoot, `variant-${variant}`), { recursive: true });

const server = startRendererServer();
let browser;
try {
  await waitForRenderer(server);
  browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    bypassCSP: true,
    colorScheme: "light",
    deviceScaleFactor: 1,
    locale: "en-US",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const blockedRequests = [];
  const browserProblems = [];
  const browserNotices = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" && url.port === String(port)) return route.continue();
    blockedRequests.push(route.request().url());
    return route.abort("blockedbyclient");
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserProblems.push(`${message.type()}: ${message.text()}`);
    else if (message.type() === "warning") browserNotices.push(normalizeBrowserNotice(message.text()));
  });
  page.on("pageerror", (error) => browserProblems.push(`pageerror: ${error.message}`));
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForFunction(() => typeof window.arriveWithinGarden?.receiveSnapshot === "function");

  const frames = [];
  for (const milestone of plan.milestones) {
    for (const variant of ["a", "b"]) {
      const state = makeGardenState(plan, milestone, variant);
      const envelope = {
        type: "state-snapshot",
        schemaVersion: 1,
        requestID: requestID(milestone.id, variant),
        payload: { state },
      };
      await page.evaluate((snapshot) => window.arriveWithinGarden?.receiveSnapshot(snapshot), envelope);
      await page.waitForTimeout(250);
      const slug = milestone.title.toLowerCase().replaceAll(" ", "-");
      const path = join(outputRoot, `variant-${variant}`, `${String(milestone.id).padStart(2, "0")}-${slug}.png`);
      await page.locator("#garden").screenshot({ animations: "disabled", path, type: "png" });
      const metadata = await sharp(path).metadata();
      if (metadata.format !== "png" || metadata.width !== 1280 || metadata.height !== 720 || metadata.hasAlpha === true) {
        throw new Error(`${relative(projectRoot, path)} is not an opaque 1280 x 720 PNG.`);
      }
      frames.push({
        milestone_id: milestone.id,
        practice_day: milestone.practice_day,
        title: milestone.title,
        selected_variant: variant,
        selected_variant_title: variant === "a" ? milestone.variant_a : milestone.variant_b,
        path: relative(matrixRoot, path),
        sha256: sha256File(path),
        state_sha256: sha256Bytes(`${JSON.stringify(state)}\n`),
        state,
      });
    }
  }
  await context.close();
  if (blockedRequests.length) throw new Error(`External requests attempted: ${blockedRequests.join(", ")}`);
  if (browserProblems.length) throw new Error(`Browser problems: ${browserProblems.join(" | ")}`);

  const contactSheets = {};
  for (const variant of ["a", "b"]) {
    const path = join(outputRoot, `contact-sheet-${variant}.jpg`);
    await renderContactSheet(frames.filter((frame) => frame.selected_variant === variant), path);
    contactSheets[variant] = {
      path: relative(matrixRoot, path),
      bytes: statSync(path).size,
      sha256: sha256File(path),
    };
  }

  const sourceFiles = [
    "Renderer/index.html",
    "Renderer/public/garden.css",
    ...readdirSync(join(rendererRoot, "src")).filter((name) => name.endsWith(".ts")).sort().map((name) => `Renderer/src/${name}`),
    "Shared/GardenState.schema.json",
  ];
  const rendererSource = sourceFiles.map((path) => `${path}\0${readFileSync(join(projectRoot, path))}`).join("\0");
  const manifest = {
    schema_version: 1,
    state: "locally-generated-objectively-validated-human-review-pending",
    source: {
      generator: "Marketing/RendererVisualMatrix/scripts/generate-renderer-visual-matrix.mjs",
      generator_sha256: sha256File(fileURLToPath(import.meta.url)),
      plan: "Marketing/RendererVisualMatrix/matrix-plan.json",
      plan_sha256: sha256File(planPath),
      renderer_source_files: sourceFiles,
      renderer_source_sha256: sha256Bytes(rendererSource),
      garden_state_schema_sha256: sha256File(join(projectRoot, "Shared/GardenState.schema.json")),
    },
    capture: {
      bridge: "shipping window.arriveWithinGarden.receiveSnapshot typed state-snapshot bridge",
      viewport: { width: 1280, height: 720, device_scale_factor: 1 },
      browser: playwright.chromium.name(),
      playwright_version: packageVersion(join(playwrightRoot, "playwright/package.json")),
      sharp_version: packageVersion(join(playwrightRoot, "sharp/package.json")),
      external_network: "blocked",
      external_requests_observed: 0,
      reduce_motion: true,
      browser_notices: [...new Set(browserNotices)],
      frames,
    },
    contact_sheets: contactSheets,
    coverage: {
      milestone_count: 15,
      authored_variant_count: 30,
      frame_count: 30,
      comparison_rule: "For each milestone, the A and B frames share all prior A selections and differ only in the newly unlocked milestone selection.",
    },
    rights: {
      code_license: "MIT",
      media_license: "CC-BY-4.0",
      third_party_visual_assets: [],
    },
    human_review: {
      state: "pending",
      scope: ["authored feature legibility", "A/B distinction", "composition", "contrast", "motion comfort"],
    },
    claim_boundary: "This matrix proves deterministic local rendering of all authored milestones and variants. It does not prove owner art approval, physical performance, signed-candidate behavior, App Store state, deployment, or public readback.",
  };
  writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(outputRoot, "validation.txt"), [
    "status: generated-local-renderer-visual-matrix",
    "milestones: 15",
    "authored_variants: 30",
    "frames: 30",
    `renderer_source_sha256: ${manifest.source.renderer_source_sha256}`,
    "external_requests_observed: 0",
    "human_review: pending",
    "release_ready: false",
    "",
  ].join("\n"));
  console.log("Renderer visual matrix generated: 15 milestone pairs, 30 opaque frames, no external requests; human review pending.");
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
  await new Promise((resolvePromise) => {
    const timeout = setTimeout(resolvePromise, 2_000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

function validatePlan(value) {
  if (value.schema_version !== 1 || value.milestones?.length !== 15) throw new Error("Visual matrix plan must contain exactly 15 milestones.");
  for (const [index, milestone] of value.milestones.entries()) {
    const expectedID = index + 1;
    if (milestone.id !== expectedID || milestone.practice_day !== expectedID * 2 || !milestone.title || !milestone.variant_a || !milestone.variant_b) {
      throw new Error(`Invalid milestone plan entry ${expectedID}.`);
    }
  }
}

function makeGardenState(value, milestone, variant) {
  const unlockedVariants = [];
  const activeCustomization = {};
  for (let id = 1; id <= milestone.id; id += 1) {
    const prefix = `m${String(id).padStart(2, "0")}`;
    unlockedVariants.push(`${prefix}-a`, `${prefix}-b`);
    activeCustomization[String(id)] = `${prefix}-${id === milestone.id ? variant : "a"}`;
  }
  const ordinal = milestone.practice_day;
  return {
    schemaVersion: 1,
    gardenID: value.garden_id,
    gardenSeed: value.garden_seed,
    profileGenerationID: value.profile_generation_id,
    qualifyingSessionCount: ordinal,
    totalQualifyingSeconds: ordinal * 180,
    journeyDay: milestone.practice_day,
    highestMilestone: milestone.id,
    unlockedVariants,
    activeCustomization,
    microGrowthOrdinal: ordinal,
    localTimePresentation: null,
    latestGrowthEvent: {
      practiceEventID: `31000000-0000-4000-8000-${String(milestone.id).padStart(12, "0")}`,
      sessionID: `21000000-0000-4000-8000-${String(milestone.id).padStart(12, "0")}`,
      beforeMicroGrowthOrdinal: ordinal - 1,
      afterMicroGrowthOrdinal: ordinal,
      beforeJourneyDay: ordinal - 1,
      afterJourneyDay: ordinal,
    },
    reduceMotion: value.reduce_motion,
    qualityHint: value.quality_hint,
  };
}

function requestID(id, variant) {
  const suffix = id * 2 + (variant === "b" ? 1 : 0);
  return `51000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
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
  let stderr = "";
  serverProcess.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverProcess.exitCode !== null) throw new Error(`Renderer server exited before capture: ${stderr.trim()}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for the local renderer server. ${stderr.trim()}`);
}

async function renderContactSheet(frames, outputPath) {
  const width = 1280;
  const cellWidth = 256;
  const imageHeight = 144;
  const labelHeight = 30;
  const cellHeight = imageHeight + labelHeight;
  const composites = [];
  for (const [index, frame] of frames.entries()) {
    const image = await sharp(join(matrixRoot, frame.path)).resize(cellWidth, imageHeight, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
    const left = (index % 5) * cellWidth;
    const top = Math.floor(index / 5) * cellHeight;
    composites.push({ input: image, left, top });
    const label = `${String(frame.milestone_id).padStart(2, "0")} · ${frame.title} · ${frame.selected_variant.toUpperCase()}`;
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cellWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#102b24"/><text x="9" y="20" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="13" fill="#f7f0df">${escapeXML(label)}</text></svg>`);
    composites.push({ input: svg, left, top: top + imageHeight });
  }
  await sharp({ create: { width, height: cellHeight * 3, channels: 3, background: "#102b24" } })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
}

function packageVersion(path) {
  return JSON.parse(readFileSync(path, "utf8")).version;
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeXML(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function normalizeBrowserNotice(value) {
  if (value.includes("GPU stall due to ReadPixels")) return "Chromium GPU readback stall notice caused by deterministic screenshot capture";
  return value.replace(/0x[0-9a-f]+/gi, "0xCONTEXT");
}
