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
  geometry: Geometry;
};

type Geometry = {
  headlineBounds: { x: number; y: number; width: number; height: number };
  proofBounds: { x: number; y: number; width: number; height: number };
  primaryMockupAnchor: {
    expectedTopPercent: number;
    actualTop: number;
    actualTopPercent: number;
    frameTops: number[];
    maxFrameTopDelta: number;
    tolerancePixels: number;
  };
  headlineToProofGap: number;
  headlineToProofGapRatio: number;
  proofHeight: number;
  proofHeightRatio: number;
  proofLowerEdge: number;
  proofLowerEdgeRatio: number;
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
  sourceCaptures: { sourceRevision: string; setCompleteness?: string };
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
  geometry: GeometrySummary;
  humanVisualReview: SetManifest["humanVisualReview"];
  artifacts: Array<{ filename: string; bytes: number; sha256: string }>;
};

type GeometrySummary = {
  headlineToProofGapPercent: { min: number; max: number };
  proofHeightPercent: { min: number; max: number };
  proofLowerEdgePercent: { min: number; max: number };
  primaryMockupTopPixels: { min: number; max: number };
  primaryMockupTopCanvasHeightPercent: { min: number; max: number };
  primaryMockupMaximumFrameTopDeltaPixels: number;
};

function range(values: number[]): { min: number; max: number } {
  return { min: Math.min(...values), max: Math.max(...values) };
}

function assertGeometry(
  geometry: Geometry,
  context: string,
  expectation: { canvasHeight: number; topPercent: number; tolerancePixels: number; expectedFrameCount: number },
): void {
  const anchor = geometry.primaryMockupAnchor;
  const expectedTop = expectation.canvasHeight * expectation.topPercent / 100;
  const frameTops = anchor?.frameTops ?? [];
  const measuredTop = frameTops.length > 0 ? Math.min(...frameTops) : Number.NaN;
  const frameTopDelta = frameTops.length > 0 ? Math.max(...frameTops) - measuredTop : Number.NaN;
  const bounds = [geometry.headlineBounds, geometry.proofBounds];
  if (
    bounds.some((box) =>
      !box
      || ![box.x, box.y, box.width, box.height].every(Number.isFinite)
      || box.x < 0
      || box.y < 0
      || box.width <= 0
      || box.height <= 0
    )
    ||
    !Number.isFinite(geometry.headlineToProofGap)
    || !Number.isFinite(geometry.proofHeight)
    || !Number.isFinite(geometry.proofLowerEdge)
    || !anchor
    || !Number.isFinite(anchor.expectedTopPercent)
    || !Number.isFinite(anchor.actualTop)
    || !Number.isFinite(anchor.actualTopPercent)
    || !Number.isFinite(anchor.maxFrameTopDelta)
    || !Number.isFinite(anchor.tolerancePixels)
    || frameTops.length !== expectation.expectedFrameCount
    || frameTops.some((top) => !Number.isFinite(top) || Math.abs(top - expectedTop) > expectation.tolerancePixels)
    || anchor.expectedTopPercent !== expectation.topPercent
    || Math.abs(anchor.actualTop - expectedTop) > expectation.tolerancePixels
    || Math.abs(anchor.actualTopPercent - expectation.topPercent) > expectation.tolerancePixels / expectation.canvasHeight * 100
    || Math.abs(anchor.actualTop - measuredTop) > 0.01
    || Math.abs(anchor.maxFrameTopDelta - frameTopDelta) > 0.01
    || anchor.maxFrameTopDelta > expectation.tolerancePixels
    || anchor.tolerancePixels !== expectation.tolerancePixels
    || geometry.headlineToProofGapRatio < 0.04
    || geometry.headlineToProofGapRatio > 0.07
    || geometry.proofHeightRatio < 0.6
    || geometry.proofLowerEdgeRatio < 0.94
    || geometry.proofLowerEdgeRatio > 1.04
  ) {
    throw new Error(`${context}: Clean Editorial geometry contract failed`);
  }
}

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
  slides: Array<Pick<NarrativeSlide, "index" | "id" | "composition">>,
  narrative: { id: string; title: string } | null,
  expectedUploadAuthorization: string,
  expectedAnchor: { topPercent: number; tolerancePixels: number },
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
    expectedUploadAuthorization === "candidate-only-human-review-pending-not-upload-authorized"
    && (
      manifest.sourceCaptures.setCompleteness !== "full-locale-device-matrix"
      || manifest.humanVisualReview.state !== "pending"
    )
  ) throw new Error(`${locale}/${device}: candidate output must declare the full selected matrix and pending visual review`);
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
    assertGeometry(item.geometry, `${locale}/${device}/${item.filename}`, {
      canvasHeight: height,
      ...expectedAnchor,
      expectedFrameCount: slide.composition === "garden-growth" || slide.composition === "garden-growth-day" ? 2 : 1,
    });
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
    results: Array<{ file: string; status: string; geometry: Geometry }>;
  };
  if (
    validation.status !== "pass" ||
    validation.expectedImages !== slides.length ||
    validation.actualImages !== slides.length ||
    validation.externalRequests !== 0 ||
    validation.results.length !== slides.length ||
    validation.results.some((item, index) => {
      if (item.status !== "pass" || item.file !== expectedPngNames[index]) return true;
      try {
        assertGeometry(item.geometry, `${locale}/${device}/${item.file}`, {
          canvasHeight: height,
          ...expectedAnchor,
          expectedFrameCount:
            slides[index].composition === "garden-growth" || slides[index].composition === "garden-growth-day" ? 2 : 1,
        });
        return false;
      } catch {
        return true;
      }
    })
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
    geometry: {
      headlineToProofGapPercent: range(manifest.items.map((item) => item.geometry.headlineToProofGapRatio * 100)),
      proofHeightPercent: range(manifest.items.map((item) => item.geometry.proofHeightRatio * 100)),
      proofLowerEdgePercent: range(manifest.items.map((item) => item.geometry.proofLowerEdgeRatio * 100)),
      primaryMockupTopPixels: range(manifest.items.map((item) => item.geometry.primaryMockupAnchor.actualTop)),
      primaryMockupTopCanvasHeightPercent: range(manifest.items.map((item) => item.geometry.primaryMockupAnchor.actualTopPercent)),
      primaryMockupMaximumFrameTopDeltaPixels: Math.max(...manifest.items.map((item) => item.geometry.primaryMockupAnchor.maxFrameTopDelta)),
    },
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
  const candidateOnly = process.argv.includes("--candidate-only");
  if (candidateOnly && narrative) throw new Error("candidate-only validation applies only to the selected current narrative");
  const slides = narrative?.slides ?? plan.slides;
  const requiredCaptureIDs = narrative
    ? [...new Set(narrative.slides.flatMap((slide) => slide.capture_ids))]
    : plan.required_capture_ids;
  const expectedUploadAuthorization = narrative
    ? "candidate-only-not-selected"
    : plan.upload_authorization;
  const captures = await loadSourceCaptures();
  await validateCaptures(captures, captures.sets);

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
          {
            topPercent: plan.layout_geometry.primary_mockup_top_canvas_height_percent[device.id],
            tolerancePixels: plan.layout_geometry.primary_mockup_top_tolerance_pixels,
          },
        ),
      );
    }
  }
  const imageCount = sets.reduce((sum, set) => sum + set.imageCount, 0);
  const expectedImageCount = slides.length * plan.locales.length * plan.devices.length;
  const primaryMockupTopAnchorsByDevice = Object.fromEntries(plan.devices.map((device) => {
    const deviceSets = sets.filter((set) => set.device === device.id);
    if (deviceSets.length !== plan.locales.length) {
      throw new Error(`${device.id}: primary mockup anchor evidence is missing a locale set`);
    }
    const measuredTopPixels = range(deviceSets.flatMap((set) => [
      set.geometry.primaryMockupTopPixels.min,
      set.geometry.primaryMockupTopPixels.max,
    ]));
    const measuredTopCanvasHeightPercent = range(deviceSets.flatMap((set) => [
      set.geometry.primaryMockupTopCanvasHeightPercent.min,
      set.geometry.primaryMockupTopCanvasHeightPercent.max,
    ]));
    const maximumFrameTopDeltaPixels = Math.max(
      ...deviceSets.map((set) => set.geometry.primaryMockupMaximumFrameTopDeltaPixels),
    );
    const tolerancePixels = plan.layout_geometry.primary_mockup_top_tolerance_pixels;
    if (measuredTopPixels.max - measuredTopPixels.min > tolerancePixels || maximumFrameTopDeltaPixels > tolerancePixels) {
      throw new Error(`${device.id}: primary mockup top drifts across slides, locales, or comparison frames`);
    }
    return [device.id, {
      expectedTopCanvasHeightPercent: plan.layout_geometry.primary_mockup_top_canvas_height_percent[device.id],
      tolerancePixels,
      measuredTopPixels,
      measuredTopCanvasHeightPercent,
      maximumFrameTopDeltaPixels,
      localeSets: deviceSets.length,
      slidesPerSet: slides.length,
    }];
  })) as Record<DeviceId, {
    expectedTopCanvasHeightPercent: number;
    tolerancePixels: number;
    measuredTopPixels: { min: number; max: number };
    measuredTopCanvasHeightPercent: { min: number; max: number };
    maximumFrameTopDeltaPixels: number;
    localeSets: number;
    slidesPerSet: number;
  }>;
  if (candidateOnly) {
    if (sets.length !== 4 || imageCount !== expectedImageCount) {
      throw new Error(`selected candidate matrix mismatch: ${sets.length} sets and ${imageCount} images`);
    }
    const slideGeometries = [];
    for (const set of sets) {
      const root = setRoot(set.locale, set.device, null);
      const manifest = JSON.parse(await readFile(path.join(root, "_manifest.json"), "utf8")) as SetManifest;
      for (const item of manifest.items) {
        slideGeometries.push({
          locale: set.locale,
          device: set.device,
          slide: item.slide,
          slideId: item.slideId,
          filename: item.filename,
          sha256: item.sha256,
          headlineBounds: item.geometry.headlineBounds,
          proofBounds: item.geometry.proofBounds,
          primaryMockupAnchor: item.geometry.primaryMockupAnchor,
          headlineToProofGapRatio: item.geometry.headlineToProofGapRatio,
          proofHeightRatio: item.geometry.proofHeightRatio,
          proofLowerEdgeRatio: item.geometry.proofLowerEdgeRatio,
        });
      }
    }
    const runtimeWarningProvenance = captures.result_bundles
      .map((bundle) => ({ device: bundle.device, warningsByTest: bundle.runtime_warnings_by_test }));
    const candidate = {
      schemaVersion: 1,
      status: "candidate-complete-human-review-pending",
      sourceRevision: captures.source_revision,
      expectedMatrix: { setCount: 4, imageCount: expectedImageCount, locales: plan.locales, devices: plan.devices },
      completedCandidate: { setCount: sets.length, imageCount, sets },
      slideGeometryResults: slideGeometries,
      primaryMockupTopAnchorsByDevice,
      fullMatrixStatus: "complete-human-review-pending",
      runtimeWarningProvenance,
      humanVisualReview: "pending",
      uploadAuthorization: "candidate-only-human-review-pending-not-upload-authorized",
      externalRequests: 0,
    };
    const exportsRoot = path.join(ROOT, "exports");
    const candidateValidation = {
      schemaVersion: 1,
      status: "candidate-pass-human-review-pending",
      checks: [
        "4 exact locale/device sets, 24 numbered opaque RGB PNGs at the frozen iPhone and required 13-inch iPad dimensions",
        "per-image and per-artifact SHA-256 readback",
        "PNG normalization is idempotent",
        "per-set JSON and text validation pass",
        "contact-sheet dimensions and SHA-256 readback",
        "ZIP contents and byte readback",
        "headline and proof bounds are recorded and meet the geometry contract for all 24 candidate images",
        "primary mockup tops match the plan-defined device-class anchors across all slides and locales, including both slide-2 frames",
        captures.schema_version === 6
          ? "Garden-day iPhone and iPad 13 source captures are current, source-bound fixed-clock, opaque RGB Simulator captures"
          : "Garden-day iPhone and iPad 13 source captures are current, real-clock, opaque RGB captures",
        captures.schema_version === 6
          ? "The required 13-inch iPad screenshots bind the signed app-source commit, native Simulator build, clock fixture, and exact XCTest results"
          : "The required 13-inch iPad screenshots are source-bound to the current signed physical-device build and fixture evidence",
        "XCTest runtime warnings are preserved by test identity; Garden-day tests have no warnings",
        "external network request count is zero",
      ],
      validatedImageCount: imageCount,
      expectedFinalImageCount: expectedImageCount,
      fullMatrixStatus: "complete-human-review-pending",
      blockers: [],
      runtimeWarningProvenance,
      humanVisualReview: "pending",
      uploadAuthorization: "candidate-only-human-review-pending-not-upload-authorized",
    };
    const candidateMatrix = {
      schemaVersion: 1,
      status: "candidate-complete-human-review-pending",
      supersedesPreviousMatrixValidation: true,
      currentCandidateManifest: "_candidate-manifest.json",
      expectedSets: 4,
      expectedImages: expectedImageCount,
      currentCandidateSets: sets.length,
      currentCandidateImages: imageCount,
      selectedDevices: plan.devices,
      humanVisualReview: "pending",
      uploadAuthorization: "candidate-only-human-review-pending-not-upload-authorized",
    };
    await writeFile(path.join(exportsRoot, "_candidate-manifest.json"), `${JSON.stringify(candidate, null, 2)}\n`);
    await writeFile(path.join(exportsRoot, "_candidate-validation.json"), `${JSON.stringify(candidateValidation, null, 2)}\n`);
    await writeFile(path.join(exportsRoot, "_candidate-validation.txt"), `PASS ${imageCount} candidate images across ${sets.length} locale/device sets\nHUMAN_VISUAL_REVIEW PENDING\nUPLOAD NOT AUTHORIZED\n`);
    await writeFile(path.join(exportsRoot, "_matrix-manifest.json"), `${JSON.stringify({ ...candidateMatrix, primaryMockupTopAnchorsByDevice }, null, 2)}\n`);
    await writeFile(path.join(exportsRoot, "_matrix-validation.json"), `${JSON.stringify({ schemaVersion: 1, status: "candidate-pass-human-review-pending", blockers: [], primaryMockupTopAnchorsByDevice, humanVisualReview: "pending", uploadAuthorization: "candidate-only-human-review-pending-not-upload-authorized" }, null, 2)}\n`);
    await writeFile(path.join(exportsRoot, "_matrix-validation.txt"), `PASS ${imageCount} current candidate images across ${sets.length} locale/device sets\nHUMAN_VISUAL_REVIEW PENDING\nUPLOAD NOT AUTHORIZED\n`);
    process.stdout.write(`Candidate validation passed: ${sets.length} locale/device sets × ${slides.length} slides = ${imageCount}; human visual review pending.\n`);
    return;
  }
  if (sets.length !== 4 || imageCount !== expectedImageCount) {
    throw new Error(`matrix count mismatch: ${sets.length} sets and ${imageCount} images`);
  }

  const reviewStates = [...new Set(sets.map((set) => set.humanVisualReview.state))];
  const geometry = {
    contract: {
      headlineToProofGapPercent: [4, 7],
      minimumProofHeightPercent: 60,
      proofLowerEdgePercent: [94, 104],
      primaryMockupTopCanvasHeightPercent: plan.layout_geometry.primary_mockup_top_canvas_height_percent,
      primaryMockupTopTolerancePixels: plan.layout_geometry.primary_mockup_top_tolerance_pixels,
    },
    headlineToProofGapPercent: range(sets.flatMap((set) => [set.geometry.headlineToProofGapPercent.min, set.geometry.headlineToProofGapPercent.max])),
    proofHeightPercent: range(sets.flatMap((set) => [set.geometry.proofHeightPercent.min, set.geometry.proofHeightPercent.max])),
    proofLowerEdgePercent: range(sets.flatMap((set) => [set.geometry.proofLowerEdgePercent.min, set.geometry.proofLowerEdgePercent.max])),
  };
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
    geometry,
    primaryMockupTopAnchorsByDevice,
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
      "4-7% headline-to-proof gap, at least 60% proof height, and 94-104% proof lower edge on every rendered slide",
      "plan-defined primary mockup top anchors match across slides and locales, including both comparison frames",
      "current app-source revision binding",
      "external network request count is zero",
    ],
    primaryMockupTopAnchorsByDevice,
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
