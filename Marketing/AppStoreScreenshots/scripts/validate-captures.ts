import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  ROOT,
  assertNarrativeAlternatives,
  assertPlan,
  loadNarrativeAlternatives,
  loadPlan,
  loadSourceCaptures,
  type CaptureResultBundle,
  type CaptureSet,
  type DeviceId,
  type LocaleId,
  type SimulatorCaptureSourceEvidence,
  type SourceCaptures,
} from "./contracts";
import { assertCaptureSetSourceBinding } from "./capture-set-provenance";
import { assertCaptureSourceCommit } from "./capture-source-commit";
import {
  assertCaptureSourceEvidence,
  expectedCaptureRole,
  expectedCaptureTestIdentifier,
  type CaptureId,
} from "./capture-evidence";
import { validateOpaqueRgbPng } from "./image-validation";
import { computeCaptureSourceManifest, type CaptureSourceManifest } from "./source-provenance";
import {
  expectedClockFixtureID,
  MARKETING_STATUS_BAR_DECLARATION,
  marketingClockFixture,
} from "./marketing-clock-fixtures";

const DEVICES: DeviceId[] = ["iphone-6.9", "ipad-13"];
const LOCALES: LocaleId[] = ["en-US", "de-DE"];
const CAPTURE_IDS: CaptureId[] = [
  "garden-hero", "garden-day", "garden-seed", "journey-calendar", "journey-milestones", "journal",
];
const SOURCE_DIMENSIONS: Record<DeviceId, { width: number; height: number }> = {
  "iphone-6.9": { width: 1206, height: 2622 },
  "ipad-13": { width: 2064, height: 2752 },
};
const DEVICE_MODELS: Record<DeviceId, string> = {
  "iphone-6.9": "iPhone 17 Pro",
  "ipad-13": "iPad Pro 13-inch (M5)",
};

type CurrentBinding = {
  source_commit: string;
  source_revision: string;
  source_manifest_path: string;
  source_manifest_sha256: string;
};

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function sourceManifestPath(relative: string): string {
  const resolved = path.resolve(ROOT, relative);
  if (!resolved.startsWith(`${ROOT}${path.sep}`)) {
    throw new Error("capture source manifest escapes the screenshot studio");
  }
  return resolved;
}

function expectedBundleTests(role: "selected" | "garden-day"): string[] {
  const id: CaptureId = role === "garden-day" ? "garden-day" : "garden-seed";
  return LOCALES.map((locale) => expectedCaptureTestIdentifier(locale, id)).sort();
}

function exactStrings(actual: unknown, expected: string[]): boolean {
  return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
}

function assertExactKeys(value: unknown, expected: string[], context: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context}: expected an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${context}: expected exactly keys ${wanted.join(", ")}`);
  }
}

export function assertSimulatorBundleContract(
  bundles: CaptureResultBundle[],
  current: CurrentBinding,
): void {
  const bundleFields = [
    "device", "capture_role", "name", "xcresult_tree_sha256", "passed_tests", "failed_tests", "skipped_tests",
    "source_commit", "source_revision", "source_manifest_path", "source_manifest_sha256", "test_identifiers",
    "runtime_warnings_by_test", "simulator", "clock_fixture_id", "clock_epoch", "timezone", "garden_phase",
  ];
  if (!Array.isArray(bundles)) throw new Error("schema 6 result provenance must be an array");
  for (const [index, bundle] of (bundles as unknown[]).entries()) {
    assertExactKeys(bundle, bundleFields, `result bundle ${index}`);
  }
  const roles = ["selected", "garden-day"] as const;
  const expectedKeys = DEVICES.flatMap((device) => roles.map((role) => `${device}/${role}`)).sort();
  const actualKeys = bundles.map((bundle) => `${bundle.device}/${bundle.capture_role}`).sort();
  if (bundles.length !== 4 || JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error("schema 6 requires exactly selected/day simulator bundles for iPhone 17 Pro and iPad Pro 13-inch (M5)");
  }

  for (const device of DEVICES) {
    const deviceBundles = bundles.filter((bundle) => bundle.device === device);
    for (const role of roles) {
      const bundle = deviceBundles.find((candidate) => candidate.capture_role === role)!;
      const expectedTests = expectedBundleTests(role);
      const expectedFixtureID = expectedClockFixtureID(role);
      const fixture = marketingClockFixture(expectedFixtureID);
      const warnings = bundle.runtime_warnings_by_test;
      const simulator = bundle.simulator;
      if (!simulator) throw new Error(`${device}/${role}: simulator product metadata is missing`);
      assertExactKeys(simulator, ["model_name", "os_version", "platform"], `${device}/${role} simulator metadata`);
      const simulatorKeys = Object.keys(simulator).sort();
      if (
        typeof bundle.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.xcresult$/.test(bundle.name) ||
        !/^[a-f0-9]{64}$/.test(bundle.xcresult_tree_sha256) ||
        bundle.passed_tests !== 2 || bundle.failed_tests !== 0 || bundle.skipped_tests !== 0 ||
        bundle.source_commit !== current.source_commit ||
        bundle.source_revision !== current.source_revision ||
        bundle.source_manifest_path !== current.source_manifest_path ||
        bundle.source_manifest_sha256 !== current.source_manifest_sha256 ||
        !exactStrings(bundle.test_identifiers, expectedTests) ||
        !warnings || JSON.stringify(Object.keys(warnings).sort()) !== JSON.stringify(expectedTests) ||
        expectedTests.some((identifier) => !Array.isArray(warnings[identifier]) || warnings[identifier].some((warning) => typeof warning !== "string")) ||
        !simulator || JSON.stringify(simulatorKeys) !== JSON.stringify(["model_name", "os_version", "platform"]) ||
        simulator.model_name !== DEVICE_MODELS[device] || simulator.os_version !== "26.5" ||
        simulator.platform !== "iOS Simulator" || "udid" in (simulator as unknown as Record<string, unknown>) ||
        bundle.clock_fixture_id !== expectedFixtureID || bundle.clock_epoch !== String(fixture.epoch) ||
        bundle.timezone !== fixture.timezone || bundle.garden_phase !== fixture.garden_phase
      ) {
        throw new Error(`${device}/${role}: source, simulator, clock fixture, tests, warnings, or result provenance is incomplete`);
      }
    }
    const selected = deviceBundles.find((bundle) => bundle.capture_role === "selected")!;
    const day = deviceBundles.find((bundle) => bundle.capture_role === "garden-day")!;
    if (selected.name === day.name || selected.xcresult_tree_sha256 === day.xcresult_tree_sha256) {
      throw new Error(`${device}: selected and Garden-day evidence must use distinct result bundles`);
    }
  }
}

async function validateManifestBinding(
  relativePath: string,
  expectedRevision: string,
  expectedSha256: string,
): Promise<CaptureSourceManifest> {
  const filename = sourceManifestPath(relativePath);
  const fileStat = await lstat(filename);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error(`${relativePath}: source manifest must be a regular file`);
  const bytes = await readFile(filename);
  if (sha256(bytes) !== expectedSha256) throw new Error(`${relativePath}: source manifest SHA-256 mismatch`);
  const manifest = JSON.parse(bytes.toString("utf8")) as CaptureSourceManifest;
  if (
    manifest.schema_version !== 1 || manifest.generated_at !== null ||
    manifest.generation_time_policy !== "omitted-for-byte-reproducibility" ||
    manifest.source_revision !== expectedRevision
  ) throw new Error(`${relativePath}: source revision does not match its per-set provenance`);
  return manifest;
}

function assertSimulatorEvidence(
  value: unknown,
  expected: {
    device: DeviceId;
    locale: LocaleId;
    capture_id: CaptureId;
    current: CurrentBinding;
    bundle: CaptureResultBundle;
    recordTestIdentifier: string | undefined;
  },
): asserts value is SimulatorCaptureSourceEvidence {
  const role = expectedCaptureRole(expected.capture_id);
  const expectedTest = expectedCaptureTestIdentifier(expected.locale, expected.capture_id);
  if (expected.bundle.capture_role !== role) throw new Error(`${expected.device}/${expected.capture_id}: wrong result-bundle role`);
  assertCaptureSourceEvidence(value, {
    device: expected.device,
    locale: expected.locale,
    capture_id: expected.capture_id,
    source_commit: expected.current.source_commit,
    build_proof_sha256: (value as SimulatorCaptureSourceEvidence | undefined)?.build_proof_sha256 ?? "",
    source_revision: expected.current.source_revision,
    source_manifest_path: expected.current.source_manifest_path,
    source_manifest_sha256: expected.current.source_manifest_sha256,
    result_bundle: {
      role,
      name: expected.bundle.name,
      xcresult_tree_sha256: expected.bundle.xcresult_tree_sha256,
    },
  });
  const evidence = value as SimulatorCaptureSourceEvidence;
  if (evidence.test_identifier !== expectedTest || expected.recordTestIdentifier !== expectedTest) {
    throw new Error(`${expected.locale}/${expected.device}/${expected.capture_id}: capture test identifier mismatch`);
  }
}

export async function validateCaptures(
  captures: SourceCaptures,
  sets: CaptureSet[],
  requiredCaptureIDs: string[] = CAPTURE_IDS,
): Promise<void> {
  const plan = await loadPlan();
  assertPlan(plan);
  if (JSON.stringify(requiredCaptureIDs) !== JSON.stringify(CAPTURE_IDS)) {
    throw new Error("the screenshot source matrix must bind all six required Garden, Journey, and Journal captures");
  }
  if (captures.schema_version !== 6 || !["candidate-ready", "human-reviewed"].includes(captures.state)) {
    throw new Error("source-captures.json must use schema 6 with four source-bound simulator result bundles");
  }
  const captureKeys = [
    "schema_version", "state", "capture_method", "capture_test", "status_bar_profile", "source_commit", "source_revision",
    "source_revision_kind", "source_manifest_path", "source_manifest_sha256", "result_bundles", "safe_synthetic_data", "sets",
  ];
  if (captures.human_visual_review) captureKeys.push("human_visual_review");
  assertExactKeys(captures, captureKeys, "source-captures.json schema 6");
  if (captures.state === "human-reviewed") {
    const review = captures.human_visual_review;
    if (!review || review.state !== "approved" || !review.reviewer.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(review.reviewed_on) || !review.notes.trim()) {
      throw new Error("human-reviewed source captures require a complete approved visual-review record");
    }
    assertExactKeys(review, ["state", "reviewer", "reviewed_on", "notes"], "human visual review");
  } else if (captures.human_visual_review) {
    throw new Error("candidate-ready source captures must not retain a prior visual-review record");
  }
  if (!captures.safe_synthetic_data) throw new Error("source captures must attest safe synthetic data");
  if (
    !captures.capture_method.toLowerCase().includes("simulator") ||
    !captures.capture_method.includes("XCUITest") ||
    !captures.capture_test.includes("ArriveWithinMarketingCaptureUITests")
  ) throw new Error("simulator capture method/test provenance is incomplete");
  if (captures.status_bar_profile !== MARKETING_STATUS_BAR_DECLARATION) {
    throw new Error("simulator status-bar evidence must declare that system status was captured as rendered without an override");
  }
  if ("physical_capture_evidence_manifest" in captures || "garden_day_captures" in captures) {
    throw new Error("schema 6 marketing captures must use simulator bundles for both iPhone and iPad");
  }
  if (
    typeof captures.source_commit !== "string" || !/^[a-f0-9]{40}$/.test(captures.source_commit) ||
    typeof captures.source_revision !== "string" || !/^[a-f0-9]{64}$/.test(captures.source_revision) ||
    captures.source_revision_kind !== "sha256-capture-source-manifest" ||
    typeof captures.source_manifest_path !== "string" || typeof captures.source_manifest_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(captures.source_manifest_sha256)
  ) throw new Error("current simulator source revision is unbound");

  const currentManifest = await computeCaptureSourceManifest();
  const sourcePaths = new Set(currentManifest.files.map((record) => record.path));
  const current: CurrentBinding = {
    source_commit: captures.source_commit,
    source_revision: currentManifest.source_revision,
    source_manifest_path: captures.source_manifest_path,
    source_manifest_sha256: captures.source_manifest_sha256,
  };
  assertCaptureSourceCommit(path.resolve(ROOT, "../.."), current.source_commit, sourcePaths);
  if (captures.source_revision !== currentManifest.source_revision) {
    throw new Error(`top-level source revision is stale: expected ${currentManifest.source_revision}`);
  }
  const storedManifest = await validateManifestBinding(current.source_manifest_path, current.source_revision, current.source_manifest_sha256);
  if (JSON.stringify(storedManifest) !== JSON.stringify(currentManifest)) {
    throw new Error("current source manifest is not the exact manifest for the app source tree");
  }
  assertSimulatorBundleContract(captures.result_bundles, current);

  const expectedSetKeys = LOCALES.flatMap((locale) => DEVICES.map((device) => `${locale}/${device}`)).sort();
  const actualSetKeys = sets.map((set) => `${set.locale}/${set.device}`).sort();
  if (sets.length !== 4 || JSON.stringify(actualSetKeys) !== JSON.stringify(expectedSetKeys)) {
    throw new Error("source captures must contain exactly the current English/German iPhone and 13-inch iPad sets");
  }
  const publicRoot = await realpath(path.join(ROOT, "public"));
  for (const set of sets) {
    const context = `${set.locale}/${set.device}`;
    assertExactKeys(set, ["locale", "device", "model", "os", "width", "height", "result_bundle", "capture_source", "captures"], `${context} capture set`);
    assertCaptureSetSourceBinding(set, current);
    if (
      set.model !== DEVICE_MODELS[set.device] || set.os !== "iOS 26.5 Simulator" ||
      set.width !== SOURCE_DIMENSIONS[set.device].width || set.height !== SOURCE_DIMENSIONS[set.device].height
    ) throw new Error(`${context}: source screenshot device, OS, or pixel dimensions are invalid`);
    const selected = captures.result_bundles.find((bundle) => bundle.device === set.device && bundle.capture_role === "selected")!;
    const selectedTest = expectedCaptureTestIdentifier(set.locale, "garden-seed");
    if (
      !set.result_bundle || set.result_bundle.name !== selected.name ||
      set.result_bundle.xcresult_tree_sha256 !== selected.xcresult_tree_sha256 ||
      set.result_bundle.test_identifier !== selectedTest ||
      JSON.stringify(set.result_bundle.runtime_warnings) !== JSON.stringify(selected.runtime_warnings_by_test?.[selectedTest])
    ) throw new Error(`${context}: selected-state test/result provenance is incomplete`);
    assertExactKeys(set.result_bundle, ["name", "xcresult_tree_sha256", "test_identifier", "runtime_warnings"], `${context} selected result reference`);
    assertExactKeys(set.capture_source, [
      "state", "source_revision", "source_manifest_path", "source_manifest_sha256", "app_version", "build_number",
      "bound_capture_ids", "missing_capture_ids",
    ], `${context} capture source binding`);

    if (typeof set.captures !== "object" || set.captures === null || Array.isArray(set.captures)) {
      throw new Error(`${context}: capture records must be an object`);
    }
    const captureRecordKeys = Object.keys(set.captures).sort();
    if (JSON.stringify(captureRecordKeys) !== JSON.stringify([...CAPTURE_IDS].sort())) {
      throw new Error(`${context}: exactly six source-bound capture records are required`);
    }
    for (const id of CAPTURE_IDS) {
      const record = set.captures[id];
      assertExactKeys(record, ["path", "sha256", "test_identifier", "source_evidence"], `${context}/${id} capture record`);
      const role = expectedCaptureRole(id);
      const bundle = captures.result_bundles.find((candidate) => candidate.device === set.device && candidate.capture_role === role)!;
      const testIdentifier = expectedCaptureTestIdentifier(set.locale, id);
      if (record.test_identifier !== testIdentifier) throw new Error(`${context}/${id}: capture attachment test identifier mismatch`);
      assertSimulatorEvidence(record.source_evidence, {
        device: set.device,
        locale: set.locale,
        capture_id: id,
        current,
        bundle,
        recordTestIdentifier: record.test_identifier,
      });
      const expectedPath = `public/runtime-ui/${set.locale}/${set.device}/${id}.png`;
      if (record.path !== expectedPath) throw new Error(`${context}/${id}: source image path does not match its exact public runtime path`);
      const absolute = path.resolve(ROOT, record.path);
      const fileStat = await lstat(absolute);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error(`${context}/${id}: source image must be a regular file`);
      const actual = await realpath(absolute);
      if (!(actual === publicRoot || actual.startsWith(`${publicRoot}${path.sep}`))) {
        throw new Error(`${context}/${id}: capture path escapes public/`);
      }
      const validation = await validateOpaqueRgbPng(actual, set.width, set.height);
      if (validation.status !== "pass") throw new Error(`${context}/${id}: ${validation.errors.join("; ")}`);
      if (!/^[a-f0-9]{64}$/.test(record.sha256 ?? "") || sha256(await readFile(actual)) !== record.sha256) {
        throw new Error(`${context}/${id}: source SHA-256 mismatch`);
      }
    }
  }
}

async function main(): Promise<void> {
  const captures = await loadSourceCaptures();
  const plan = await loadPlan();
  const alternatives = await loadNarrativeAlternatives();
  assertNarrativeAlternatives(alternatives);
  const expectedSetKeys = plan.locales.flatMap((locale) => plan.devices.map((device) => `${locale}/${device.id}`)).sort();
  const actualSetKeys = captures.sets.map((set) => `${set.locale}/${set.device}`).sort();
  if (JSON.stringify(actualSetKeys) !== JSON.stringify(expectedSetKeys)) {
    throw new Error("source captures must contain each current locale/device set exactly once");
  }
  await validateCaptures(captures, captures.sets, plan.required_capture_ids);
  process.stdout.write(
    `Source captures passed: ${captures.sets.length} current locale/device sets × ${plan.required_capture_ids.length} source-bound states.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
