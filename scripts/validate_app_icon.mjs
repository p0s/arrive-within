#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconPath = path.join(root, "Apps/ArriveWithin/Resources/AppIcon.icon");
const assetsPath = path.join(iconPath, "Assets");
const derivedPath = path.join(root, "docs/brand/app-icon-derived");
const productionPath = path.join(root, "docs/brand/provenance/2026-08-10/production");
const layerFiles = ["threshold-interior.svg", "threshold-arch.svg", "living-shoot.svg"];
const expectedGroups = [
  ["Inner sanctuary", "Warm interior", "threshold-interior.svg"],
  ["Quiet threshold", "Forest threshold", "threshold-arch.svg"],
  ["Growth", "Living shoot", "living-shoot.svg"],
];

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function safeFile(absolute) {
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`expected a regular non-symlink file: ${path.relative(root, absolute)}`);
  return readFile(absolute);
}

function inspectPng(relative, bytes, width, height, colorType) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`${relative}: invalid PNG`);
  }
  const actualWidth = bytes.readUInt32BE(16);
  const actualHeight = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const actualColorType = bytes[25];
  if (actualWidth !== width || actualHeight !== height || bitDepth !== 8 || actualColorType !== colorType) {
    throw new Error(`${relative}: expected ${width}x${height}, 8-bit color type ${colorType}; found ${actualWidth}x${actualHeight}, depth ${bitDepth}, type ${actualColorType}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const iconBytes = await safeFile(path.join(iconPath, "icon.json"));
  const icon = JSON.parse(iconBytes.toString("utf8"));
  assert(icon.fill?.solid === "display-p3:0.84,0.89,0.70,1.0", "canonical fill mismatch");
  assert(JSON.stringify(icon["supported-platforms"]) === JSON.stringify({ circles: [], squares: "shared" }), "supported-platform declaration mismatch");
  assert(icon.groups?.length === 3, "expected exactly three editable icon groups");
  expectedGroups.forEach(([groupName, layerName, filename], index) => {
    const group = icon.groups[index];
    assert(group?.name === groupName && group.layers?.length === 1, `group ${index + 1} mismatch`);
    assert(group.layers[0]?.name === layerName && group.layers[0]?.["image-name"] === filename, `layer ${index + 1} mismatch`);
  });

  const actualLayerFiles = (await readdir(assetsPath)).sort();
  assert(JSON.stringify(actualLayerFiles) === JSON.stringify([...layerFiles].sort()), "unexpected or missing canonical icon layer");
  const layerBytes = [];
  for (const filename of layerFiles) {
    const bytes = await safeFile(path.join(assetsPath, filename));
    const source = bytes.toString("utf8");
    assert(source.includes('viewBox="0 0 1024 1024"'), `${filename}: missing canonical viewBox`);
    assert(!/<text\b/i.test(source), `${filename}: text elements are forbidden`);
    assert(!/\/Users\/|\/private\/|file:\/\//i.test(source), `${filename}: local path leaked`);
    layerBytes.push(bytes);
  }

  const manifestBytes = await safeFile(path.join(derivedPath, "_manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert(manifest.schemaVersion === 1, "derived manifest schema mismatch");
  assert(manifest.selection?.date === "2026-08-10" && manifest.selection?.direction === "B — Quiet Threshold", "derived manifest selection mismatch");
  assert(manifest.canonicalSource === "Apps/ArriveWithin/Resources/AppIcon.icon", "derived manifest canonical path mismatch");
  assert(manifest.canonicalSourceSha256 === sha256(Buffer.concat([iconBytes, ...layerBytes])), "canonical source hash mismatch");
  assert(manifest.sourceFiles?.["icon.json"] === sha256(iconBytes), "icon.json hash mismatch");
  layerFiles.forEach((filename, index) => {
    assert(manifest.sourceFiles?.[`Assets/${filename}`] === sha256(layerBytes[index]), `${filename}: source hash mismatch`);
  });

  const expectedArtifacts = [];
  for (const variant of ["Default", "Dark", "Tinted"]) {
    for (const size of [1024, 180, 60, 40]) expectedArtifacts.push(`AppIcon-${variant}-${size}.png`);
  }
  assert(manifest.artifacts?.length === expectedArtifacts.length, "expected 12 derived artifacts");
  for (const filename of expectedArtifacts) {
    const record = manifest.artifacts.find((item) => path.basename(item.path) === filename);
    assert(record, `${filename}: missing manifest record`);
    const bytes = await safeFile(path.join(derivedPath, filename));
    const size = Number(filename.match(/-(\d+)\.png$/)?.[1]);
    const colorType = filename.includes("-Tinted-") ? 0 : 2;
    inspectPng(record.path, bytes, size, size, colorType);
    assert(record.sha256 === sha256(bytes), `${filename}: hash mismatch`);
  }

  const sheetPath = path.join(root, manifest.contactSheet.path);
  const sheetBytes = await safeFile(sheetPath);
  inspectPng(manifest.contactSheet.path, sheetBytes, 2280, 1390, 2);
  assert(manifest.contactSheet.sha256 === sha256(sheetBytes), "contact-sheet hash mismatch");

  const production = JSON.parse((await safeFile(path.join(productionPath, "provenance.json"))).toString("utf8"));
  const promptBytes = await safeFile(path.join(productionPath, production.generation.prompt));
  const rawBytes = await safeFile(path.join(productionPath, production.generation.output));
  inspectPng(production.generation.output, rawBytes, 1254, 1254, 2);
  assert(sha256(promptBytes) === production.generation.promptSha256, "production prompt hash mismatch");
  assert(sha256(rawBytes) === production.generation.outputSha256 && rawBytes.length === production.generation.outputBytes, "production output hash/size mismatch");
  const prompt = promptBytes.toString("utf8");
  for (const marker of ["INPUT ROLES ARE STRICT", "Image 1 is a first-party house-style reference only", "Image 2 is the selected composition reference", "Return exactly one refined square image"]) {
    assert(prompt.includes(marker), `production prompt missing boundary: ${marker}`);
  }
  assert(production.inputs?.length === 2 && production.inputs[0].copiedGeometryAllowed === false, "production input-role boundary mismatch");
  assert(production.rights?.repositoryMediaLicense === "CC BY 4.0" && production.rights?.publicationState === "unauthorized", "production rights/publication boundary mismatch");

  const qa = JSON.parse((await safeFile(path.join(root, "docs/brand/icon-qa.json"))).toString("utf8"));
  assert(Object.values(qa.sizes ?? {}).every((value) => value === "pass"), "size QA incomplete");
  for (const mode of ["default", "dark", "tinted-light", "tinted-dark"]) assert(qa.platforms?.iOS?.[mode] === "pass", `${mode} QA incomplete`);
  for (const mode of ["clear-light", "clear-dark"]) assert(qa.platforms?.iOS?.[mode] === "blocked-owner-eula", `${mode} must preserve the owner EULA boundary`);
  assert(qa.ownerProductionReview === "pending", "owner production review must remain pending");

  const build = JSON.parse((await safeFile(path.join(root, "docs/brand/icon-build-validation.json"))).toString("utf8"));
  assert(build.result === "pass" && build.configuration === "Release" && build.codeSigning === "disabled", "compiled icon validation mismatch");
  assert(JSON.stringify(build.targetFamilies) === JSON.stringify(["phone", "pad"]), "compiled target families mismatch");
  assert(JSON.stringify(build.compiledStacks) === JSON.stringify(["light", "dark", "tintable"]), "compiled appearance stacks mismatch");
  assert(build.compatibilityOutputs?.every((item) => item.colorSpace === "RGB" && item.alpha === false && /^[a-f0-9]{64}$/.test(item.sha256)), "compiled compatibility output mismatch");

  const project = (await safeFile(path.join(root, "project.yml"))).toString("utf8");
  assert(project.includes("ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon"), "target is not bound to AppIcon.icon");
  process.stdout.write("App icon validation passed: selected B provenance, 3 editable layers, 12 deterministic opaque artifacts, size/appearance QA, and local phone/pad Release compilation; GUI clear-mode review remains owner-EULA blocked.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
