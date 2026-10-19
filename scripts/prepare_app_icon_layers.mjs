#!/usr/bin/env node
// Normalize generated transparent materials into the selected composition.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "../Marketing/AppStoreScreenshots/node_modules/sharp/dist/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = "docs/brand/provenance/2026-09-15/layers";
const destination = "Apps/ArriveWithin/Resources/AppIcon.icon/Assets";
const check = process.argv.includes("--check");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const layers = [
  { key: "interior", file: "threshold-interior.png", left: 366, top: 351, width: 288, height: 424 },
  { key: "arch", file: "threshold-arch.png", left: 238, top: 217, width: 546, height: 560 },
  { key: "shoot", file: "living-shoot.png", left: 393, top: 547, width: 235, height: 228 },
];
async function emit(relative, bytes) {
  const target = path.join(root, relative);
  if (check) {
    if (!(await readFile(target)).equals(bytes)) throw new Error(`Generated layer drift: ${relative}`);
  } else await writeFile(target, bytes);
}
const records = [];
for (const layer of layers) {
  const rawPath = `${source}/${layer.key}-raw.png`;
  const promptPath = `${source}/${layer.key}-prompt.txt`;
  const bytes = await readFile(path.join(root, rawPath));
  const metadata = await sharp(bytes).metadata();
  if (!metadata.hasAlpha) throw new Error(`${rawPath}: transparent source required`);
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 32) {
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  if (left === 0 || top === 0 || right === info.width - 1 || bottom === info.height - 1 || right < left) {
    throw new Error(`${rawPath}: missing isolated transparent margins`);
  }
  const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
  const normalized = await sharp(bytes).extract(crop)
    .resize(layer.width, layer.height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .extend({ left: layer.left, top: layer.top, right: 1024 - layer.left - layer.width,
      bottom: 1024 - layer.top - layer.height, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toColourspace("srgb").png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  await emit(`${destination}/${layer.file}`, normalized);
  records.push({ rawPath, rawSha256: hash(bytes), rawDimensions: `${info.width}x${info.height}`,
    promptPath, promptSha256: hash(await readFile(path.join(root, promptPath))),
    crop, placement: layer, output: `${destination}/${layer.file}`, outputSha256: hash(normalized) });
}
const provenance = {
  schemaVersion: 1, direction: "B — Quiet Threshold", generatedAt: "2026-09-15",
  generationTool: "OpenAI built-in image_gen", modelIdentifier: "not exposed by built-in tool",
  reference: { path: "docs/brand/provenance/2026-08-10/concept-board/direction-b.png",
    sha256: hash(await readFile(path.join(root, "docs/brand/provenance/2026-08-10/concept-board/direction-b.png"))),
    role: "Owner-selected app geometry and tactile material; only input to each separate layer call" },
  transformation: "Sharp 0.35.3: alpha >32 subject bounds; Lanczos3 fit to selected 1024 composition; transparent padding; sRGB RGBA PNG. Raw outputs preserved unchanged.",
  rights: { repositoryMediaLicense: "CC BY 4.0", basis: "Same original first-party selected composition and output-rights basis as the 2026-08-10 production provenance", source: "docs/brand/provenance/2026-08-10/production/provenance.json" },
  layers: records,
};
await emit(`${source}/provenance.json`, Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`));
console.log(`${check ? "Verified" : "Prepared"} three transparent, provenance-bound icon layers.`);
