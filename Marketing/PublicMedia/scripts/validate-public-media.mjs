#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const mediaRoot = resolve(scriptDirectory, "..");
const projectRoot = resolve(mediaRoot, "../..");
const outputRoot = join(mediaRoot, "output");
const sharpModule = await import(pathToFileURL(join(projectRoot, "Marketing/AppStoreScreenshots/node_modules/sharp/dist/index.mjs")));
const sharp = sharpModule.default;
const manifest = JSON.parse(readFileSync(join(outputRoot, "manifest.json"), "utf8"));
const plan = JSON.parse(readFileSync(join(mediaRoot, "growth-states.json"), "utf8"));
const failures = [];
const checks = [];

function check(id, passed, detail) {
  checks.push({ id, passed: Boolean(passed), detail });
  if (!passed) failures.push(`${id}: ${detail}`);
}

check("state", manifest.state === "locally-generated-objectively-validated-human-review-pending", "media must remain human-review pending");
check("release-boundary", manifest.claim_boundary.includes("not physical-device") && manifest.human_review.state === "pending", "media must not claim release or human approval");
check("plan", plan.schema_version === 1 && plan.stages.length === 6 && manifest.capture.frames.length === 6, "six locked progression stages are required");
check("network", manifest.capture.external_network === "blocked" && manifest.capture.external_requests_observed === 0, "capture must block and observe zero external requests");
check("capture-mode", manifest.capture.reduce_motion === true && manifest.capture.csp_execution_mode.includes("WKUserScript"), "capture must be motion-stable and disclose its isolated-world CSP execution model");
check("rights", manifest.rights.code_license === "MIT" && manifest.rights.media_license === "CC-BY-4.0" && manifest.rights.third_party_visual_assets.length === 0, "only original product visuals may appear");

const generatorPath = join(projectRoot, manifest.source.generator);
check("generator-hash", sha256File(generatorPath) === manifest.source.generator_sha256, "generator hash must match");
check("plan-hash", sha256File(join(projectRoot, manifest.source.plan)) === manifest.source.plan_sha256, "plan hash must match");
check("schema-hash", sha256File(join(projectRoot, "Shared/GardenState.schema.json")) === manifest.source.garden_state_schema_sha256, "GardenState schema hash must match");
const rendererSource = manifest.source.renderer_source_files.map((path) => `${path}\0${readFileSync(join(projectRoot, path))}`).join("\0");
check("renderer-source-hash", sha256Bytes(rendererSource) === manifest.source.renderer_source_sha256, "renderer source hash must match the manifest");

let previousDay = -1;
for (const [index, frame] of manifest.capture.frames.entries()) {
  const stage = plan.stages[index];
  check(`frame-${index + 1}-mapping`, frame.id === stage.id && frame.label === stage.label && frame.journey_day === stage.journey_day && frame.highest_milestone === stage.highest_milestone, "frame must map exactly to its plan stage");
  check(`frame-${index + 1}-order`, frame.journey_day > previousDay && frame.highest_milestone === Math.min(15, Math.floor(frame.journey_day / 2)), "journey and milestone progression must be monotonic and contract-valid at one milestone per two practice days");
  previousDay = frame.journey_day;
  const framePath = join(mediaRoot, frame.path);
  check(`frame-${index + 1}-hash`, sha256File(framePath) === frame.sha256, "frame hash must match");
  const metadata = await sharp(framePath).metadata();
  check(`frame-${index + 1}-image`, metadata.format === "png" && metadata.width === 1280 && metadata.height === 720 && metadata.hasAlpha !== true, "frame must be opaque 1280 x 720 PNG");
}

for (const [path, expected] of Object.entries(manifest.output)) {
  const outputPath = join(mediaRoot, path);
  check(`output-${path}-hash`, sha256File(outputPath) === expected.sha256, "output hash must match");
  check(`output-${path}-bytes`, statSync(outputPath).size === expected.bytes, "output byte count must match");
}

const poster = await sharp(join(outputRoot, "garden-growth-poster.png")).metadata();
check("poster", poster.format === "png" && poster.width === 1280 && poster.height === 720 && poster.hasAlpha !== true, "poster must be opaque 1280 x 720 PNG");
const social = await sharp(join(outputRoot, "social-preview.png")).metadata();
check("social", social.format === "png" && social.width === 1280 && social.height === 640 && social.hasAlpha !== true, "social preview must be opaque 1280 x 640 PNG");
const contact = await sharp(join(outputRoot, "growth-contact-sheet.jpg")).metadata();
check("contact-sheet", contact.format === "jpeg" && contact.width === 960 && contact.height === 410, "contact sheet must be 960 x 410 JPEG");

const probe = JSON.parse(run("/opt/homebrew/bin/ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", join(outputRoot, "garden-growth-v1.mp4")]));
const videoStreams = probe.streams.filter((stream) => stream.codec_type === "video");
const audioStreams = probe.streams.filter((stream) => stream.codec_type === "audio");
check("video-stream-count", videoStreams.length === 1 && audioStreams.length === 0, "video must contain one video stream and no audio");
const video = videoStreams[0] ?? {};
check("video-format", video.codec_name === "h264" && video.width === 1280 && video.height === 720 && video.pix_fmt === "yuv420p" && video.avg_frame_rate === "30/1", "video must be 1280 x 720 H.264 yuv420p at 30 fps");
check("video-duration", Number(probe.format.duration) >= 9.6 && Number(probe.format.duration) <= 9.8, "video duration must remain in the 9.6–9.8 second window");
check("video-manifest", manifest.video.codec === video.codec_name && manifest.video.width === video.width && manifest.video.height === video.height && manifest.video.audio_streams === 0 && Math.abs(manifest.video.duration_seconds - Number(probe.format.duration)) < 0.000001, "video probe must match the manifest");

check("toolchain", manifest.toolchain.node === process.version && manifest.toolchain.playwright && manifest.toolchain.sharp && manifest.toolchain.ffmpeg.startsWith("ffmpeg version") && manifest.toolchain.ffprobe.startsWith("ffprobe version"), "toolchain versions must be explicit");
const validationText = readFileSync(join(outputRoot, "validation.txt"), "utf8");
check("validation-text", validationText.includes("status: passed-local-public-media-contract") && validationText.includes("human_review: pending") && validationText.includes("release_ready: false"), "plain-text validation must preserve human and release boundaries");

const report = {
  schema_version: 1,
  status: failures.length === 0 ? "passed-local-public-media-contract" : "failed",
  checks_passed: checks.filter((entry) => entry.passed).length,
  checks_failed: failures.length,
  human_review: "pending",
  release_ready: false,
  manifest_sha256: sha256File(join(outputRoot, "manifest.json")),
  failures,
  checks,
};

if (process.argv.includes("--write-report")) {
  writeFileSync(join(outputRoot, "validation.json"), `${JSON.stringify(report, null, 2)}\n`);
}

console.log(`Public media validation ${report.status}: ${report.checks_passed} passed, ${report.checks_failed} failed; human review pending.`);
for (const failure of failures) console.error(`error: ${failure}`);
process.exitCode = failures.length === 0 ? 0 : 1;

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
