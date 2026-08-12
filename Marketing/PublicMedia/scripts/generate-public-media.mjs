#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const mediaRoot = resolve(scriptDirectory, "..");
const projectRoot = resolve(mediaRoot, "../..");
const rendererRoot = join(projectRoot, "Renderer");
const outputRoot = join(mediaRoot, "output");
const framesRoot = join(outputRoot, "frames");
const port = 4177;
const origin = `http://127.0.0.1:${port}`;
const nodeBinary = "/opt/homebrew/Cellar/node/26.7.0/bin/node";
const ffmpegBinary = "/opt/homebrew/bin/ffmpeg";
const ffprobeBinary = "/opt/homebrew/bin/ffprobe";

const playwright = await import(pathToFileURL(join(projectRoot, "Marketing/AppStoreScreenshots/node_modules/playwright/index.mjs")));
const sharpModule = await import(pathToFileURL(join(projectRoot, "Marketing/AppStoreScreenshots/node_modules/sharp/dist/index.mjs")));
const sharp = sharpModule.default;

const planPath = join(mediaRoot, "growth-states.json");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
validatePlan(plan);

mkdirSync(framesRoot, { recursive: true });
const server = startRendererServer();
let browser;

try {
  await waitForRenderer();
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
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" && url.port === String(port)) {
      await route.continue();
      return;
    }
    blockedRequests.push(route.request().url());
    await route.abort("blockedbyclient");
  });
  const browserProblems = [];
  const browserNotices = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("frame-ancestors' is ignored when delivered via a <meta> element")) {
      browserProblems.push(`${message.type()}: ${message.text()}`);
    } else if (message.type() === "warning") {
      browserNotices.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserProblems.push(`pageerror: ${error.message}`));
  await page.goto(origin, { waitUntil: "networkidle" });
  try {
    await page.waitForFunction(() => typeof window.arriveWithinGarden?.receiveSnapshot === "function");
  } catch {
    const documentState = await page.evaluate(() => ({
      title: document.title,
      readyState: document.readyState,
      scripts: [...document.scripts].map((script) => script.src || "inline"),
      body: document.body?.innerText.slice(0, 500),
    }));
    throw new Error(`Renderer bridge did not become ready. browser=${JSON.stringify(browserProblems)} document=${JSON.stringify(documentState)}`);
  }

  const frames = [];
  for (const [index, stage] of plan.stages.entries()) {
    const state = makeGardenState(plan, stage, index);
    const envelope = {
      type: "state-snapshot",
      schemaVersion: 1,
      requestID: requestID(index),
      payload: { state },
    };
    await page.evaluate((snapshot) => window.arriveWithinGarden?.receiveSnapshot(snapshot), envelope);
    await page.waitForTimeout(250);
    const path = join(framesRoot, `${String(index + 1).padStart(2, "0")}-${stage.id}.png`);
    await page.locator("#garden").screenshot({ animations: "disabled", path, type: "png" });
    const metadata = await sharp(path).metadata();
    if (metadata.width !== 1280 || metadata.height !== 720 || metadata.hasAlpha === true) {
      throw new Error(`Unexpected frame properties for ${relative(projectRoot, path)}.`);
    }
    frames.push({
      id: stage.id,
      label: stage.label,
      path: relative(mediaRoot, path),
      sha256: sha256File(path),
      state_sha256: sha256Bytes(`${JSON.stringify(state)}\n`),
      journey_day: state.journeyDay,
      highest_milestone: state.highestMilestone,
    });
  }
  await context.close();
  if (blockedRequests.length !== 0) throw new Error(`External requests were attempted: ${blockedRequests.join(", ")}`);
  if (browserProblems.length !== 0) throw new Error(`Browser problems: ${browserProblems.join(" | ")}`);

  const videoPath = join(outputRoot, "garden-growth-v1.mp4");
  renderVideo(frames.map((frame) => join(mediaRoot, frame.path)), videoPath);
  const probe = probeVideo(videoPath);
  assertVideoProbe(probe);

  const finalFramePath = join(mediaRoot, frames.at(-1).path);
  const posterPath = join(outputRoot, "garden-growth-poster.png");
  await sharp(finalFramePath).png({ compressionLevel: 9, adaptiveFiltering: false }).toFile(posterPath);
  const socialPath = join(outputRoot, "social-preview.png");
  await renderSocialPreview(finalFramePath, socialPath);
  const contactSheetPath = join(outputRoot, "growth-contact-sheet.jpg");
  await renderContactSheet(frames, contactSheetPath);

  const outputFiles = [videoPath, posterPath, socialPath, contactSheetPath];
  const output = Object.fromEntries(outputFiles.map((path) => [relative(mediaRoot, path), {
    bytes: statSync(path).size,
    sha256: sha256File(path),
  }]));
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
      generator: "Marketing/PublicMedia/scripts/generate-public-media.mjs",
      generator_sha256: sha256File(fileURLToPath(import.meta.url)),
      plan: "Marketing/PublicMedia/growth-states.json",
      plan_sha256: sha256File(planPath),
      renderer_source_files: sourceFiles,
      renderer_source_sha256: sha256Bytes(rendererSource),
      garden_state_schema_sha256: sha256File(join(projectRoot, "Shared/GardenState.schema.json")),
      product_state: "safe synthetic GardenState values accepted by the shipping typed bridge and rendered by the real bundled Three.js renderer",
    },
    capture: {
      viewport: { width: 1280, height: 720, device_scale_factor: 1 },
      browser: playwright.chromium.name(),
      playwright_version: packageVersion(join(projectRoot, "Marketing/AppStoreScreenshots/node_modules/playwright/package.json")),
      external_network: "blocked",
      external_requests_observed: 0,
      reduce_motion: true,
      csp_execution_mode: "Playwright bypassCSP mirrors the shipping WKUserScript isolated-content-world injection while preserving the page's network/navigation contract for capture",
      browser_notices: [...new Set(browserNotices.map(normalizeBrowserNotice))],
      frames,
    },
    video: {
      path: relative(mediaRoot, videoPath),
      width: probe.streams[0].width,
      height: probe.streams[0].height,
      frame_rate: probe.streams[0].avg_frame_rate,
      pixel_format: probe.streams[0].pix_fmt,
      codec: probe.streams[0].codec_name,
      duration_seconds: Number(probe.format.duration),
      audio_streams: probe.streams.filter((stream) => stream.codec_type === "audio").length,
      transition: "six real deterministic renderer frames; 2.2 seconds per frame; 0.7-second dissolve; no generated interpolation",
    },
    toolchain: {
      node: process.version,
      playwright: packageVersion(join(projectRoot, "Marketing/AppStoreScreenshots/node_modules/playwright/package.json")),
      sharp: packageVersion(join(projectRoot, "Marketing/AppStoreScreenshots/node_modules/sharp/package.json")),
      ffmpeg: run(ffmpegBinary, ["-version"]).split("\n")[0],
      ffprobe: run(ffprobeBinary, ["-version"]).split("\n")[0],
    },
    output,
    rights: {
      code_license: "MIT",
      media_license: "CC-BY-4.0",
      third_party_visual_assets: [],
      claim: "Only the original Arrive Within renderer and safe synthetic product state are depicted; no generated icon concept, uncertain-rights reference, narration, or third-party visual is included.",
    },
    human_review: {
      contact_sheet: relative(mediaRoot, contactSheetPath),
      state: "pending",
      scope: ["visual quality", "truthful progression", "motion comfort", "README/website/social crop"],
    },
    claim_boundary: "This media proves local deterministic renderer output only. It is not physical-device performance, official CloudKit, signed-candidate, App Store, deployment, or public readback evidence.",
  };
  writeFileSync(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  validateManifest(manifest);
  writeFileSync(join(outputRoot, "validation.txt"), [
    "status: passed-local-public-media-contract",
    `frames: ${frames.length}`,
    `renderer_source_sha256: ${manifest.source.renderer_source_sha256}`,
    `video_sha256: ${output["output/garden-growth-v1.mp4"].sha256}`,
    `poster_sha256: ${output["output/garden-growth-poster.png"].sha256}`,
    `social_preview_sha256: ${output["output/social-preview.png"].sha256}`,
    `contact_sheet_sha256: ${output["output/growth-contact-sheet.jpg"].sha256}`,
    "external_requests_observed: 0",
    "human_review: pending",
    "release_ready: false",
    "",
  ].join("\n"));
  console.log(`Public media generated: ${frames.length} real renderer frames, ${probe.format.duration}s H.264 video, no external requests; human review pending.`);
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
  if (value.schema_version !== 1 || value.stages?.length !== 6) throw new Error("Public media plan must contain six stages.");
  let previousDay = -1;
  for (const stage of value.stages) {
    if (stage.journey_day <= previousDay || stage.highest_milestone !== Math.min(15, Math.floor(stage.journey_day / 2))) {
      throw new Error(`Invalid journey/milestone progression for ${stage.id}.`);
    }
    if (stage.qualifying_session_count < stage.journey_day || stage.micro_growth_ordinal !== stage.qualifying_session_count) {
      throw new Error(`Invalid session/micro-growth progression for ${stage.id}.`);
    }
    previousDay = stage.journey_day;
  }
}

function makeGardenState(value, stage, index) {
  const unlockedVariants = [];
  const activeCustomization = {};
  for (let milestone = 1; milestone <= stage.highest_milestone; milestone += 1) {
    const prefix = `m${String(milestone).padStart(2, "0")}`;
    unlockedVariants.push(`${prefix}-a`, `${prefix}-b`);
    activeCustomization[String(milestone)] = stage.journey_day >= 30 && milestone % 3 === 0 ? `${prefix}-b` : `${prefix}-a`;
  }
  return {
    schemaVersion: 1,
    gardenID: value.garden_id,
    gardenSeed: value.garden_seed,
    profileGenerationID: value.profile_generation_id,
    qualifyingSessionCount: stage.qualifying_session_count,
    totalQualifyingSeconds: stage.total_qualifying_seconds,
    journeyDay: stage.journey_day,
    highestMilestone: stage.highest_milestone,
    unlockedVariants,
    activeCustomization,
    microGrowthOrdinal: stage.micro_growth_ordinal,
    localTimePresentation: null,
    latestGrowthEvent: index === 0 ? null : {
      practiceEventID: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      sessionID: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      beforeMicroGrowthOrdinal: stage.micro_growth_ordinal - 1,
      afterMicroGrowthOrdinal: stage.micro_growth_ordinal,
      beforeJourneyDay: Math.max(0, stage.journey_day - 1),
      afterJourneyDay: stage.journey_day,
    },
    reduceMotion: value.reduce_motion,
    qualityHint: value.quality_hint,
  };
}

function requestID(index) {
  return `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

function startRendererServer() {
  const viteScript = join(rendererRoot, "node_modules/vite/bin/vite.js");
  return spawn(nodeBinary, [viteScript, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: rendererRoot,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

async function waitForRenderer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Timed out waiting for the local renderer server.");
}

function renderVideo(frames, outputPath) {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const frame of frames) args.push("-loop", "1", "-t", "2.2", "-i", frame);
  const filters = [];
  let input = "[0:v]";
  for (let index = 1; index < frames.length; index += 1) {
    const output = `[v${index}]`;
    filters.push(`${input}[${index}:v]xfade=transition=fade:duration=0.7:offset=${(index * 1.5).toFixed(1)}${output}`);
    input = output;
  }
  args.push(
    "-filter_complex", filters.join(";"),
    "-map", input,
    "-an",
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-threads", "1",
    "-fflags", "+bitexact",
    "-flags:v", "+bitexact",
    "-map_metadata", "-1",
    "-movflags", "+faststart",
    outputPath,
  );
  run(ffmpegBinary, args);
}

function probeVideo(path) {
  return JSON.parse(run(ffprobeBinary, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]));
}

function assertVideoProbe(probe) {
  const videoStreams = probe.streams.filter((stream) => stream.codec_type === "video");
  const audioStreams = probe.streams.filter((stream) => stream.codec_type === "audio");
  if (videoStreams.length !== 1 || audioStreams.length !== 0) throw new Error("Public video must contain exactly one video stream and no audio.");
  const stream = videoStreams[0];
  if (stream.codec_name !== "h264" || stream.width !== 1280 || stream.height !== 720 || stream.pix_fmt !== "yuv420p" || stream.avg_frame_rate !== "30/1") {
    throw new Error("Public video codec, dimensions, pixel format, or frame rate is invalid.");
  }
  const duration = Number(probe.format.duration);
  if (duration < 9.6 || duration > 9.8) throw new Error(`Unexpected public video duration ${duration}.`);
}

async function renderSocialPreview(finalFramePath, outputPath) {
  const garden = await sharp(finalFramePath).resize(710, 520, { fit: "cover" }).png().toBuffer();
  const overlay = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640">
      <style>
        .name{font:600 74px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;fill:#f7f0df;letter-spacing:-2px}
        .tag{font:400 34px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;fill:#d6dfcf}
        .small{font:500 17px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;fill:#d8b878;letter-spacing:1.5px}
      </style>
      <rect width="1280" height="640" fill="#102b24"/>
      <circle cx="48" cy="52" r="7" fill="#d8b878"/>
      <text x="48" y="250" class="name">Arrive</text>
      <text x="48" y="330" class="name">Within</text>
      <text x="48" y="392" class="tag">Meditation that grows.</text>
      <text x="48" y="520" class="small">PRIVATE · OFFLINE-FIRST · OPEN SOURCE</text>
      <rect x="544" y="60" width="686" height="520" rx="42" fill="#e7dfca" opacity="0.16"/>
    </svg>`);
  await sharp(overlay)
    .composite([{ input: garden, left: 520, top: 60 }])
    .flatten({ background: "#102b24" })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toFile(outputPath);
}

async function renderContactSheet(frames, outputPath) {
  const width = 960;
  const cellWidth = 320;
  const cellHeight = 205;
  const composites = [];
  for (const [index, frame] of frames.entries()) {
    const image = await sharp(join(mediaRoot, frame.path)).resize(cellWidth, 180, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
    composites.push({ input: image, left: (index % 3) * cellWidth, top: Math.floor(index / 3) * cellHeight });
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cellWidth}" height="25"><rect width="100%" height="100%" fill="#102b24"/><text x="12" y="18" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="14" fill="#f7f0df">${escapeXML(frame.label)}</text></svg>`);
    composites.push({ input: label, left: (index % 3) * cellWidth, top: Math.floor(index / 3) * cellHeight + 180 });
  }
  await sharp({ create: { width, height: cellHeight * 2, channels: 3, background: "#102b24" } })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toFile(outputPath);
}

function validateManifest(manifest) {
  if (manifest.capture.frames.length !== 6 || manifest.capture.external_requests_observed !== 0) throw new Error("Manifest capture contract failed.");
  if (manifest.video.audio_streams !== 0 || manifest.video.codec !== "h264" || manifest.video.pixel_format !== "yuv420p") throw new Error("Manifest video contract failed.");
  for (const [path, expected] of Object.entries(manifest.output)) {
    const actualPath = join(mediaRoot, path);
    if (!existsSync(actualPath) || sha256File(actualPath) !== expected.sha256 || statSync(actualPath).size !== expected.bytes) {
      throw new Error(`Output manifest mismatch for ${path}.`);
    }
  }
}

function packageVersion(path) {
  return JSON.parse(readFileSync(path, "utf8")).version;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.trim()}`);
  return result.stdout;
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
