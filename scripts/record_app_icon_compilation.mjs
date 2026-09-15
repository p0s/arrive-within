#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "../Marketing/AppStoreScreenshots/node_modules/sharp/dist/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, ".build/icon-correction-2026-09-15");
const output = "docs/brand/compiled/2026-09-15";
await mkdir(input, { recursive: true });
await mkdir(path.join(root, output), { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(await readFile(path.join(root, "docs/brand/app-icon-derived/_manifest.json")));
execFileSync("xcrun", ["actool", "Apps/ArriveWithin/Resources/AppIcon.icon", "--compile", input,
  "--platform", "iphoneos", "--minimum-deployment-target", "18.0", "--app-icon", "AppIcon",
  "--output-partial-info-plist", path.join(input, "assetcatalog-info.plist"),
  "--target-device", "iphone", "--target-device", "ipad", "--output-format", "human-readable-text"],
  { cwd: root, stdio: "pipe", maxBuffer: 4 * 1024 * 1024 });
const info = JSON.parse(execFileSync("xcrun", ["assetutil", "--info", path.join(input, "Assets.car")], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }));
const stacks = info.filter((item) => item.AssetType === "IconImageStack");
const outputs = [];
for (const [prefix, exportedName, role] of [["AppIcon60x60", "phone-120.png", "phone 60-point at 2x"], ["AppIcon76x76", "ipad-152.png", "pad 76-point at 2x"]]) {
  const matches = (await readdir(input)).filter((file) => file.startsWith(prefix) && file.endsWith(".png"));
  if (matches.length !== 1) throw new Error(`Expected one compiled ${prefix} output`);
  const [file] = matches;
  const bytes = await readFile(path.join(input, file));
  const metadata = await sharp(bytes).metadata();
  if (metadata.space !== "srgb") throw new Error(`${file}: RGB required`);
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let green = 0, total = 0;
  for (let y = Math.ceil(info.height * 0.55); y < info.height * 0.75; y++) {
    for (let x = Math.ceil(info.width * 0.40); x < info.width * 0.60; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset + 1] > data[offset] * 1.12 && data[offset + 1] > data[offset + 2] * 1.08) green++;
      total++;
    }
  }
  const fraction = green / total;
  if (fraction < 0.2) throw new Error(`${file}: sprout hidden by layer order/effects (${fraction})`);
  await writeFile(path.join(root, output, exportedName), bytes);
  outputs.push({ path: `${output}/${exportedName}`, role, width: metadata.width, height: metadata.height,
    colorSpace: "RGB", alpha: metadata.hasAlpha, sha256: hash(bytes), sproutGreenPixelFraction: Number(fraction.toFixed(4)) });
}
const appearances = [...new Set(stacks.map((item) => item.Appearance))].sort();
if (!appearances.includes("UIAppearanceLight") || !appearances.includes("UIAppearanceDark") || !appearances.includes("ISAppearanceTintable")) {
  throw new Error(`Missing compiled icon appearances: ${JSON.stringify(appearances)}`);
}
const marketingIcons = info.filter((item) => item.AssetType === "Icon Image" && item.PixelWidth === 1024);
if (!marketingIcons.length || marketingIcons.some((item) => item.Opaque !== true || item.ColorModel !== "RGB")) {
  throw new Error("Compiled 1024 marketing icons must remain opaque RGB");
}
const record = { schemaVersion: 2, validatedAt: "2026-09-15", validationLevel: "asset-compilation",
  compiler: info[0].AssetStorageVersion, result: "pass", codeSigning: "not-applicable",
  sourceName: "AppIcon", canonicalSourceSha256: manifest.canonicalSourceSha256,
  targetFamilies: ["phone", "pad"], compiledStacks: ["light", "dark", "tintable"],
  compatibilityOutputs: outputs, assetsCarSha256: hash(await readFile(path.join(input, "Assets.car"))),
  marketingIcons: marketingIcons.map((item) => ({ idiom: item.Idiom, appearance: item.Appearance ?? "Any", opaque: item.Opaque, colorModel: item.ColorModel })),
  compatibilityFormatNote: "Xcode 27 emits masked RGBA small compatibility PNGs. Their alpha is reported without alteration. Compiled 1024 marketing renditions and all derived marketing masters are opaque RGB; archive acceptance remains a separate release gate.",
  claimBoundary: "Current-source Apple asset-compiler output only. Both compatibility icons inspected; no complete app build, archive, Home Screen, physical device, TestFlight, or App Store claim.",
};
await writeFile(path.join(root, "docs/brand/icon-build-validation.json"), `${JSON.stringify(record, null, 2)}\n`);
console.log(`Recorded Apple phone/pad asset compilation with visible green sprout: ${outputs.map((item) => item.sproutGreenPixelFraction).join(", ")}.`);
