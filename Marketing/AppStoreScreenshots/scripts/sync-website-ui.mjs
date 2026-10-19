#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "../../..");
const screenshotRoot = resolve(projectRoot, "Marketing/AppStoreScreenshots");
const websiteAssetRoot = join(projectRoot, "Website/src/assets");
const provenancePath = join(websiteAssetRoot, "provenance.json");
const capturesPath = join(screenshotRoot, "source-captures.json");
const candidateManifestPath = join(screenshotRoot, "exports/_candidate-manifest.json");

const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
const captures = JSON.parse(readFileSync(capturesPath, "utf8"));
const candidateManifest = JSON.parse(readFileSync(candidateManifestPath, "utf8"));
const screenshotManifestPath = resolve(screenshotRoot, captures.source_manifest_path);
if (!screenshotManifestPath.startsWith(`${screenshotRoot}/`)) throw new Error("Screenshot source manifest must remain inside AppStoreScreenshots.");
const screenshotManifest = JSON.parse(readFileSync(screenshotManifestPath, "utf8"));
const screenshotManifestSha256 = sha256File(screenshotManifestPath);
if (
  screenshotManifestSha256 !== captures.source_manifest_sha256
  || screenshotManifest.source_revision !== captures.source_revision
  || candidateManifest.sourceRevision !== captures.source_revision
  || candidateManifest.status !== "candidate-complete-human-review-pending"
) throw new Error("Current App Store capture and candidate provenance do not agree.");

const screenshotAssets = provenance.assets.filter((asset) => asset.source.startsWith("Marketing/AppStoreScreenshots/"));
if (screenshotAssets.length !== 8) throw new Error("Website must bind exactly eight current App Store UI images.");
const screenshotSourcePrefix = `${screenshotRoot}/`;
const screenshotNames = new Set();
for (const asset of screenshotAssets) {
  const source = resolve(projectRoot, asset.source);
  if (
    !source.startsWith(screenshotSourcePrefix)
    || !asset.file
    || asset.file !== asset.file.split(/[\\/]/).at(-1)
    || screenshotNames.has(asset.file)
  ) throw new Error(`${asset.file}: unsafe or duplicate App Store UI asset mapping`);
  screenshotNames.add(asset.file);
  const destination = join(websiteAssetRoot, asset.file);
  const sourceStat = lstatSync(source);
  const destinationStat = lstatSync(destination);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || !destinationStat.isFile() || destinationStat.isSymbolicLink()) {
    throw new Error(`${asset.file}: source and destination must be regular non-symbolic-link files`);
  }
  copyFileSync(source, destination);
  asset.sha256 = sha256File(source);
  if (sha256File(destination) !== asset.sha256) throw new Error(`${asset.file}: copied bytes do not match`);
}

provenance.source_revision = captures.source_revision;
provenance.capture_source_manifest_sha256 = screenshotManifestSha256;
provenance.capture_state = "Guarded iOS 26.5 simulator UI from app version 1.0.2 build 19 with deterministic safe synthetic product data; not physical-device, CloudKit, signed-candidate, or App Store evidence.";
provenance.app_store_ui_review_state = "pending-owner-visual-review";
provenance.app_store_ui_next_action = "Complete owner visual review before App Store Connect upload and website deployment.";
writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Website App Store UI synchronized: ${screenshotAssets.length} images bound to candidate source ${captures.source_revision}.`);

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
