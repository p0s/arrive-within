#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  CURRENT_GARDEN_SCHEMA_SHA256,
  CURRENT_RENDERER_SOURCE_SHA256,
  isExactCurrentRendererArtifact,
} from "./public-media-drift-policy.mjs";

const projectRoot = resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(readFileSync(join(projectRoot, "Marketing/PublicMedia/output/manifest.json"), "utf8"));
const rendererSource = manifest.source.renderer_source_files
  .map((path) => `${path}\0${readFileSync(join(projectRoot, path))}`)
  .join("\0");
const actualRendererSourceSha256 = sha256(rendererSource);
const actualGardenSchemaSha256 = sha256(readFileSync(join(projectRoot, "Shared/GardenState.schema.json")));
const current = { manifest, currentRendererSourceSha256: actualRendererSourceSha256, currentGardenSchemaSha256: actualGardenSchemaSha256 };

assert.equal(actualRendererSourceSha256, CURRENT_RENDERER_SOURCE_SHA256, "renderer source digest must be the recorded current value");
assert.equal(actualGardenSchemaSha256, CURRENT_GARDEN_SCHEMA_SHA256, "GardenState schema digest must be the recorded current value");
assert.equal(isExactCurrentRendererArtifact(current), true, "regenerated media must bind the current renderer and schema");
assert.equal(isExactCurrentRendererArtifact({ ...current, currentRendererSourceSha256: `${CURRENT_RENDERER_SOURCE_SHA256.slice(0, -1)}0` }), false, "a near-match renderer digest must fail");
assert.equal(isExactCurrentRendererArtifact({ ...current, currentGardenSchemaSha256: `${CURRENT_GARDEN_SCHEMA_SHA256.slice(0, -1)}0` }), false, "a near-match schema digest must fail");
assert.equal(isExactCurrentRendererArtifact({ ...current, manifest: { ...manifest, source: { ...manifest.source, renderer_source_sha256: "0".repeat(64) } } }), false, "a manifest bound to different renderer bytes must fail");
assert.equal(isExactCurrentRendererArtifact({ ...current, manifest: { ...manifest, post_generation_change: { classification: "deferred" } } }), false, "a historical deferred-freeze exception must not survive current-source regeneration");

process.stdout.write("Renderer artifact drift policy passed: exact current renderer/media binding and four negative controls.\n");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
