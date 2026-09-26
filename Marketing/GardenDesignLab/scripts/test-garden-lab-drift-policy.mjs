#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isCurrentGardenDesignLab } from "./garden-lab-drift-policy.mjs";

const projectRoot = resolve(import.meta.dirname, "../../..");
const manifest = JSON.parse(readFileSync(join(projectRoot, "Marketing/GardenDesignLab/output/manifest.json"), "utf8"));
const currentSourceSha256 = Object.fromEntries(
  manifest.source.files.map((source) => [source.path, sha256(readFileSync(join(projectRoot, source.path)))]),
);

assert.equal(isCurrentGardenDesignLab(manifest, currentSourceSha256), true, "the regenerated design lab must bind all current source files");
assert.equal(isCurrentGardenDesignLab(manifest, { ...currentSourceSha256, "Renderer/src/visual-directions/twilight-refuge.ts": "0".repeat(64) }), false, "a changed source file must fail");
assert.equal(isCurrentGardenDesignLab(manifest, { ...currentSourceSha256, "Renderer/src/not-a-source.ts": "0".repeat(64) }), false, "an extra source file must fail");
assert.equal(isCurrentGardenDesignLab(withAttestation(), currentSourceSha256), false, "a historical deferral must not survive current-source regeneration");
assert.equal(isCurrentGardenDesignLab({ ...manifest, source: { ...manifest.source, files: manifest.source.files.slice(1) } }, currentSourceSha256), false, "an incomplete source manifest must fail");

process.stdout.write("Garden design-lab drift policy passed: exact current source binding plus 4 negative controls.\n");

function withAttestation() {
  return { ...manifest, post_generation_change: { classification: "historical-freeze" } };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
