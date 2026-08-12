#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "../Marketing/AppStoreScreenshots/node_modules/sharp/dist/index.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const iconRoot = path.join(repositoryRoot, "Apps/ArriveWithin/Resources/AppIcon.icon");
const layerRoot = path.join(iconRoot, "Assets");
const outputRoot = path.join(repositoryRoot, "docs/brand/app-icon-derived");
const targetPath = path.join(
  repositoryRoot,
  "docs/brand/provenance/2026-08-10/production/quiet-threshold-production-raw.png",
);

const layerNames = ["threshold-interior.svg", "threshold-arch.svg", "living-shoot.svg"];
const sizes = [1024, 180, 60, 40];
const checkMode = process.argv.includes("--check");

const variants = {
  Default: {
    background: "#D6E3B2",
    replacements: {},
    grayscale: false,
  },
  Dark: {
    background: "#173127",
    replacements: {
      "#F5D98D": "#C98B32",
      "#F8E8B8": "#E1B75B",
      "#E9A943": "#F1BD59",
      "#123F30": "#071D16",
      "#1A503D": "#0E3328",
      "#557B5E": "#5C8C6B",
      "#4F7E58": "#6E9C6A",
      "#5D8E63": "#7EAD75",
      "#86AA78": "#B2C99A",
    },
    grayscale: false,
  },
  Tinted: {
    background: "#D6E3B2",
    replacements: {},
    grayscale: true,
  },
};

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function emitFile(destination, contents) {
  if (!checkMode) {
    await writeFile(destination, contents);
    return;
  }
  const existing = await readFile(destination);
  if (!existing.equals(Buffer.isBuffer(contents) ? contents : Buffer.from(contents))) {
    throw new Error(`generated icon artifact drift: ${path.relative(repositoryRoot, destination)}`);
  }
}

function escaped(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function specializeSVG(source, replacements) {
  let specialized = source;
  for (const [from, to] of Object.entries(replacements)) {
    specialized = specialized.replaceAll(from, to);
  }
  return Buffer.from(specialized);
}

async function renderVariant(name, configuration, layerSources) {
  const composite = layerSources.map((source) => ({
    input: specializeSVG(source, configuration.replacements),
    top: 0,
    left: 0,
  }));

  let pipeline = sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: configuration.background,
    },
  }).composite(composite);

  if (configuration.grayscale) {
    pipeline = pipeline.greyscale().toColourspace("b-w");
  } else {
    pipeline = pipeline.toColourspace("srgb");
  }

  const master = await pipeline.removeAlpha().png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  const artifacts = [];
  for (const size of sizes) {
    const filename = `AppIcon-${name}-${size}.png`;
    const destination = path.join(outputRoot, filename);
    let resized = sharp(master).resize(size, size, { fit: "fill", kernel: sharp.kernel.lanczos3 });
    resized = configuration.grayscale ? resized.toColourspace("b-w") : resized.toColourspace("srgb");
    const contents = size === 1024
      ? master
      : await resized
        .removeAlpha()
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer();
    await emitFile(destination, contents);
    artifacts.push({
      path: path.relative(repositoryRoot, destination),
      sha256: sha256(contents),
      size,
      variant: name.toLowerCase(),
    });
  }
  return { master, artifacts };
}

function textSVG(width, height, text, fontSize, color = "#EAF0E6") {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<text x="${width / 2}" y="${height * 0.72}" text-anchor="middle" ` +
      `font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="600" fill="${color}">` +
      `${escaped(text)}</text></svg>`,
  );
}

async function buildContactSheet(target, rendered) {
  const canvasWidth = 2280;
  const canvasHeight = 1390;
  const columnCenters = [360, 880, 1400, 1920];
  const composites = [];

  composites.push({ input: textSVG(canvasWidth, 90, "Quiet Threshold — production target and canonical appearance QA", 38), top: 18, left: 0 });
  ["Image-generation target", "Default", "Dark", "Tinted"].forEach((label, index) => {
    composites.push({ input: textSVG(420, 62, label, 25), top: 110, left: columnCenters[index] - 210 });
  });

  const targetPreview = await sharp(target).resize(420, 420, { fit: "fill" }).removeAlpha().png().toBuffer();
  composites.push({ input: targetPreview, top: 180, left: columnCenters[0] - 210 });
  for (const [index, name] of ["Default", "Dark", "Tinted"].entries()) {
    const preview = await sharp(rendered[name].master).resize(420, 420).png().toBuffer();
    composites.push({ input: preview, top: 180, left: columnCenters[index + 1] - 210 });
  }

  composites.push({ input: textSVG(420, 55, "1024 px masters (shown at 420 px)", 20, "#AFC1B4"), top: 604, left: columnCenters[1] - 210 });
  composites.push({ input: textSVG(420, 55, "1024 px masters (shown at 420 px)", 20, "#AFC1B4"), top: 604, left: columnCenters[2] - 210 });
  composites.push({ input: textSVG(420, 55, "1024 px masters (shown at 420 px)", 20, "#AFC1B4"), top: 604, left: columnCenters[3] - 210 });

  const rows = [
    { size: 180, top: 730 },
    { size: 60, top: 990 },
    { size: 40, top: 1160 },
  ];
  for (const row of rows) {
    composites.push({ input: textSVG(420, 60, `${row.size} px actual-size inspection`, 20, "#AFC1B4"), top: row.top + Math.max(0, (row.size - 60) / 2), left: 10 });
    for (const [index, name] of ["Default", "Dark", "Tinted"].entries()) {
      const artifact = rendered[name].artifacts.find((item) => item.size === row.size);
      composites.push({
        input: path.join(repositoryRoot, artifact.path),
        top: row.top,
        left: columnCenters[index + 1] - Math.floor(row.size / 2),
      });
    }
  }

  const sheet = await sharp({
    create: { width: canvasWidth, height: canvasHeight, channels: 3, background: "#122019" },
  })
    .composite(composites)
    .removeAlpha()
    .toColourspace("srgb")
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();

  const destination = path.join(repositoryRoot, "docs/brand/app-icon-qa-contact-sheet.png");
  await emitFile(destination, sheet);
  return {
    path: path.relative(repositoryRoot, destination),
    sha256: sha256(sheet),
    width: canvasWidth,
    height: canvasHeight,
  };
}

await mkdir(outputRoot, { recursive: true });
const layerSources = await Promise.all(layerNames.map((name) => readFile(path.join(layerRoot, name), "utf8")));
const iconDocument = await readFile(path.join(iconRoot, "icon.json"));
const target = await readFile(targetPath);

const rendered = {};
for (const [name, configuration] of Object.entries(variants)) {
  rendered[name] = await renderVariant(name, configuration, layerSources);
}

const contactSheet = await buildContactSheet(target, rendered);
const artifacts = Object.values(rendered).flatMap((item) => item.artifacts);
const sourceFiles = ["icon.json", ...layerNames.map((name) => `Assets/${name}`)];
const sourceHashes = Object.fromEntries(
  await Promise.all(sourceFiles.map(async (relativePath) => {
    const contents = await readFile(path.join(iconRoot, relativePath));
    return [relativePath, sha256(contents)];
  })),
);

const manifest = {
  schemaVersion: 1,
  selection: {
    date: "2026-08-10",
    direction: "B — Quiet Threshold",
  },
  canonicalSource: "Apps/ArriveWithin/Resources/AppIcon.icon",
  canonicalSourceSha256: sha256(Buffer.concat([iconDocument, ...layerSources.map((source) => Buffer.from(source))])),
  sourceFiles: sourceHashes,
  productionTarget: {
    path: path.relative(repositoryRoot, targetPath),
    sha256: sha256(target),
    role: "image-generation visual target; canonical output is authored from named vector layers",
  },
  transformations: {
    renderer: "Sharp 0.35.3",
    resizeKernel: "Lanczos3",
    alpha: "removed",
    defaultAndDarkColorSpace: "sRGB RGB",
    tintedColorSpace: "grayscale",
  },
  artifacts,
  contactSheet,
};

const manifestPath = path.join(outputRoot, "_manifest.json");
await emitFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${checkMode ? "Verified" : "Generated"} ${artifacts.length} icon artifacts and ${contactSheet.path}.`);
