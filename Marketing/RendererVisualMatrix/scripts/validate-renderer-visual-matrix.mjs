#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isExactPostPublicationVisualMatrixFreeze } from "../../PublicMedia/scripts/public-media-drift-policy.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const matrixRoot = resolve(scriptDirectory, "..");
const projectRoot = resolve(matrixRoot, "../..");
const outputRoot = join(matrixRoot, "output");
const sharpModule = await import(pathToFileURL(join(projectRoot, "Marketing/AppStoreScreenshots/node_modules/sharp/dist/index.mjs")));
const sharp = sharpModule.default;
const manifestPath = join(outputRoot, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const plan = JSON.parse(readFileSync(join(matrixRoot, "matrix-plan.json"), "utf8"));
const failures = [];
const checks = [];
const comparisonMetrics = [];

function check(id, passed, detail) {
  checks.push({ id, passed: Boolean(passed), detail });
  if (!passed) failures.push(`${id}: ${detail}`);
}

check("state", manifest.state === "locally-generated-objectively-validated-human-review-pending", "matrix must remain human-review pending");
check("claim-boundary", manifest.claim_boundary.includes("does not prove owner art approval") && manifest.human_review.state === "pending", "matrix must not overclaim art or release approval");
check("plan", plan.schema_version === 1 && plan.milestones.length === 15, "plan must contain exactly 15 milestones");
check("coverage", manifest.coverage.milestone_count === 15 && manifest.coverage.authored_variant_count === 30 && manifest.coverage.frame_count === 30 && manifest.capture.frames.length === 30, "all 15 A/B pairs must be captured");
check("network", manifest.capture.external_network === "blocked" && manifest.capture.external_requests_observed === 0, "capture must block network and observe zero external requests");
check("bridge", manifest.capture.bridge.includes("receiveSnapshot") && manifest.capture.viewport.width === 1280 && manifest.capture.viewport.height === 720, "capture must use the shipping bridge at the locked viewport");
check("rights", manifest.rights.code_license === "MIT" && manifest.rights.media_license === "CC-BY-4.0" && manifest.rights.third_party_visual_assets.length === 0, "matrix may include only original product visuals");

const generatorPath = join(projectRoot, manifest.source.generator);
check("generator-hash", sha256File(generatorPath) === manifest.source.generator_sha256, "generator hash must match");
check("plan-hash", sha256File(join(projectRoot, manifest.source.plan)) === manifest.source.plan_sha256, "plan hash must match");
const currentGardenSchemaSha256 = sha256File(join(projectRoot, "Shared/GardenState.schema.json"));
const rendererSource = manifest.source.renderer_source_files.map((path) => `${path}\0${readFileSync(join(projectRoot, path))}`).join("\0");
const currentRendererSourceSha256 = sha256Bytes(rendererSource);
const currentFileSha256 = Object.fromEntries(
  manifest.source.renderer_source_files.map((path) => [path, sha256File(join(projectRoot, path))]),
);
const sourceMatches =
  currentGardenSchemaSha256 === manifest.source.garden_state_schema_sha256 &&
  currentRendererSourceSha256 === manifest.source.renderer_source_sha256;
const exactPostPublicationFreeze = isExactPostPublicationVisualMatrixFreeze({
  manifest,
  currentRendererSourceSha256,
  currentGardenSchemaSha256,
  currentFileSha256,
});
check("schema-hash", currentGardenSchemaSha256 === manifest.source.garden_state_schema_sha256 || exactPostPublicationFreeze, "GardenState schema must match or retain the one exact historical-matrix boundary");
check("renderer-source-hash", currentRendererSourceSha256 === manifest.source.renderer_source_sha256 || exactPostPublicationFreeze, "renderer source must match or retain the one exact historical-matrix boundary");
check("post-generation-boundary", sourceMatches ? manifest.post_generation_change === undefined : exactPostPublicationFreeze, "source drift must be absent or exactly bound as a deferred historical matrix");

for (const milestone of plan.milestones) {
  const pair = manifest.capture.frames.filter((frame) => frame.milestone_id === milestone.id);
  check(`m${milestone.id}-pair`, pair.length === 2 && pair[0].selected_variant === "a" && pair[1].selected_variant === "b", "milestone must contain ordered A and B frames");
  for (const variant of ["a", "b"]) {
    const frame = pair.find((item) => item.selected_variant === variant);
    const state = frame?.state ?? {};
    const prefix = `m${String(milestone.id).padStart(2, "0")}`;
    check(`m${milestone.id}-${variant}-mapping`, frame?.practice_day === milestone.practice_day && frame?.title === milestone.title && frame?.selected_variant_title === milestone[`variant_${variant}`], "frame metadata must match the plan");
    check(`m${milestone.id}-${variant}-state`, state.journeyDay === milestone.practice_day && state.highestMilestone === milestone.id && state.microGrowthOrdinal === milestone.practice_day && state.qualifyingSessionCount === milestone.practice_day && state.totalQualifyingSeconds === milestone.practice_day * 180, "state progression must match the two-day milestone contract");
    check(`m${milestone.id}-${variant}-variants`, state.unlockedVariants?.length === milestone.id * 2 && Object.keys(state.activeCustomization ?? {}).length === milestone.id && state.activeCustomization?.[String(milestone.id)] === `${prefix}-${variant}`, "state must unlock the exact authored variants and select the current A/B candidate");
    check(`m${milestone.id}-${variant}-prior-selections`, Array.from({ length: milestone.id - 1 }, (_, index) => index + 1).every((id) => state.activeCustomization?.[String(id)] === `m${String(id).padStart(2, "0")}-a`), "A/B comparison must hold all prior milestones at A");
    check(`m${milestone.id}-${variant}-state-hash`, frame && sha256Bytes(`${JSON.stringify(state)}\n`) === frame.state_sha256, "embedded state hash must match");
    const framePath = frame ? join(matrixRoot, frame.path) : "";
    check(`m${milestone.id}-${variant}-hash`, frame && sha256File(framePath) === frame.sha256, "frame hash must match");
    if (frame) {
      const metadata = await sharp(framePath).metadata();
      check(`m${milestone.id}-${variant}-image`, metadata.format === "png" && metadata.width === 1280 && metadata.height === 720 && metadata.hasAlpha !== true, "frame must be an opaque 1280 x 720 PNG");
    }
  }
  if (pair.length === 2) {
    const aPath = join(matrixRoot, pair[0].path);
    const bPath = join(matrixRoot, pair[1].path);
    const a = await sharp(aPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const b = await sharp(bPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let changedPixels = 0;
    let absoluteDelta = 0;
    const channels = a.info.channels;
    for (let offset = 0; offset < a.data.length; offset += channels) {
      let pixelChanged = false;
      for (let channel = 0; channel < channels; channel += 1) {
        const delta = Math.abs(a.data[offset + channel] - b.data[offset + channel]);
        absoluteDelta += delta;
        if (delta !== 0) pixelChanged = true;
      }
      if (pixelChanged) changedPixels += 1;
    }
    const pixelCount = a.info.width * a.info.height;
    const metric = {
      milestone_id: milestone.id,
      changed_pixel_ratio: changedPixels / pixelCount,
      mean_absolute_channel_delta: absoluteDelta / a.data.length,
    };
    comparisonMetrics.push(metric);
    check(`m${milestone.id}-pair-distinct`, pair[0].sha256 !== pair[1].sha256 && metric.changed_pixel_ratio > 0 && metric.mean_absolute_channel_delta > 0, "A and B must produce objectively distinct rendered pixels");
  }
}

for (const variant of ["a", "b"]) {
  const entry = manifest.contact_sheets[variant];
  const path = join(matrixRoot, entry.path);
  check(`contact-${variant}-hash`, sha256File(path) === entry.sha256 && statSync(path).size === entry.bytes, "contact-sheet bytes and hash must match");
  const metadata = await sharp(path).metadata();
  check(`contact-${variant}-image`, metadata.format === "jpeg" && metadata.width === 1280 && metadata.height === 522, "contact sheet must be a 1280 x 522 JPEG");
}

const validationText = readFileSync(join(outputRoot, "validation.txt"), "utf8");
check("validation-text", validationText.includes("milestones: 15") && validationText.includes("authored_variants: 30") && validationText.includes("external_requests_observed: 0") && validationText.includes("human_review: pending") && validationText.includes("release_ready: false") && (!exactPostPublicationFreeze || (validationText.includes("current_source_state: regeneration-deferred-host-denial") && validationText.includes("current_garden_proof: separate"))), "plain-text validation must preserve complete coverage and current-source claim boundaries");

const report = {
  schema_version: 1,
  status: failures.length === 0 ? "passed-local-renderer-visual-matrix" : "failed",
  checks_passed: checks.filter((entry) => entry.passed).length,
  checks_failed: failures.length,
  milestone_count: 15,
  authored_variant_count: 30,
  frame_count: 30,
  comparison_metrics: comparisonMetrics,
  human_review: "pending",
  release_ready: false,
  manifest_sha256: sha256File(manifestPath),
  failures,
  checks,
};

if (process.argv.includes("--write-report")) writeFileSync(join(outputRoot, "validation.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Renderer visual matrix ${report.status}: ${report.checks_passed} passed, ${report.checks_failed} failed; human review pending.`);
for (const failure of failures) console.error(`error: ${failure}`);
process.exitCode = failures.length === 0 ? 0 : 1;

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}
