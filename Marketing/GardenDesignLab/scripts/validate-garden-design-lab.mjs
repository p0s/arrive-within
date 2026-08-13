#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isExactPostPublicationGardenLabFreeze } from "./garden-lab-drift-policy.mjs";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const labRoot = resolve(scriptRoot, "..");
const projectRoot = resolve(labRoot, "../..");
const manifest = JSON.parse(readFileSync(join(labRoot, "output/manifest.json"), "utf8"));
const expectedDirections = ["paper-sanctuary", "twilight-refuge", "verdant-atelier"];

assert(manifest.schema_version === 1, "unsupported Garden design-lab manifest");
assert(manifest.state === "local-design-candidates-owner-selection-pending", "Garden lab claim state drifted");
assert(JSON.stringify([...manifest.capture.directions].sort()) === JSON.stringify(expectedDirections), "Garden directions drifted");
assert(manifest.capture.stills.length === 30, "Garden lab must contain 30 matched stills");
assert(manifest.capture.milestone_stills.length === 45, "Garden lab must contain all 45 direction/milestone stills");
assert(manifest.capture.motion_clips.length === 6, "Garden lab must contain standard and Reduced Motion clips for each direction");
assert(manifest.capture.contact_sheets.length === 6, "Garden lab must contain state and milestone contact sheets");
assert(manifest.capture.external_network === "blocked", "Garden lab must block external network access");
assert(manifest.shipping_boundary.lab_route_in_app_bundle === false, "Garden lab must remain outside the app bundle");
assert(manifest.shipping_boundary.unselected_direction_code_in_current_renderer_bundle === false, "shipping renderer includes alternate direction code");
assert(manifest.review.owner_selection === "pending", "Garden owner selection must be recorded through the selected-path integration, not rewritten in lab evidence");

const currentSourceSha256 = Object.fromEntries(
  manifest.source.files.map((source) => [source.path, sha256(join(projectRoot, source.path))]),
);
const sourceMatches = manifest.source.files.every((source) => currentSourceSha256[source.path] === source.sha256);
const exactPostPublicationFreeze = isExactPostPublicationGardenLabFreeze(manifest, currentSourceSha256);
assert(sourceMatches || exactPostPublicationFreeze, "Garden lab source drift is not the one exact historical selection-lab boundary");
assert(sourceMatches ? manifest.post_generation_change === undefined : exactPostPublicationFreeze, "Garden lab drift boundary is stale or incomplete");
assert(
  sha256(join(projectRoot, manifest.source.generator)) === manifest.source.generator_sha256,
  "stale Garden lab generator hash",
);
for (const artifact of [
  ...manifest.capture.stills,
  ...manifest.capture.milestone_stills,
  ...manifest.capture.motion_clips,
  ...manifest.capture.contact_sheets,
]) {
  const path = safeArtifactPath(artifact.path);
  assert(statSync(path).size === artifact.bytes || artifact.bytes === undefined, `Garden artifact byte count drifted: ${artifact.path}`);
  assert(sha256(path) === artifact.sha256, `Garden artifact hash drifted: ${artifact.path}`);
}

const diagnostics = manifest.capture.stills.map((item) => item.diagnostics);
assert(diagnostics.every((item) => item.context === "available"), "Garden context was unavailable during a still capture");
assert(Math.max(...diagnostics.map((item) => item.drawCalls)) <= 40, "Garden draw-call budget regressed above 40");
assert(Math.max(...diagnostics.map((item) => item.textures)) <= 8, "Garden texture budget regressed above 8");
assert(Math.max(...diagnostics.map((item) => item.geometries)) <= 40, "Garden geometry budget regressed above 40");
const validationText = readFileSync(join(labRoot, "output/validation.txt"), "utf8");
assert(!exactPostPublicationFreeze || (validationText.includes("current_source_state: historical-selection-lab-preserved") && validationText.includes("current_garden_proof: separate-60-render-matrix-passed")), "Garden lab validation text must preserve the historical/current proof boundary");

process.stdout.write("Garden design-lab validation passed: 3 directions, 15 milestones each, 6 clips, bounded renderer inventory.\n");

function safeArtifactPath(path) {
  const absolute = resolve(labRoot, path);
  const relativePath = relative(join(labRoot, "output"), absolute);
  assert(relativePath !== "" && !relativePath.startsWith("..") && !normalize(relativePath).startsWith(".."), `Garden artifact escaped output: ${path}`);
  return absolute;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
