import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  GARDEN_DAY_CAPTURED_SOURCE_REVISION,
  GARDEN_DAY_CAPTURE_TEST_PATH,
  GARDEN_DAY_CHANGED_PATHS,
  GARDEN_DAY_CURRENT_SOURCE_REVISION,
  isExactGardenDayRealClockCaptureRefresh,
  type GardenDayRealClockCaptureRefresh,
} from "./capture-drift-policy";
import {
  ROOT,
  loadSourceCaptures,
  resolveBoundedChildPath,
  type LocaleId,
  type SourceCaptures,
} from "./contracts";
import { validateOpaqueRgbPng } from "./image-validation";
import { computeCaptureSourceManifest, type CaptureSourceManifest } from "./source-provenance";

const PROJECT_ROOT = path.resolve(ROOT, "../..");
const TESTS: Record<LocaleId, string> = {
  "en-US": "ArriveWithinMarketingCaptureUITests/testCaptureGardenDayEnglish()",
  "de-DE": "ArriveWithinMarketingCaptureUITests/testCaptureGardenDayGerman()",
};
const PATHS: Record<LocaleId, string> = {
  "en-US": "public/runtime-ui/en-US/iphone-6.9/garden-day.png",
  "de-DE": "public/runtime-ui/de-DE/iphone-6.9/garden-day.png",
};
type Attachment = {
  deviceName: string;
  exportedFileName: string;
  isAssociatedWithFailure: boolean;
  suggestedHumanReadableName: string;
};
type AttachmentGroup = { attachments: Attachment[]; testIdentifier: string };

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function value(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${flag}`);
  return process.argv[index + 1];
}

async function hashTree(root: string): Promise<string> {
  const digest = createHash("sha256");
  async function visit(relative: string): Promise<void> {
    for (const child of (await readdir(path.join(root, relative), { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = path.join(relative, child.name);
      if (child.isSymbolicLink()) throw new Error(`xcresult must not contain a symbolic link: ${childRelative}`);
      if (child.isDirectory()) await visit(childRelative);
      else if (child.isFile()) {
        const normalized = childRelative.split(path.sep).join(path.posix.sep);
        digest.update(normalized);
        digest.update("\0");
        digest.update(sha256(await readFile(path.join(root, childRelative))));
        digest.update("\n");
      } else throw new Error(`unsupported xcresult entry: ${childRelative}`);
    }
  }
  await visit("");
  return digest.digest("hex");
}

async function main(): Promise<void> {
  const resultInput = value("--result");
  const result = path.resolve(PROJECT_ROOT, resultInput);
  const buildRoot = await realpath(path.join(PROJECT_ROOT, ".build"));
  const realResult = await realpath(result);
  if (!realResult.startsWith(`${buildRoot}${path.sep}`) || !realResult.endsWith(".xcresult")) {
    throw new Error("result bundle must be beneath the project .build directory");
  }
  if (!(await lstat(realResult)).isDirectory()) throw new Error("result bundle is not a directory");

  const summary = JSON.parse(execFileSync("xcrun", [
    "xcresulttool", "get", "test-results", "summary", "--path", realResult, "--compact",
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })) as {
    result: string;
    totalTestCount: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
  };
  if (
    summary.result !== "Passed"
    || summary.totalTestCount !== 2
    || summary.passedTests !== 2
    || summary.failedTests !== 0
    || summary.skippedTests !== 0
  ) throw new Error("Garden day result must contain exactly two passed locale captures with no skips or failures");

  const oldCaptures = await loadSourceCaptures();
  if (oldCaptures.schema_version !== 2) {
    throw new Error("legacy supplementary Garden-day ingestion cannot update per-set current-source provenance; use ingest:current-captures");
  }
  const oldSourceManifestPath = path.resolve(ROOT, oldCaptures.source_manifest_path ?? "");
  const oldManifest = JSON.parse(await readFile(oldSourceManifestPath, "utf8")) as CaptureSourceManifest;
  const currentManifest = await computeCaptureSourceManifest();
  const oldHashes = new Map(oldManifest.files.map((file) => [file.path, file.sha256]));
  const currentHashes = new Map(currentManifest.files.map((file) => [file.path, file.sha256]));
  const changedPaths = [...new Set([...oldHashes.keys(), ...currentHashes.keys()])]
    .filter((file) => oldHashes.get(file) !== currentHashes.get(file))
    .sort();
  const attestation: GardenDayRealClockCaptureRefresh = {
    classification: "garden-day-real-clock-capture-test-added",
    captured_source_revision: GARDEN_DAY_CAPTURED_SOURCE_REVISION,
    current_source_revision: currentManifest.source_revision,
    changed_path_count: changedPaths.length,
    changed_paths: changedPaths,
    new_capture_id: "garden-day",
    new_capture_device: "iphone-6.9",
    garden_day_clock: "unmodified-simulator-system-clock-in-local-day-range",
    existing_garden_seed_and_dusk_hero_retained: true,
    human_visual_review: "pending",
    app_store_listing_mutation: "none",
    rationale: "The source revision delta is recorded path by path and is limited to app icon assets, the Live Activity and its localization/build metadata, and XCTest files; Garden, Journey, Journal, and renderer view source did not change. The new Garden day image was captured with the unmodified simulator local clock at 08:02 Asia/Singapore. Garden seed and dusk hero source pixels were retained. iPad 13-inch capture remains unavailable because the installed simulator pool has no 13-inch slot. No App Store Connect mutation was performed.",
  };
  if (
    oldManifest.source_revision !== GARDEN_DAY_CAPTURED_SOURCE_REVISION
    || currentManifest.source_revision !== GARDEN_DAY_CURRENT_SOURCE_REVISION
    || JSON.stringify(changedPaths) !== JSON.stringify(GARDEN_DAY_CHANGED_PATHS)
    || !isExactGardenDayRealClockCaptureRefresh(
      attestation,
      oldManifest.source_revision,
      currentManifest.source_revision,
      changedPaths,
    )
  ) throw new Error(`capture source drift is not the exact reviewed boundary: ${changedPaths.join(", ")}`);

  const treeSha256 = await hashTree(realResult);
  const exportedRoot = await mkdtemp(path.join(os.tmpdir(), "arrive-within-garden-day-"));
  try {
    execFileSync("xcrun", ["xcresulttool", "export", "attachments", "--path", realResult, "--output-path", exportedRoot], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const groups = JSON.parse(await readFile(path.join(exportedRoot, "manifest.json"), "utf8")) as AttachmentGroup[];
    if (groups.length !== 2) throw new Error("expected two Garden day attachment groups");
    const captured: Partial<Record<LocaleId, { sha256: string }>> = {};
    for (const locale of ["en-US", "de-DE"] as LocaleId[]) {
      const group = groups.find((candidate) => candidate.testIdentifier === TESTS[locale]);
      if (!group || group.attachments.length !== 1) throw new Error(`${locale}: expected exactly one Garden day screenshot`);
      const attachment = group.attachments[0];
      if (
        attachment.isAssociatedWithFailure
        || !attachment.suggestedHumanReadableName.startsWith(`marketing-${locale}-garden-day_0_`)
        || !attachment.suggestedHumanReadableName.endsWith(".png")
      ) throw new Error(`${locale}: unexpected or failure-associated Garden day attachment`);
      const candidate = resolveBoundedChildPath(exportedRoot, attachment.exportedFileName);
      const candidateStat = await lstat(candidate);
      if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) throw new Error(`${locale}: attachment is not a regular file`);
      const exportedRealRoot = await realpath(exportedRoot);
      const source = await realpath(candidate);
      if (!source.startsWith(`${exportedRealRoot}${path.sep}`)) throw new Error(`${locale}: attachment escapes temp export root`);
      const validation = await validateOpaqueRgbPng(source, 1206, 2622);
      if (validation.status !== "pass") throw new Error(`${locale}: ${validation.errors.join("; ")}`);
      const destination = path.resolve(ROOT, PATHS[locale]);
      const publicRoot = path.resolve(ROOT, "public");
      if (!destination.startsWith(`${publicRoot}${path.sep}`)) throw new Error(`${locale}: output escapes public/`);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      captured[locale] = { sha256: sha256(await readFile(destination)) };
    }

    const sourceManifestBytes = Buffer.from(`${JSON.stringify(currentManifest, null, 2)}\n`);
    const sourceManifestPath = "garden-day-capture-source-manifest.json";
    await writeFile(path.join(ROOT, sourceManifestPath), sourceManifestBytes);
    const captures = await loadSourceCaptures();
    captures.state = "candidate-ready";
    delete captures.human_visual_review;
    delete (captures as SourceCaptures & { test_clock_overrides?: unknown }).test_clock_overrides;
    captures.capture_method = "Guarded XCUITest on the configured iPhone 17 Pro pool slot; supplementary mature Garden day capture uses the unmodified simulator system clock. Existing dusk seed and dusk hero images are retained.";
    captures.capture_test = "Original retained source captures remain bound to their recorded result bundles; Garden day is supplementary ArriveWithinMarketingCaptureUITests/testCaptureGardenDayEnglish() and testCaptureGardenDayGerman(), both with no wall-clock launch override.";
    captures.status_bar_profile = "Actual visible system status from each exact passed simulator capture run; Garden day status shows 08:02 Asia/Singapore; no synthetic status-bar overlay.";
    captures.post_capture_change = attestation;
    captures.garden_day_captures = [{
      device: "iphone-6.9",
      source_revision: currentManifest.source_revision,
      source_manifest_path: sourceManifestPath,
      source_manifest_sha256: sha256(sourceManifestBytes),
      result_bundle: {
        name: path.basename(realResult),
        xcresult_tree_sha256: treeSha256,
        passed_tests: summary.passedTests,
        failed_tests: summary.failedTests,
        skipped_tests: summary.skippedTests,
      },
      test_identifiers: TESTS,
      clock_mode: "unmodified-simulator-system-clock",
      capture_local_date: "2026-09-25",
      capture_local_times: { "en-US": "08:02", "de-DE": "08:02" },
      visible_status_times: { "en-US": "08:02", "de-DE": "08:02" },
      timezone: "Asia/Singapore",
      phase: "day",
    }];
    for (const locale of ["en-US", "de-DE"] as LocaleId[]) {
      const set = captures.sets.find((item) => item.locale === locale && item.device === "iphone-6.9");
      if (!set) throw new Error(`${locale}/iphone-6.9: capture set is missing`);
      set.captures["garden-day"] = { path: PATHS[locale], sha256: captured[locale]!.sha256 };
    }
    await writeFile(path.join(ROOT, "source-captures.json"), `${JSON.stringify(captures, null, 2)}\n`);
  } finally {
    await rm(exportedRoot, { recursive: true });
  }
  process.stdout.write(`Ingested two real-clock Garden day phone screenshots from ${path.basename(realResult)}; iPad 13 remains unfilled.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
