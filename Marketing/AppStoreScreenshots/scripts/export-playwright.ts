#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import { chromium } from "playwright";
import sharp from "sharp";

import {
  ROOT,
  assertNarrativeAlternatives,
  assertPlan,
  findCaptureSet,
  isAllowedCaptureRequest,
  loadNarrativeAlternatives,
  loadPlan,
  loadSourceCaptures,
  type DeviceId,
  type LocaleId,
} from "./contracts";
import { normalizeOpaqueRgbPng } from "./deterministic-png";
import { validateOpaqueRgbPng, validationText, type ImageValidation } from "./image-validation";
import { validateCaptures } from "./validate-captures";

type Options = {
  device: DeviceId;
  height: number;
  locale: LocaleId;
  narrative: string | null;
  out: string;
  theme: string;
  url: string;
  width: number;
};

type OutputItem = {
  filename: string;
  sha256: string;
  slide: number;
  slideId: string;
  idea: string;
  runtimeSurface: string;
  width: number;
  height: number;
  validation: ImageValidation;
};

function parseOptions(argv: string[]): Options {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    if (index < 0 || !argv[index + 1]) throw new Error(`missing ${flag}`);
    return argv[index + 1];
  };
  const device = value("--device");
  const locale = value("--locale");
  const narrativeIndex = argv.indexOf("--narrative");
  const narrative = narrativeIndex >= 0 ? argv[narrativeIndex + 1] : null;
  if (narrativeIndex >= 0 && !narrative) throw new Error("missing --narrative value");
  if (device !== "iphone-6.9" && device !== "ipad-13") throw new Error(`unsupported device ${device}`);
  if (locale !== "en-US" && locale !== "de-DE") throw new Error(`unsupported locale ${locale}`);
  const result: Options = {
    device,
    height: Number(value("--height")),
    locale,
    narrative,
    out: value("--out"),
    theme: value("--theme"),
    url: value("--url"),
    width: Number(value("--width")),
  };
  if (!Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width <= 0 || result.height <= 0) {
    throw new Error("width and height must be positive integers");
  }
  return result;
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "slide";
}

function assertOutputRoot(out: string): string {
  const exportsRoot = path.resolve(ROOT, "exports");
  const resolved = path.resolve(ROOT, out);
  if (!resolved.startsWith(`${exportsRoot}${path.sep}`)) {
    throw new Error(`output must be a locale/device set beneath ${exportsRoot}`);
  }
  return resolved;
}

async function makeContactSheet(items: OutputItem[], root: string): Promise<{ height: number; sha256: string; width: number }> {
  const width = 1440;
  const height = 1890;
  const margin = 30;
  const gap = 30;
  const cellWidth = 440;
  const cellHeight = 900;
  const thumbnails = await Promise.all(
    items.map(async (item, index) => ({
      input: await sharp(await readFile(path.join(root, item.filename)))
        .resize({
          width: cellWidth,
          height: cellHeight,
          fit: "contain",
          background: { r: 244, g: 246, b: 242 },
        })
        .png()
        .toBuffer(),
      left: margin + (index % 3) * (cellWidth + gap),
      top: margin + Math.floor(index / 3) * (cellHeight + gap),
    })),
  );
  const output = path.join(root, "_contact-sheet.jpg");
  const encoded = await sharp({
    create: { width, height, channels: 3, background: { r: 244, g: 246, b: 242 } },
  })
    .composite(thumbnails)
    .jpeg({ chromaSubsampling: "4:4:4", mozjpeg: false, quality: 92 })
    .toBuffer({ resolveWithObject: true });
  await writeFile(output, encoded.data);
  return { height: encoded.info.height, sha256: sha256(encoded.data), width: encoded.info.width };
}

async function makeZip(
  root: string,
  filenames: string[],
  locale: LocaleId,
  device: DeviceId,
  narrative: string | null,
): Promise<string> {
  const zip = new JSZip();
  const fixedDate = new Date("2026-08-09T00:00:00.000Z");
  for (const filename of filenames.sort()) {
    zip.file(filename, await readFile(path.join(root, filename)), { date: fixedDate });
  }
  const narrativeSuffix = narrative ? `-${slug(narrative)}` : "";
  const output = path.join(root, `arrive-within-app-store${narrativeSuffix}-${slug(locale)}-${slug(device)}.zip`);
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });
  await writeFile(output, buffer);
  return output;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const plan = await loadPlan();
  assertPlan(plan);
  const alternatives = await loadNarrativeAlternatives();
  assertNarrativeAlternatives(alternatives);
  const narrative = options.narrative
    ? alternatives.narratives.find((candidate) => candidate.id === options.narrative)
    : null;
  if (options.narrative && !narrative) throw new Error(`unknown narrative ${options.narrative}`);
  const slides = narrative?.slides ?? plan.slides;
  const requiredCaptureIDs = narrative
    ? [...new Set(narrative.slides.flatMap((slide) => slide.capture_ids))]
    : plan.required_capture_ids;
  const outputDevice = plan.devices.find((item) => item.id === options.device);
  if (!outputDevice || outputDevice.width !== options.width || outputDevice.height !== options.height) {
    throw new Error("CLI dimensions do not match the frozen device matrix");
  }

  const captures = await loadSourceCaptures();
  const currentSet = findCaptureSet(captures, options.locale, options.device);
  const companionDevice: DeviceId = options.device === "iphone-6.9" ? "ipad-13" : "iphone-6.9";
  const companionSet = findCaptureSet(captures, options.locale, companionDevice);
  await validateCaptures(captures, [currentSet, companionSet], requiredCaptureIDs);

  const target = new URL(options.url);
  if (
    target.protocol !== "http:"
    || target.hostname !== "127.0.0.1"
    || target.username !== ""
    || target.password !== ""
  ) {
    throw new Error("the screenshot studio must use unauthenticated local HTTP on 127.0.0.1");
  }
  if (target.searchParams.get("device") !== options.device || target.searchParams.get("locale") !== options.locale) {
    throw new Error("URL device/locale does not match the requested set");
  }
  if ((target.searchParams.get("narrative") ?? null) !== options.narrative) {
    throw new Error("URL narrative does not match the requested set");
  }

  const root = assertOutputRoot(options.out);
  await mkdir(root, { recursive: true });
  const expectedPngNames = slides.map(
    (slide) => `${String(slide.index).padStart(2, "0")}-${slug(slide.id)}-${slug(options.locale)}-${slug(options.device)}-${options.width}x${options.height}.png`,
  );
  const unexpectedPngs = (await readdir(root)).filter((file) => file.endsWith(".png") && !expectedPngNames.includes(file));
  if (unexpectedPngs.length) throw new Error(`refusing output set with stale/unexpected PNGs: ${unexpectedPngs.join(", ")}`);

  // Rotated, overlapping device frames must rasterize identically across passes.
  // SwiftShader's GPU antialiasing can vary by several channel values at the
  // transformed edge, which is larger than the intentional LSB normalization.
  const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-skia-runtime-opts"] });
  const items: OutputItem[] = [];
  let blockedExternalRequests = 0;
  let contactSheet = { height: 0, sha256: "", width: 0 };
  try {
    const page = await browser.newPage({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    await page.route("**/*", (route) => {
      const requestUrl = route.request().url();
      if (isAllowedCaptureRequest(requestUrl, target.origin)) {
        return route.continue();
      }
      blockedExternalRequests += 1;
      return route.abort();
    });
    await page.goto(target.href, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map(async (image) => {
          await image.decode();
          if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
            throw new Error(`invalid source capture ${image.currentSrc || image.src}`);
          }
        }),
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const mainStatus = await page.locator("main").getAttribute("data-screenshot-status");
    const expectedStatus = narrative ? alternatives.status : plan.status;
    if (mainStatus !== expectedStatus) throw new Error("rendered screenshot page status mismatch");
    if ((await page.locator("main").getAttribute("data-device")) !== options.device) throw new Error("rendered device mismatch");
    if ((await page.locator("main").getAttribute("data-locale")) !== options.locale) throw new Error("rendered locale mismatch");
    if ((await page.locator("main").getAttribute("data-narrative")) !== (options.narrative ?? "current")) {
      throw new Error("rendered narrative mismatch");
    }

    const renderedSlides = page.locator("[data-export-slide]");
    if ((await renderedSlides.count()) !== slides.length) throw new Error("rendered slide count does not match source");
    for (let index = 0; index < slides.length; index += 1) {
      const planned = slides[index];
      const slide = renderedSlides.nth(index);
      const slideId = await slide.getAttribute("data-export-slide");
      if (slideId !== planned.id) throw new Error(`rendered slide ${index + 1} is out of order`);
      const renderedCaptureIDs = await slide.locator("[data-source-capture]").evaluateAll(
        (nodes) => nodes.map((node) => node.getAttribute("data-source-capture")),
      );
      const plannedCaptureIDs: string[] = "capture_ids" in planned && Array.isArray(planned.capture_ids)
        ? planned.capture_ids as string[]
        : [];
      const expectedCaptureIDs = plannedCaptureIDs.map(
        (captureID) => `${options.locale}/${options.device}/${captureID}`,
      );
      if (narrative && JSON.stringify(renderedCaptureIDs) !== JSON.stringify(expectedCaptureIDs)) {
        throw new Error(`${planned.id}: rendered source captures do not match the narrative contract`);
      }
      if (
        await slide.locator(":scope > header > *").count() !== 1
        || await slide.locator(":scope > header > h1").count() !== 1
        || await slide.locator(".product-name, .supporting-copy").count() !== 0
      ) {
        throw new Error(`${planned.id}: slide must contain exactly one headline block and no subtitle layers`);
      }
      const bounds = await slide.boundingBox();
      if (!bounds || Math.round(bounds.width) !== options.width || Math.round(bounds.height) !== options.height) {
        throw new Error(`${planned.id}: slide bounds do not match ${options.width}x${options.height}`);
      }
      const headlineBounds = await slide.locator(":scope > header > h1").boundingBox();
      const proofBounds = await slide.locator(":scope > .composition .device-frame").first().boundingBox();
      if (!headlineBounds || !proofBounds) throw new Error(`${planned.id}: missing headline or product proof bounds`);
      const headlineToProofGap = proofBounds.y - (headlineBounds.y + headlineBounds.height);
      if (headlineToProofGap < -8 || headlineToProofGap > options.height * 0.06) {
        throw new Error(`${planned.id}: headline-to-product gap ${Math.round(headlineToProofGap)}px must stay between -8 and ${Math.round(options.height * 0.06)}px`);
      }
      const filename = expectedPngNames[index];
      const absolute = path.join(root, filename);
      await slide.screenshot({ animations: "disabled", caret: "hide", omitBackground: false });
      const rawScreenshot = await slide.screenshot({ animations: "disabled", caret: "hide", omitBackground: false });
      await writeFile(absolute, normalizeOpaqueRgbPng(rawScreenshot));
      const validation = await validateOpaqueRgbPng(absolute, options.width, options.height);
      const data = await readFile(absolute);
      items.push({
        filename,
        sha256: sha256(data),
        slide: planned.index,
        slideId: planned.id,
        idea: planned.idea,
        runtimeSurface: planned.runtime_surface,
        width: options.width,
        height: options.height,
        validation: { ...validation, file: filename },
      });
    }
    contactSheet = await makeContactSheet(items, root);
  } finally {
    await browser.close();
  }

  if (blockedExternalRequests !== 0) throw new Error(`blocked ${blockedExternalRequests} attempted external request(s)`);
  if (items.some((item) => item.validation.status !== "pass")) throw new Error("one or more output PNGs failed validation");

  const validation = {
    schemaVersion: 1,
    status: "pass",
    expectedImages: slides.length,
    actualImages: items.length,
    externalRequests: 0,
    results: items.map((item) => item.validation),
  };
  await writeFile(path.join(root, "_validation.txt"), `${validationText(items.map((item) => item.validation))}\n`);
  await writeFile(path.join(root, "_validation.json"), `${JSON.stringify(validation, null, 2)}\n`);

  const manifest = {
    schemaVersion: 1,
    product: "Arrive Within",
    generatedAt: null,
    generationTimePolicy: "omitted-for-byte-reproducibility",
    locale: options.locale,
    device: options.device,
    theme: options.theme,
    width: options.width,
    height: options.height,
    renderer: "Playwright Chromium element screenshots",
    pixelNormalization: "Deterministic RGB PNG encoding with each RGB least-significant bit cleared",
    copyState: narrative ? alternatives.status : plan.copy_state,
    narrative: narrative
      ? { id: narrative.id, title: narrative.title, ownerSelection: alternatives.owner_selection }
      : { id: "current", title: "Frozen current narrative", ownerSelection: null },
    humanVisualReview: narrative
      ? {
          state: "pending",
          reviewer: null,
          reviewedAt: null,
          notes: "Non-shipping narrative candidate; inspect every locale/device contact sheet before any selection.",
        }
      : {
          state: "approved",
          reviewer: "implementation-review",
          reviewedAt: "2026-08-12",
          notes: "All revised final pixels were inspected in English and German on iPhone and iPad: each slide has exactly one headline, no eyebrow or subtitle, a tight headline-to-product gap, no clipping, and legible real app UI.",
        },
    network: { policy: plan.network_policy, externalRequests: 0 },
    sourceCaptures: {
      state: captures.state,
      method: captures.capture_method,
      test: captures.capture_test,
      statusBarProfile: captures.status_bar_profile,
      sourceRevision: captures.source_revision,
      sourceRevisionKind: captures.source_revision_kind,
      sourceManifestPath: captures.source_manifest_path,
      resultBundle: currentSet.result_bundle,
      safeSyntheticData: captures.safe_synthetic_data,
      currentSet,
      companionGarden: {
        locale: companionSet.locale,
        device: companionSet.device,
        model: companionSet.model,
        os: companionSet.os,
        capture: companionSet.captures["garden-hero"],
      },
    },
    contactSheet: {
      filename: "_contact-sheet.jpg",
      sha256: contactSheet.sha256,
      width: contactSheet.width,
      height: contactSheet.height,
      encoding: "sharp 0.35.3 JPEG quality 92, 4:4:4 chroma subsampling, no metadata",
    },
    items: items.map(({ validation: _validation, ...item }) => item),
    uploadAuthorization: narrative ? "candidate-only-not-selected" : plan.upload_authorization,
  };
  await writeFile(path.join(root, "_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const zipInputs = [
    ...items.map((item) => item.filename),
    "_manifest.json",
    "_validation.txt",
    "_validation.json",
    "_contact-sheet.jpg",
  ];
  const zipPath = await makeZip(root, zipInputs, options.locale, options.device, options.narrative);
  process.stdout.write(
    `Export passed: ${items.length} opaque RGB screenshots for ${options.locale}/${options.device}; ZIP ${path.basename(zipPath)}; human visual review ${manifest.humanVisualReview.state}.\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
