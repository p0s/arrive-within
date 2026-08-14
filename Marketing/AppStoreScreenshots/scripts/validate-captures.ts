import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ROOT,
  assertNarrativeAlternatives,
  assertPlan,
  loadNarrativeAlternatives,
  loadPlan,
  loadSourceCaptures,
  type CaptureSet,
  type SourceCaptures,
} from "./contracts";
import { validateOpaqueRgbPng } from "./image-validation";
import { isExactSubmittedBuildCaptureFreeze } from "./capture-drift-policy";
import { computeCaptureSourceManifest, type CaptureSourceManifest } from "./source-provenance";

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function validateCaptures(
  captures: SourceCaptures,
  sets: CaptureSet[],
  requiredCaptureIDs?: string[],
): Promise<void> {
  const plan = await loadPlan();
  assertPlan(plan);
  const expectedIDs = requiredCaptureIDs ?? plan.required_capture_ids;

  if (captures.schema_version !== 2 || !["candidate-ready", "human-reviewed"].includes(captures.state)) {
    throw new Error("source-captures.json is not candidate-ready; actual deterministic rendered captures remain required");
  }
  if (captures.state === "human-reviewed") {
    const review = captures.human_visual_review;
    if (
      review?.state !== "approved" ||
      !review.reviewer.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewed_on) ||
      !review.notes.trim()
    ) {
      throw new Error("human-reviewed source captures require a complete approved visual-review record");
    }
  } else if (captures.human_visual_review) {
    throw new Error("candidate-ready source captures must not retain a prior visual-review record");
  }
  if (!captures.safe_synthetic_data) throw new Error("source captures must attest safe synthetic data");
  if (!captures.capture_method.includes("Guarded XCUITest") || !captures.capture_test.trim()) {
    throw new Error("source capture method/test provenance is incomplete");
  }
  if (
    !captures.status_bar_profile.includes("Actual visible system status") ||
    !captures.status_bar_profile.includes("no synthetic status-bar overlay")
  ) {
    throw new Error("truthful status-bar capture provenance is missing");
  }
  if (!captures.source_revision || captures.source_revision_kind !== "sha256-capture-source-manifest") {
    throw new Error("source capture revision is unbound");
  }
  if (!captures.source_manifest_path) throw new Error("source capture manifest path is missing");
  const sourceManifestPath = path.resolve(ROOT, captures.source_manifest_path);
  if (!sourceManifestPath.startsWith(`${ROOT}${path.sep}`)) throw new Error("source capture manifest escapes the generator root");
  const storedManifest = JSON.parse(await readFile(sourceManifestPath, "utf8")) as CaptureSourceManifest;
  const currentManifest = await computeCaptureSourceManifest();
  if (
    storedManifest.schema_version !== 1 ||
    storedManifest.generated_at !== null ||
    storedManifest.generation_time_policy !== "omitted-for-byte-reproducibility" ||
    storedManifest.source_revision !== captures.source_revision
  ) {
    throw new Error("source capture revision no longer matches the current app source tree");
  }
  if (currentManifest.source_revision !== captures.source_revision) {
    const storedHashes = new Map(storedManifest.files.map((file) => [file.path, file.sha256]));
    const currentHashes = new Map(currentManifest.files.map((file) => [file.path, file.sha256]));
    const changedPaths = [...new Set([...storedHashes.keys(), ...currentHashes.keys()])]
      .filter((file) => storedHashes.get(file) !== currentHashes.get(file))
      .sort();
    if (!isExactSubmittedBuildCaptureFreeze(captures.post_capture_change, currentManifest.source_revision, changedPaths)) {
      throw new Error("source capture revision drift is not the one exact submitted-build-7 Garden freeze");
    }
  }
  if (captures.result_bundles.length !== 2) throw new Error("exactly two iPhone/iPad result bundles are required");
  for (const bundle of captures.result_bundles) {
    if (
      !bundle.name.endsWith(".xcresult") ||
      !bundle.xcresult_tree_sha256.match(/^[a-f0-9]{64}$/) ||
      bundle.passed_tests !== 2 ||
      bundle.failed_tests !== 0 ||
      bundle.skipped_tests !== 0
    ) {
      throw new Error(`${bundle.device}: invalid result-bundle provenance`);
    }
  }

  for (const set of sets) {
    if (
      !set.result_bundle ||
      !set.result_bundle.name.endsWith(".xcresult") ||
      !set.result_bundle.xcresult_tree_sha256.match(/^[a-f0-9]{64}$/) ||
      !set.result_bundle.test_identifier.startsWith("ArriveWithinMarketingCaptureUITests/testCaptureAllRequiredMarketingStates")
    ) {
      throw new Error(`${set.locale}/${set.device}: result-bundle provenance is incomplete`);
    }
    const bundle = captures.result_bundles.find((candidate) => candidate.device === set.device);
    if (
      !bundle ||
      bundle.name !== set.result_bundle.name ||
      bundle.xcresult_tree_sha256 !== set.result_bundle.xcresult_tree_sha256
    ) {
      throw new Error(`${set.locale}/${set.device}: result-bundle provenance mismatch`);
    }
    const missingIDs = expectedIDs.filter((id) => !set.captures[id]);
    if (missingIDs.length > 0) {
      throw new Error(`${set.locale}/${set.device}: missing capture IDs: ${missingIDs.join(", ")}`);
    }
    for (const id of expectedIDs) {
      const record = set.captures[id];
      const absolute = path.resolve(ROOT, record.path);
      const publicRoot = await realpath(path.join(ROOT, "public"));
      const actual = await realpath(absolute).catch(() => absolute);
      if (!(actual === publicRoot || actual.startsWith(`${publicRoot}${path.sep}`))) {
        throw new Error(`${set.locale}/${set.device}/${id}: capture path escapes public/`);
      }
      const validation = await validateOpaqueRgbPng(absolute, set.width, set.height);
      if (validation.status !== "pass") {
        throw new Error(`${set.locale}/${set.device}/${id}: ${validation.errors.join("; ")}`);
      }
      if (!record.sha256?.match(/^[a-f0-9]{64}$/)) {
        throw new Error(`${set.locale}/${set.device}/${id}: missing source SHA-256`);
      }
      const actualHash = sha256(await readFile(absolute));
      if (actualHash !== record.sha256) {
        throw new Error(`${set.locale}/${set.device}/${id}: source SHA-256 mismatch`);
      }
    }
  }
}

async function main() {
  const captures = await loadSourceCaptures();
  const plan = await loadPlan();
  const alternatives = await loadNarrativeAlternatives();
  assertNarrativeAlternatives(alternatives);
  const expectedSetKeys = plan.locales
    .flatMap((locale) => plan.devices.map((device) => `${locale}/${device.id}`))
    .sort();
  const actualSetKeys = captures.sets.map((set) => `${set.locale}/${set.device}`).sort();
  if (JSON.stringify(actualSetKeys) !== JSON.stringify(expectedSetKeys)) {
    throw new Error("source captures must contain each exact locale/device set once");
  }
  await validateCaptures(captures, captures.sets, plan.required_capture_ids);
  process.stdout.write(
    `Source captures passed: ${captures.sets.length} sets × ${plan.required_capture_ids.length} selected actual rendered states.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
