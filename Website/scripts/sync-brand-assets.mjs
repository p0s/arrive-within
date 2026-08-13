import { copyFile, lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ROOT, assertToolchain, sha256 } from "./lib.mjs";

const REPOSITORY_ROOT = path.resolve(ROOT, "..");
const DERIVED_ROOT = path.join(REPOSITORY_ROOT, "docs", "brand", "app-icon-derived");
const MANIFEST_PATH = path.join(DERIVED_ROOT, "_manifest.json");
const OUTPUT_ROOT = path.join(ROOT, "src", "assets");
const SELECTION = "B — Quiet Threshold";
const requestedAssets = [
  { size: 40, file: "brand-icon-40.png", role: "browser favicon" },
  { size: 180, file: "brand-icon-180.png", role: "Apple touch icon and visible website brand mark" },
];

async function regularFile(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`website brand source must be a regular file: ${path.relative(REPOSITORY_ROOT, file)}`);
  }
  return readFile(file);
}

async function safeOutput(file) {
  if (!file.startsWith(`${OUTPUT_ROOT}${path.sep}`)) throw new Error("website brand output escaped its source-assets directory");
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`website brand output must be a regular file: ${path.relative(REPOSITORY_ROOT, file)}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function main() {
  assertToolchain();
  const manifest = JSON.parse((await regularFile(MANIFEST_PATH)).toString("utf8"));
  if (
    manifest.schemaVersion !== 1
    || manifest.selection?.direction !== SELECTION
    || manifest.canonicalSource !== "Apps/ArriveWithin/Resources/AppIcon.icon"
  ) {
    throw new Error("selected app-icon manifest does not match the website brand contract");
  }

  const assets = [];
  for (const request of requestedAssets) {
    const record = manifest.artifacts?.find(
      (item) => item.variant === "default" && item.size === request.size,
    );
    if (!record) throw new Error(`missing selected default app icon at ${request.size}px`);
    const source = path.join(REPOSITORY_ROOT, record.path);
    const contents = await regularFile(source);
    if (sha256(contents) !== record.sha256) throw new Error(`${record.path}: source hash mismatch`);
    const output = path.join(OUTPUT_ROOT, request.file);
    await safeOutput(output);
    await copyFile(source, output);
    assets.push({
      file: request.file,
      source: record.path,
      sha256: record.sha256,
      width: request.size,
      height: request.size,
      color_space: "RGB",
      alpha: false,
      role: request.role,
    });
  }

  const provenance = {
    schema_version: 1,
    selection: SELECTION,
    canonical_source: manifest.canonicalSource,
    derived_manifest: path.relative(REPOSITORY_ROOT, MANIFEST_PATH),
    transformation: "Exact byte copies of deterministic Sharp 0.35.3 default-appearance outputs; no website-specific visual transform.",
    rights: "First-party selected Arrive Within identity asset. Public source distribution is permitted; trademark rights remain reserved.",
    assets,
  };
  const provenancePath = path.join(OUTPUT_ROOT, "brand-provenance.json");
  await safeOutput(provenancePath);
  await writeFile(
    provenancePath,
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  process.stdout.write(`Synchronized ${assets.length} provenance-bound Quiet Threshold website brand assets.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
