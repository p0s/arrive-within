#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import sharp from "sharp";

import {
  ROOT,
  assertNarrativeAlternatives,
  assertPlan,
  loadNarrativeAlternatives,
  loadPlan,
  loadSourceCaptures,
  type DeviceId,
  type LocaleId,
  type NarrativeSlide,
} from "./contracts";
import { normalizeOpaqueRgbPng } from "./deterministic-png";
import { validateOpaqueRgbPng } from "./image-validation";
import { validateCaptures } from "./validate-captures";

type ManifestItem = {
  filename: string;
  sha256: string;
  slide: number;
  slideId: string;
  width: number;
  height: number;
};

type SetManifest = {
  schemaVersion: number;
  product: string;
  generatedAt: null;
  generationTimePolicy: string;
  locale: LocaleId;
  device: DeviceId;
  width: number;
  height: number;
  humanVisualReview: { state: string; reviewer: string | null; reviewedAt: string | null; notes: string | null };
  network: { externalRequests: number };
  pixelNormalization: string;
  sourceCaptures: { sourceRevision: string };
  contactSheet: { filename: string; sha256: string; width: number; height: number; encoding: string };
  narrative: { id: string; title: string; ownerSelection: string | null };
  items: ManifestItem[];
  uploadAuthorization: string;
};

type SetResult = {
  locale: LocaleId;
  device: DeviceId;
  width: number;
  height: number;
  imageCount: number;
  humanVisualReview: SetManifest["humanVisualReview"];
  artifacts: Array<{ filename: string; bytes: number; sha256: string }>;
};

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

async function artifact(root: string, filename: string): Promise<{ filename: string; bytes: number; sha256: string }> {
  const data = await readFile(path.join(root, filename));
  return { filename, bytes: data.byteLength, sha256: sha256(data) };
}

function setRoot(locale: LocaleId, device: DeviceId, narrative: string | null): string {
  return narrative
    ? path.join(ROOT, "exports", "alternatives", narrative, locale, device)
    : path.join(ROOT, "exports", locale, device);
}

async function validateSet(
  locale: LocaleId,
  device: DeviceId,
  width: number,
  height: number,
  slides: Array<Pick<NarrativeSlide, "index" | "id">>,
  narrative: { id: string; title: string } | null,
  expectedUploadAuthorization: string,
): Promise<SetResult> {
  const captures = await loadSourceCaptures();
  const root = setRoot(locale, device, narrative?.id ?? null);
  const narrativeSuffix = narrative ? `-${narrative.id}` : "";
  const zipName = `arrive-within-app-store${narrativeSuffix}-${locale.toLowerCase()}-${device}.zip`;
  const expectedPngNames = slides.map(
    (slide) =>
      `${String(slide.index).padStart(2, "0")}-${slide.id}-${locale.toLowerCase()}-${device}-${width}x${height}.png`,
  );
  const expectedFiles = [
    ...expectedPngNames,
    "_contact-sheet.jpg",
    "_manifest.json",
    "_validation.json",
    "_validation.txt",
    zipName,
  ].sort();
  const actualFiles = (await readdir(root)).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`${locale}/${device}: output files do not match the exact set contract`);
  }

  const manifest = JSON.parse(await readFile(path.join(root, "_manifest.json"), "utf8")) as SetManifest;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.product !== "Arrive Within" ||
    manifest.generatedAt !== null ||
    manifest.generationTimePolicy !== "omitted-for-byte-reproducibility" ||
    manifest.locale !== locale ||
    manifest.device !== device ||
    manifest.width !== width ||
    manifest.height !== height ||
    manifest.pixelNormalization !== "Deterministic RGB PNG encoding with each RGB least-significant bit cleared" ||
    manifest.network.externalRequests !== 0 ||
    manifest.sourceCaptures.sourceRevision !== captures.source_revision ||
    manifest.uploadAuthorization !== expectedUploadAuthorization
  ) {
    throw new Error(`${locale}/${device}: manifest contract mismatch`);
  }
  if (!['pending', 'approved'].includes(manifest.humanVisualReview.state)) {
    throw new Error(`${locale}/${device}: invalid human visual review state`);
  }
  if (
    manifest.items.length !== slides.length
    || manifest.narrative.id !== (narrative?.id ?? "current")
    || manifest.narrative.title !== (narrative?.title ?? "Frozen current narrative")
  ) {
    throw new Error(`${locale}/${device}: wrong manifest image count`);
  }

  for (let index = 0; index < manifest.items.length; index += 1) {
    const item = manifest.items[index];
    const slide = slides[index];
    if (
      item.filename !== expectedPngNames[index] ||
      item.slide !== slide.index ||
      item.slideId !== slide.id ||
      item.width !== width ||
      item.height !== height
    ) {
      throw new Error(`${locale}/${device}: manifest item ${index + 1} mismatch`);
    }
    const absolute = path.join(root, item.filename);
    const validation = await validateOpaqueRgbPng(absolute, width, height);
    if (validation.status !== "pass") throw new Error(`${locale}/${device}/${item.filename}: ${validation.errors.join("; ")}`);
    const imageData = await readFile(absolute);
    if (sha256(imageData) !== item.sha256) {
      throw new Error(`${locale}/${device}/${item.filename}: manifest SHA-256 mismatch`);
    }
    if (!normalizeOpaqueRgbPng(imageData).equals(imageData)) {
      throw new Error(`${locale}/${device}/${item.filename}: PNG normalization is not deterministic and idempotent`);
    }
  }

  const contactSheetData = await readFile(path.join(root, manifest.contactSheet.filename));
  const contactSheetMetadata = await sharp(contactSheetData).metadata();
  if (
    manifest.contactSheet.filename !== "_contact-sheet.jpg" ||
    manifest.contactSheet.encoding !== "sharp 0.35.3 JPEG quality 92, 4:4:4 chroma subsampling, no metadata" ||
    manifest.contactSheet.width !== 1440 ||
    manifest.contactSheet.height !== 1890 ||
    contactSheetMetadata.format !== "jpeg" ||
    contactSheetMetadata.width !== manifest.contactSheet.width ||
    contactSheetMetadata.height !== manifest.contactSheet.height ||
    contactSheetMetadata.hasAlpha === true ||
    sha256(contactSheetData) !== manifest.contactSheet.sha256
  ) {
    throw new Error(`${locale}/${device}: contact-sheet SHA-256 mismatch`);
  }

  const validation = JSON.parse(await readFile(path.join(root, "_validation.json"), "utf8")) as {
    status: string;
    expectedImages: number;
    actualImages: number;
    externalRequests: number;
    results: Array<{ file: string; status: string }>;
  };
  if (
    validation.status !== "pass" ||
    validation.expectedImages !== slides.length ||
    validation.actualImages !== slides.length ||
    validation.externalRequests !== 0 ||
    validation.results.length !== slides.length ||
    validation.results.some((item, index) => item.status !== "pass" || item.file !== expectedPngNames[index])
  ) {
    throw new Error(`${locale}/${device}: validation JSON mismatch`);
  }
  const validationText = await readFile(path.join(root, "_validation.txt"), "utf8");
  if ((validationText.match(/^PASS /gm) ?? []).length !== slides.length) {
    throw new Error(`${locale}/${device}: validation text does not contain six passing images`);
  }

  const zipData = await readFile(path.join(root, zipName));
  const zip = await JSZip.loadAsync(zipData);
  const expectedZipFiles = [...expectedPngNames, "_contact-sheet.jpg", "_manifest.json", "_validation.json", "_validation.txt"].sort();
  const actualZipFiles = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  if (JSON.stringify(actualZipFiles) !== JSON.stringify(expectedZipFiles)) {
    throw new Error(`${locale}/${device}: ZIP contents do not match the exact set contract`);
  }
  for (const filename of expectedZipFiles) {
    const zipped = await zip.file(filename)?.async("nodebuffer");
    if (!zipped || sha256(zipped) !== sha256(await readFile(path.join(root, filename)))) {
      throw new Error(`${locale}/${device}/${filename}: ZIP readback mismatch`);
    }
  }

  return {
    locale,
    device,
    width,
    height,
    imageCount: manifest.items.length,
    humanVisualReview: manifest.humanVisualReview,
    artifacts: await Promise.all(expectedFiles.map((filename) => artifact(root, filename))),
  };
}

async function main() {
  const plan = await loadPlan();
  assertPlan(plan);
  const alternatives = await loadNarrativeAlternatives();
  assertNarrativeAlternatives(alternatives);
  const narrativeFlag = process.argv.indexOf("--narrative");
  const narrativeID = narrativeFlag >= 0 ? process.argv[narrativeFlag + 1] : null;
  if (narrativeFlag >= 0 && !narrativeID) throw new Error("missing --narrative value");
  const narrative = narrativeID
    ? alternatives.narratives.find((candidate) => candidate.id === narrativeID)
    : null;
  if (narrativeID && !narrative) throw new Error(`unknown narrative ${narrativeID}`);
  const slides = narrative?.slides ?? plan.slides;
  const requiredCaptureIDs = narrative
    ? [...new Set(narrative.slides.flatMap((slide) => slide.capture_ids))]
    : plan.required_capture_ids;
  const expectedUploadAuthorization = narrative ? "candidate-only-not-selected" : plan.upload_authorization;
  const captures = await loadSourceCaptures();
  await validateCaptures(captures, captures.sets, requiredCaptureIDs);

  const sets: SetResult[] = [];
  for (const locale of plan.locales) {
    for (const device of plan.devices) {
      sets.push(
        await validateSet(
          locale,
          device.id,
          device.width,
          device.height,
          slides,
          narrative ?? null,
          expectedUploadAuthorization,
        ),
      );
    }
  }
  const imageCount = sets.reduce((sum, set) => sum + set.imageCount, 0);
  const expectedImageCount = slides.length * plan.locales.length * plan.devices.length;
  if (sets.length !== 4 || imageCount !== expectedImageCount) {
    throw new Error(`matrix count mismatch: ${sets.length} sets and ${imageCount} images`);
  }

  const reviewStates = [...new Set(sets.map((set) => set.humanVisualReview.state))];
  const matrix = {
    schemaVersion: 1,
    product: "Arrive Within",
    generatedAt: null,
    generationTimePolicy: "omitted-for-byte-reproducibility",
    sourceRevision: captures.source_revision,
    narrative: narrative
      ? { id: narrative.id, title: narrative.title, ownerSelection: alternatives.owner_selection }
      : { id: "current", title: "Frozen current narrative", ownerSelection: null },
    locales: plan.locales,
    devices: plan.devices,
    setCount: sets.length,
    imageCount,
    mechanicalValidation: "pass",
    humanVisualReview: reviewStates.length === 1 ? reviewStates[0] : "mixed",
    uploadAuthorization: expectedUploadAuthorization,
    sets,
  };
  const validation = {
    schemaVersion: 1,
    status: "pass",
    checks: [
      "4 exact locale/device sets",
      "24 selected numbered opaque RGB PNGs at exact dimensions",
      "deterministic idempotent RGB least-significant-bit normalization",
      "per-image and per-artifact SHA-256 readback",
      "passing per-set JSON and text validation",
      "contact-sheet SHA-256 readback",
      "deterministic ZIP contents and byte readback",
      "current app-source revision binding",
      "external network request count is zero",
    ],
    humanVisualReview: matrix.humanVisualReview,
    uploadAuthorization: expectedUploadAuthorization,
  };
  const exportsRoot = narrative
    ? path.join(ROOT, "exports", "alternatives", narrative.id)
    : path.join(ROOT, "exports");
  await writeFile(path.join(exportsRoot, "_matrix-manifest.json"), `${JSON.stringify(matrix, null, 2)}\n`);
  await writeFile(path.join(exportsRoot, "_matrix-validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
  await writeFile(
    path.join(exportsRoot, "_matrix-validation.txt"),
    `PASS 4 sets, ${expectedImageCount} opaque RGB images, exact hashes and ZIP readback\nHUMAN_VISUAL_REVIEW ${matrix.humanVisualReview.toUpperCase()}\nUPLOAD ${expectedUploadAuthorization.toUpperCase()}\n`,
  );
  process.stdout.write(
    `Export matrix passed: ${sets.length} sets × ${slides.length} images = ${imageCount}; human visual review ${matrix.humanVisualReview}; upload ${expectedUploadAuthorization}.\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
