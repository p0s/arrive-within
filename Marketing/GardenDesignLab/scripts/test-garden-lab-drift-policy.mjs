#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isExactPostPublicationGardenLabFreeze } from "./garden-lab-drift-policy.mjs";

const projectRoot = resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(readFileSync(join(projectRoot, "Marketing/GardenDesignLab/output/manifest.json"), "utf8"));
const currentSourceSha256 = Object.fromEntries(
  manifest.source.files.map((source) => [source.path, sha256(readFileSync(join(projectRoot, source.path)))]),
);

assert.equal(isExactPostPublicationGardenLabFreeze(manifest, currentSourceSha256), true, "the exact historical design lab must pass");
assert.equal(isExactPostPublicationGardenLabFreeze(manifest, { ...currentSourceSha256, "Renderer/src/visual-directions/twilight-refuge.ts": "0".repeat(64) }), false, "an extra changed file must fail");
assert.equal(isExactPostPublicationGardenLabFreeze(withAttestation({ valid_until: "expired" }), currentSourceSha256), false, "an expired freeze must fail");
assert.equal(isExactPostPublicationGardenLabFreeze(withAttestation({ fresh_browser_matrix: "passed" }), currentSourceSha256), false, "host-denied browser proof must not be relabeled as passed");
assert.equal(isExactPostPublicationGardenLabFreeze(withAttestation({ selected_direction: "paper-sanctuary" }), currentSourceSha256), false, "another selected direction must fail");

process.stdout.write("Garden design-lab drift policy passed: exact historical selection lab plus 4 negative controls.\n");

function withAttestation(change) {
  return { ...manifest, post_generation_change: { ...manifest.post_generation_change, ...change } };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
