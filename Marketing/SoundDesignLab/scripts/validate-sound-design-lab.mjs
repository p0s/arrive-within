#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const labRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(labRoot, "../..");
const manifest = JSON.parse(readFileSync(join(labRoot, "output/manifest.json"), "utf8"));
const selection = JSON.parse(readFileSync(join(labRoot, "selection.json"), "utf8"));
const shippingManifest = JSON.parse(
  readFileSync(join(projectRoot, "Apps/ArriveWithin/Resources/Audio/audio-assets.json"), "utf8"),
);

assert(manifest.schema_version === 1, "unsupported sound-lab manifest");
assert(sha256(join(projectRoot, manifest.generator_path)) === manifest.generator_sha256, "sound-lab generator hash drifted");
assert(manifest.status === "objective-candidates-ready-for-selection", "sound-lab claim state drifted");
assert(
  selection.status === "owner-selected-bundled-baseline-remastered-after-device-failure",
  "sound selection state drifted",
);
assert(selection.selection_date === "2026-08-13", "sound selection date drifted");
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
const shippingByID = new Map(shippingManifest.assets.map((asset) => [asset.id, asset]));
verifyShippingSelection(selection.ambience_selection);
verifyShippingSelection(selection.bell_family_selection.opening);
verifyShippingSelection(selection.bell_family_selection.closing_and_interval);
assert(shippingManifest.human_qa === "pending", "physical audio QA must remain explicitly pending");

const labCandidateIDs = new Set(
  manifest.assets.map((asset) => basename(asset.path).replace(/\.(m4a|wav)$/, "")),
);
const selectedShippingHashes = new Set([
  selection.ambience_selection.sha256,
  selection.bell_family_selection.opening.sha256,
  selection.bell_family_selection.closing_and_interval.sha256,
]);
assert(
  manifest.assets.every((asset) => !selectedShippingHashes.has(asset.sha256)),
  "a non-shipping lab candidate was silently treated as the selected baseline",
);
for (const id of selection.eligible_ambience_ids) {
  assert(labCandidateIDs.has(id), `missing ambience candidate: ${id}`);
}
for (const family of selection.eligible_bell_family_ids) {
  assert(
    labCandidateIDs.has(`${family}-opening`) && labCandidateIDs.has(`${family}-closing`),
    `missing bell family: ${family}`,
  );
}
assert(
  selection.unselected_lab_candidate_ids.length === 6,
  "all six lab directions/families must remain explicitly unselected",
);
assert(
  manifest.pending_human_checks.includes("candidate owner selection before promotion"),
  "candidate promotion must retain a new owner-selection gate",
);
assert(manifest.release_boundary.includes("non-shipping candidates only"), "sound release exclusion is missing");
assert(
  selection.physical_qa.includes("still requires exact-candidate human"),
  "selection must not overstate physical audio QA",
);

process.stdout.write("Sound design-lab validation passed: remastered bundled baseline stays selected; 3 ambience and 3 bell-family alternatives remain non-shipping; exact-candidate human audio QA pending.\n");

function verifyShippingSelection(selected) {
  const bundled = shippingByID.get(selected.id);
  assert(bundled !== undefined, `selected shipping asset is absent: ${selected.id}`);
  assert(bundled.path === selected.path, `selected shipping path drifted: ${selected.id}`);
  assert(bundled.sha256 === selected.sha256, `selected shipping hash drifted: ${selected.id}`);
  assert(
    sha256(join(projectRoot, "Apps/ArriveWithin/Resources", selected.path)) === selected.sha256,
    `selected shipping bytes drifted: ${selected.id}`,
  );
}

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
