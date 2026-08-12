#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "../../..");
const mediaOutputRoot = join(projectRoot, "Marketing/PublicMedia/output");
const websiteAssetRoot = join(projectRoot, "Website/src/assets");
const provenancePath = join(websiteAssetRoot, "provenance.json");
const publicMedia = [
  "garden-growth-v1.mp4",
  "garden-growth-poster.png",
  "social-preview.png",
];

const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
for (const file of publicMedia) {
  const source = join(mediaOutputRoot, file);
  const destination = join(websiteAssetRoot, file);
  const sourceStat = lstatSync(source);
  const destinationStat = lstatSync(destination);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || !destinationStat.isFile() || destinationStat.isSymbolicLink()) {
    throw new Error(`${file}: source and destination must be regular non-symbolic-link files`);
  }
  const expectedSource = `Marketing/PublicMedia/output/${file}`;
  const entry = provenance.assets.find((asset) => asset.file === file);
  if (!entry || entry.source !== expectedSource) throw new Error(`${file}: missing exact website provenance entry`);
  copyFileSync(source, destination);
  entry.sha256 = sha256File(source);
  if (sha256File(destination) !== entry.sha256) throw new Error(`${file}: copied bytes do not match`);
}

writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Website media synchronized: ${publicMedia.length} provenance-bound files.`);

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
