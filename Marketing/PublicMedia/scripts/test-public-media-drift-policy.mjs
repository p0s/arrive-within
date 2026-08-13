#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  FROZEN_GARDEN_SCHEMA_SHA256,
  FROZEN_RENDERER_SOURCE_SHA256,
  FROZEN_SOURCE_FILE_SHA256,
  CURRENT_GARDEN_SCHEMA_SHA256,
  CURRENT_RENDERER_SOURCE_SHA256,
  POST_PUBLICATION_CHANGED_PATHS,
  isExactPostPublicationMediaFreeze,
  isExactPostPublicationVisualMatrixFreeze,
} from "./public-media-drift-policy.mjs";

const projectRoot = resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(readFileSync(join(projectRoot, "Marketing/PublicMedia/output/manifest.json"), "utf8"));
const rendererSource = manifest.source.renderer_source_files
  .map((path) => `${path}\0${readFileSync(join(projectRoot, path))}`)
  .join("\0");
const currentFileSha256 = Object.fromEntries(
  manifest.source.renderer_source_files.map((path) => [path, sha256(readFileSync(join(projectRoot, path)))]),
);
const actualRendererSourceSha256 = sha256(rendererSource);
const actualGardenSchemaSha256 = sha256(readFileSync(join(projectRoot, "Shared/GardenState.schema.json")));
assert.equal(actualRendererSourceSha256, CURRENT_RENDERER_SOURCE_SHA256, "current renderer source digest must remain exact");
assert.equal(actualGardenSchemaSha256, CURRENT_GARDEN_SCHEMA_SHA256, "current Garden schema digest must remain exact");
const historicalManifest = {
  ...manifest,
  source: {
    ...manifest.source,
    renderer_source_sha256: FROZEN_RENDERER_SOURCE_SHA256,
    garden_state_schema_sha256: FROZEN_GARDEN_SCHEMA_SHA256,
  },
  post_generation_change: {
    classification: "post-publication-garden-media-regeneration-deferred",
    current_renderer_source_sha256: CURRENT_RENDERER_SOURCE_SHA256,
    current_garden_state_schema_sha256: CURRENT_GARDEN_SCHEMA_SHA256,
    changed_paths: POST_PUBLICATION_CHANGED_PATHS,
    fresh_browser_matrix: "skipped-host-denial-not-passed",
    current_garden_proof: "separate-provenance-bound-rendered-artifacts-and-deterministic-orbit-diagnostics",
    valid_until: "next-successful-current-source-public-media-regeneration",
    rationale: "The retained pre-enhancement renderer media is not current Garden proof. The fresh browser matrix was skipped after host denial and was not relabeled as passed. Regenerate, visually review, and hash-bind the media at the next successful current-source public-media regeneration.",
  },
};
const exact = {
  manifest: historicalManifest,
  currentRendererSourceSha256: actualRendererSourceSha256,
  currentGardenSchemaSha256: actualGardenSchemaSha256,
  currentFileSha256,
};

assert.equal(isExactPostPublicationMediaFreeze(exact), true, "the exact frozen-media boundary must pass");
assert.equal(isExactPostPublicationMediaFreeze({ ...exact, currentRendererSourceSha256: `${CURRENT_RENDERER_SOURCE_SHA256.slice(0, -1)}0` }), false, "a near-match source digest must fail");
assert.equal(isExactPostPublicationMediaFreeze({ ...exact, currentFileSha256: { ...currentFileSha256, "Renderer/src/bridge.ts": "0".repeat(64) } }), false, "an extra changed source file must fail");
assert.equal(isExactPostPublicationMediaFreeze({ ...exact, manifest: withAttestation({ valid_until: "expired" }) }), false, "an expired freeze must fail");
assert.equal(isExactPostPublicationMediaFreeze({ ...exact, manifest: withAttestation({ fresh_browser_matrix: "passed" }) }), false, "host-denied browser proof must not be relabeled as passed");
assert.equal(isExactPostPublicationMediaFreeze({ ...exact, manifest: withAttestation({ rationale: historicalManifest.post_generation_change.rationale.replace("not current Garden proof", "current") }) }), false, "the historical-media boundary must remain explicit");

const matrixManifest = JSON.parse(readFileSync(join(projectRoot, "Marketing/RendererVisualMatrix/output/manifest.json"), "utf8"));
const exactMatrix = { ...exact, manifest: matrixManifest };
assert.equal(isExactPostPublicationVisualMatrixFreeze(exactMatrix), true, "the exact historical visual matrix must pass");
assert.equal(isExactPostPublicationVisualMatrixFreeze({ ...exactMatrix, manifest: { ...matrixManifest, post_generation_change: { ...matrixManifest.post_generation_change, fresh_browser_matrix: "passed" } } }), false, "the historical visual matrix must not claim a fresh browser pass");

process.stdout.write("Renderer artifact drift policy passed: two exact historical freezes plus 6 negative controls.\n");

function withAttestation(change) {
  return { ...historicalManifest, post_generation_change: { ...historicalManifest.post_generation_change, ...change } };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
