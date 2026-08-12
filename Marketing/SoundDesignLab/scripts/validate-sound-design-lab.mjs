#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const labRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(labRoot, "../..");
const manifest = JSON.parse(readFileSync(join(labRoot, "output/manifest.json"), "utf8"));
const selection = JSON.parse(readFileSync(join(labRoot, "selection.json"), "utf8"));

assert(manifest.schema_version === 1, "unsupported sound-lab manifest");
assert(sha256(join(projectRoot, manifest.generator_path)) === manifest.generator_sha256, "sound-lab generator hash drifted");
assert(manifest.status === "objective-candidates-human-selection-pending", "sound-lab claim state drifted");
assert(selection.status === "owner-selection-pending", "sound selection state drifted");
assert(selection.ambience_selection === null && selection.bell_family_selection === null, "unreviewed sound candidate was selected");
assert(manifest.assets.length === 9, "sound lab must contain three ambiences and three two-bell families");

const ambiences = manifest.assets.filter((asset) => asset.role === "ambience-candidate");
const bells = manifest.assets.filter((asset) => asset.role === "bell-candidate");
assert(ambiences.length === 3 && bells.length === 6, "sound candidate role count drifted");
for (const asset of manifest.assets) {
  const path = safeArtifactPath(asset.path);
  assert(statSync(path).size === asset.bytes, `sound candidate byte count drifted: ${asset.path}`);
  assert(sha256(path) === asset.sha256, `sound candidate hash drifted: ${asset.path}`);
  assert(asset.channels === 1 && asset.sample_rate === 48_000, `sound candidate must remain 48 kHz mono: ${asset.path}`);
}
for (const asset of ambiences) {
  assert(asset.codec === "aac", `ambience must be AAC: ${asset.path}`);
  assert(Math.abs(asset.duration_seconds - 30) <= 0.02, `ambience loop duration drifted: ${asset.path}`);
  assert(asset.integrated_lufs >= -35 && asset.integrated_lufs <= -29, `ambience loudness left the audition band: ${asset.path}`);
  assert(asset.true_peak_dbtp <= -6, `ambience true peak is too high: ${asset.path}`);
}
for (const asset of bells) {
  assert(asset.codec.startsWith("pcm_"), `bell master must remain lossless PCM: ${asset.path}`);
  assert(asset.duration_seconds >= 4 && asset.duration_seconds <= 5.5, `bell duration drifted: ${asset.path}`);
  assert(asset.integrated_lufs >= -28 && asset.integrated_lufs <= -19, `bell loudness left the audition band: ${asset.path}`);
  assert(asset.true_peak_dbtp <= -3, `bell true peak is too high: ${asset.path}`);
}
assert(manifest.pending_human_checks.includes("owner selection"), "sound lab must retain the owner listening gate");
assert(manifest.release_boundary.includes("No candidate is selected or bundled"), "sound release exclusion is missing");

process.stdout.write("Sound design-lab validation passed: 3 ambiences, 3 bell families, objective levels/hashes bounded; human selection pending.\n");

function safeArtifactPath(path) {
  const absolute = resolve(labRoot, path);
  const relativePath = relative(join(labRoot, "output"), absolute);
  assert(relativePath !== "" && !relativePath.startsWith(".."), `sound candidate escaped output: ${path}`);
  return absolute;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
