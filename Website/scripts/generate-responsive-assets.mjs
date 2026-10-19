import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, sha256 } from "./lib.mjs";

const require = createRequire(path.join(ROOT, "..", "Marketing", "AppStoreScreenshots", "package.json"));
const sharp = require("sharp");
if (sharp.versions.sharp !== "0.35.3") throw new Error("Responsive assets require existing Sharp 0.35.3");
const sourceRoot = path.join(ROOT, "published-media");
const destination = path.join(ROOT, "src", "assets", "responsive");
const provenance = JSON.parse(await readFile(path.join(sourceRoot, "provenance.json"), "utf8"));
const settings = { quality: 90, effort: 6, smartSubsample: true };
const sources = [
  ["garden-growth-poster.png", [640, 960, 1280]],
  ...["en", "de"].flatMap((locale) => [
    [`garden-${locale}-iphone.png`, [480, 960, 1206]],
    [`journey-${locale}-iphone.png`, [360, 720, 1206]],
    [`garden-${locale}-ipad.png`, [480, 960, 1600, 2064]],
    [`journal-${locale}-ipad.png`, [480, 960, 1600, 2064]],
  ]),
];
await mkdir(destination, { recursive: true });
const assets = [];
for (const [source, widths] of sources) {
  const bytes = await readFile(path.join(sourceRoot, source));
  const original = provenance.assets.find((asset) => asset.file === source);
  if (!original || sha256(bytes) !== original.sha256) throw new Error(`${source}: published source hash mismatch`);
  for (const width of widths) {
    const result = await sharp(bytes).resize({ width, withoutEnlargement: true }).webp(settings).toBuffer({ resolveWithObject: true });
    const file = `${path.parse(source).name}-${width}.webp`;
    await writeFile(path.join(destination, file), result.data);
    assets.push({ file: `responsive/${file}`, source: `published-media/${source}`, source_sha256: original.sha256, sha256: sha256(result.data), width: result.info.width, height: result.info.height, bytes: result.data.byteLength });
  }
}
await writeFile(path.join(ROOT, "src", "assets", "responsive-provenance.json"), `${JSON.stringify({ schema_version: 1, source_selection: "previously-public-reviewed-media", generator: "scripts/generate-responsive-assets.mjs", transformation: { format: "webp", resize: "width-only, original aspect ratio, no enlargement", sharp: sharp.versions.sharp, ...settings }, rights: "Arrive Within media — Arrive Within contributors, CC BY 4.0. Resized and WebP encoded; original source hashes retained.", assets }, null, 2)}\n`);
console.log(`Generated ${assets.length} responsive images from the hash-bound public media set.`);
