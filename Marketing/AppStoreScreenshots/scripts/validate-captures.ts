import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
  type CaptureSet,
  type CurrentDeviceId,
  type GardenDayCapture,
  type LocaleId,
  type PhysicalCaptureEvidenceManifest,
  type PhysicalCaptureSourceEvidence,
  type SimulatorCaptureSourceEvidence,
  type SourceCaptures,
} from "./contracts";
import { assertCaptureSetSourceBinding } from "./capture-set-provenance";
import { assertCaptureSourceCommit } from "./capture-source-commit";
import { assertCaptureStatusBarProfile, PHYSICAL_IPAD_PRODUCT_TYPE, assertPhysicalCaptureClock } from "./physical-capture-provenance";
import {
  assertCaptureSourceEvidence,
  expectedCaptureRole,
  expectedCaptureTestIdentifier,
  type CaptureId,
} from "./capture-evidence";
import { validateOpaqueRgbPng } from "./image-validation";
import { computeCaptureSourceManifest, type CaptureSourceManifest } from "./source-provenance";

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

function expectedTestName(locale: LocaleId, kind: "selected" | "garden-day"): string {
  const language = locale === "en-US" ? "English" : "German";
  return kind === "garden-day"
    ? `ArriveWithinMarketingCaptureUITests/testCaptureGardenDay${language}()`
    : `ArriveWithinMarketingCaptureUITests/testCaptureAllRequiredMarketingStates${language}()`;
}

async function validateManifestBinding(
  relativePath: string,
  expectedRevision: string,
  expectedSha256: string,
): Promise<CaptureSourceManifest> {
  const bytes = await readFile(sourceManifestPath(relativePath));
  if (sha256(bytes) !== expectedSha256) throw new Error(`${relativePath}: source manifest SHA-256 mismatch`);
  const manifest = JSON.parse(bytes.toString("utf8")) as CaptureSourceManifest;
  if (
    manifest.schema_version !== 1 ||
    manifest.generated_at !== null ||
    manifest.generation_time_policy !== "omitted-for-byte-reproducibility" ||
    manifest.source_revision !== expectedRevision
  ) {
    throw new Error(`${relativePath}: source revision does not match its per-set provenance`);
  }
  return manifest;
}

function validateGardenDayMetadata(day: GardenDayCapture, currentBinding: {
  source_revision: string;
  source_manifest_path: string;
  source_manifest_sha256: string;
}): void {
  if (
    day.source_revision !== currentBinding.source_revision ||
    day.source_manifest_path !== currentBinding.source_manifest_path ||
    day.source_manifest_sha256 !== currentBinding.source_manifest_sha256 ||
    day.clock_mode !== "unmodified-simulator-system-clock" ||
    day.phase !== "day" ||
    day.timezone !== "Asia/Singapore" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day.capture_local_date) ||
    day.result_bundle.passed_tests !== 2 ||
    day.result_bundle.failed_tests !== 0 ||
    day.result_bundle.skipped_tests !== 0 ||
    !day.result_bundle.name.endsWith(".xcresult") ||
    !/^[a-f0-9]{64}$/.test(day.result_bundle.xcresult_tree_sha256)
  ) {
    throw new Error(`${day.device}/garden-day: result or real-clock provenance is incomplete`);
  }
  const expectedTestIdentifiers = [
    expectedTestName("en-US", "garden-day"),
    expectedTestName("de-DE", "garden-day"),
  ].sort();
  const runtimeWarningsByTest = day.result_bundle.runtime_warnings_by_test;
  const simulator = day.result_bundle.simulator;
  if (
    !runtimeWarningsByTest
    || !simulator
    || JSON.stringify(Object.keys(runtimeWarningsByTest).sort()) !== JSON.stringify(expectedTestIdentifiers)
    || !simulator.model_name.includes(day.device === "iphone-6.9" ? "iPhone 17 Pro" : "iPad Pro 13-inch")
    || simulator.os_version !== "26.5"
    || simulator.platform !== "iOS Simulator"
    || "udid" in simulator
    || expectedTestIdentifiers.some((identifier) => !Array.isArray(runtimeWarningsByTest[identifier]))
    || expectedTestIdentifiers.some((identifier) => !Array.isArray(runtimeWarningsByTest[identifier]) || runtimeWarningsByTest[identifier].length !== 0)
  ) {
    throw new Error(`${day.device}/garden-day: exact passed-test warning and simulator metadata is incomplete`);
  }
  for (const locale of ["en-US", "de-DE"] as LocaleId[]) {
    const captureTime = day.capture_local_times[locale];
    const statusTime = day.visible_status_times[locale];
    const hour = Number(captureTime.slice(0, 2));
    if (
      !/^\d{2}:\d{2}$/.test(captureTime) ||
      statusTime !== captureTime ||
      hour < 8 || hour >= 17 ||
      day.test_identifiers[locale] !== expectedTestName(locale, "garden-day")
    ) {
      throw new Error(`${day.device}/${locale}/garden-day: visible status time or test identity is invalid`);
    }
  }
}

const PHYSICAL_CAPTURE_IDS = [
  "garden-hero", "garden-day", "garden-seed", "journey-calendar", "journey-milestones", "journal",
] as const;
const PHYSICAL_LOCALES: LocaleId[] = ["en-US", "de-DE"];

function physicalCaptureKey(locale: LocaleId, captureID: string): string {
  return locale + "/" + captureID;
}

async function validatePhysicalEvidence(
  captures: SourceCaptures,
  currentBinding: { source_commit: string; source_revision: string; source_manifest_path: string; source_manifest_sha256: string },
): Promise<Map<string, PhysicalCaptureEvidenceManifest["captures"][number]>> {
  const binding = captures.physical_capture_evidence_manifest;
  if (!binding || typeof binding.path !== "string" || !/^[a-f0-9]{64}$/.test(binding.sha256)) {
    throw new Error("current 13-inch iPad captures require a bound physical-evidence manifest");
  }
  const filename = sourceManifestPath(binding.path);
  const manifestStat = await lstat(filename);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("physical-evidence manifest must be a regular file");
  const bytes = await readFile(filename);
  if (sha256(bytes) !== binding.sha256) throw new Error("physical-evidence manifest SHA-256 mismatch");
  const manifest = JSON.parse(bytes.toString("utf8")) as PhysicalCaptureEvidenceManifest;
  if (
    manifest.schema !== "arrive-within-physical-marketing-evidence/v1" ||
    !manifest.source || manifest.source.signature_status !== "G" ||
    !/^[a-f0-9]{40}$/.test(manifest.source.commit) ||
    manifest.source.commit !== currentBinding.source_commit ||
    manifest.source.source_revision !== currentBinding.source_revision ||
    manifest.source.source_manifest_path !== currentBinding.source_manifest_path ||
    manifest.source.source_manifest_sha256 !== currentBinding.source_manifest_sha256 ||
    manifest.device?.family !== "iPad" || manifest.device.route !== "physical-device" ||
    manifest.device.model !== PHYSICAL_IPAD_PRODUCT_TYPE ||
    !/^\d+\.\d+(?:\.\d+)?$/.test(manifest.device.os_version) ||
    !Array.isArray(manifest.captures)
  ) throw new Error("physical-evidence manifest source, signature, or device identity does not match current captures");
  const projectRoot = path.resolve(ROOT, "../..");
  const verifiedSignature = execFileSync("git", ["log", "-1", "--format=%G?", manifest.source.commit], {
    cwd: projectRoot, encoding: "utf8",
  }).trim();
  if (verifiedSignature !== "G") throw new Error("physical-evidence source commit is missing or does not verify as signed");

  const profile = JSON.parse(await readFile(path.join(projectRoot, "docs/qa/verification-profile.json"), "utf8")) as {
    checks?: { physical?: Array<Record<string, unknown>> };
  };
  const projectSpecSha256 = sha256(await readFile(path.join(projectRoot, "project.yml")));
  const profileCases = new Map((profile.checks?.physical ?? []).map((item) => [String(item.id), item]));
  const expectedKeys = PHYSICAL_LOCALES.flatMap((locale) =>
    PHYSICAL_CAPTURE_IDS.map((id) => physicalCaptureKey(locale, id)),
  ).sort();
  const actualKeys = manifest.captures.map((item) => physicalCaptureKey(item.locale, item.capture_id)).sort();
  if (manifest.captures.length !== 12 || JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error("physical evidence must contain exactly one current fixture for each 13-inch iPad capture and locale");
  }
  const indexed = new Map<string, PhysicalCaptureEvidenceManifest["captures"][number]>();
  const generatedProjects = new Set<string>();
  for (const item of manifest.captures) {
    const context = physicalCaptureKey(item.locale, item.capture_id);
    const language = item.locale === "en-US" ? "en" : "de";
    const expectedID = "appstore-ipad13-" + language + "-" + item.capture_id;
    const isDark = item.capture_id === "garden-seed" || item.capture_id === "garden-hero";
    const expectedScenario = isDark ? "SCN-019" : "SCN-020";
    const expectedPhases = isDark ? ["dusk", "night"] : ["day"];
    const timeIsValid = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.visible_status_time);
    const hour = timeIsValid ? Number(item.visible_status_time.slice(0, 2)) : -1;
    const profileCase = profileCases.get(expectedID);
    const expectedArguments = (profileCase?.fixture as { arguments?: unknown[] } | undefined)?.arguments;
    if (
      item.check_id !== expectedID || item.fixture_id !== expectedID || item.scenario_id !== expectedScenario ||
      typeof item.timezone !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.capture_local_date) ||
      !timeIsValid || !expectedPhases.includes(item.garden_phase) ||
      (!isDark && (hour < 8 || hour >= 17)) ||
      item.source_manifest_revision !== currentBinding.source_revision ||
      !profileCase || !Array.isArray(item.fixture_arguments) ||
      JSON.stringify(item.fixture_arguments) !== JSON.stringify(expectedArguments) ||
      item.build_receipt?.source_commit !== manifest.source.commit ||
      item.build_receipt?.bundle_id !== "com.philipps.arrivewithin.ios" ||
      item.build_receipt?.marketing_version !== "1.0.2" || item.build_receipt?.build_number !== "19" ||
      !/^[a-f0-9]{64}$/.test(item.build_receipt?.sha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(item.build_receipt?.executable_sha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(item.build_receipt?.app_tree_sha256 ?? "") ||
      item.build_receipt?.source_provenance?.plist !== "Info.plist" ||
      item.build_receipt?.source_provenance?.key !== "V2N_BUILD_SOURCE_COMMIT" ||
      item.build_receipt?.project_binding?.xcodegen_version !== "2.46.0" ||
      item.build_receipt?.project_binding?.project_spec_sha256 !== projectSpecSha256 ||
      !/^[a-f0-9]{64}$/.test(item.build_receipt?.project_binding?.sha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(item.build_receipt?.project_binding?.project_tree_sha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(item.app_report_sha256) ||
      !/^[a-f0-9]{64}$/.test(item.fixture_manifest_sha256) ||
      item.screenshot_path !== "public/runtime-ui/" + item.locale + "/ipad-13/" + item.capture_id + ".png" ||
      !/^[a-f0-9]{64}$/.test(item.screenshot_sha256)
    ) throw new Error(context + ": physical fixture, source, receipt, report, phase, or PNG evidence is incomplete");

    generatedProjects.add([
      item.build_receipt.project_binding.xcodegen_version,
      item.build_receipt.project_binding.project_spec_sha256,
      item.build_receipt.project_binding.project_tree_sha256,
    ].join(":"));

    const args = item.fixture_arguments;
    const argValue = (flag: string) => {
      const index = args.indexOf(flag);
      return index >= 0 ? args[index + 1] : undefined;
    };
    const appearance = isDark ? "dark" : "light";
    const readySurface = item.capture_id.startsWith("garden-") ? "garden"
      : item.capture_id === "journey-calendar" ? "journey"
        : item.capture_id === "journey-milestones" ? "journey-milestones" : "journal-editor";
    const needsRenderer = readySurface === "garden";
    const report = item.app_report;
    if (
      !report || report.schemaVersion !== 1 || report.captureID !== item.capture_id ||
      report.locale !== item.locale || report.appearance !== appearance || item.appearance !== appearance ||
      report.namespace !== argValue("-ui-test-namespace") || report.readySurface !== readySurface ||
      report.rendererReady !== needsRenderer || report.journalEditorPrefilled !== (item.capture_id === "journal") ||
      report.bundleIdentifier !== item.build_receipt.bundle_id ||
      report.marketingVersion !== item.build_receipt.marketing_version ||
      report.buildNumber !== item.build_receipt.build_number ||
      report.sourceCommit !== manifest.source.commit ||
      report.sourceManifestRevision !== currentBinding.source_revision ||
      report.captureLocalDate !== item.capture_local_date ||
      report.visibleStatusTime !== item.visible_status_time ||
      report.timezone !== item.timezone || report.gardenPhase !== item.garden_phase
    ) throw new Error(context + ": app report does not match the profile fixture or signed build evidence");
    assertPhysicalCaptureClock(report);
    indexed.set(physicalCaptureKey(item.locale, item.capture_id), item);
  }
  if (generatedProjects.size !== 1) throw new Error("physical captures do not share one generated-project source binding");
  return indexed;
}

function assertPhysicalCaptureSourceEvidence(
  value: unknown,
  proof: PhysicalCaptureEvidenceManifest["captures"][number],
  evidenceBinding: { path: string; sha256: string },
  currentBinding: { source_revision: string; source_manifest_path: string; source_manifest_sha256: string },
  physicalDevice: PhysicalCaptureEvidenceManifest["device"],
): asserts value is PhysicalCaptureSourceEvidence {
  if (!value || typeof value !== "object") throw new Error(proof.locale + "/" + proof.capture_id + ": physical source evidence is missing");
  const source = value as PhysicalCaptureSourceEvidence;
  if (
    source.method !== "guarded-physical-fixture" || source.evidence_manifest_path !== evidenceBinding.path ||
    source.evidence_manifest_sha256 !== evidenceBinding.sha256 || source.fixture_id !== proof.fixture_id ||
    source.capture_id !== proof.capture_id || source.source_revision !== currentBinding.source_revision ||
    source.source_manifest_path !== currentBinding.source_manifest_path ||
    source.source_manifest_sha256 !== currentBinding.source_manifest_sha256 ||
    source.source_commit !== proof.build_receipt.source_commit || source.build_receipt_sha256 !== proof.build_receipt.sha256 ||
    source.project_binding_sha256 !== proof.build_receipt.project_binding.sha256 ||
    source.app_report_sha256 !== proof.app_report_sha256 || source.physical_device_model !== physicalDevice.model ||
    source.device_os_version !== physicalDevice.os_version || source.capture_local_date !== proof.capture_local_date ||
    source.visible_status_time !== proof.visible_status_time || source.timezone !== proof.timezone ||
    source.garden_phase !== proof.garden_phase || source.appearance !== proof.appearance
  ) throw new Error(proof.locale + "/" + proof.capture_id + ": stored physical evidence does not match the evidence manifest");
}

export async function validateCaptures(
  captures: SourceCaptures,
  sets: CaptureSet[],
  requiredCaptureIDs?: string[],
): Promise<void> {
  const plan = await loadPlan();
  assertPlan(plan);
  const expectedIDs = requiredCaptureIDs ?? plan.required_capture_ids;

  if (captures.schema_version !== 5 || !["candidate-ready", "human-reviewed"].includes(captures.state)) {
    throw new Error("source-captures.json must use schema 5 with current phone xcresult and physical 13-inch iPad evidence");
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
  assertCaptureStatusBarProfile(captures.status_bar_profile);
  if (
    !captures.source_commit || !/^[a-f0-9]{40}$/.test(captures.source_commit) ||
    !captures.source_revision ||
    captures.source_revision_kind !== "sha256-capture-source-manifest" ||
    !captures.source_manifest_path ||
    !captures.source_manifest_sha256
  ) {
    throw new Error("current phone/physical iPad source revision is unbound");
  }

  const currentManifest = await computeCaptureSourceManifest();
  const sourcePaths = new Set(currentManifest.files.map((record) => record.path));
  const sourceCommit = captures.source_commit;
  assertCaptureSourceCommit(path.resolve(ROOT, "../.."), sourceCommit, sourcePaths);
  const currentBinding = {
    source_commit: sourceCommit,
    source_revision: currentManifest.source_revision,
    source_manifest_path: captures.source_manifest_path,
    source_manifest_sha256: captures.source_manifest_sha256,
  };
  if (captures.source_revision !== currentManifest.source_revision) {
    throw new Error(`top-level source revision is stale: expected ${currentManifest.source_revision}`);
  }
  const currentStoredManifest = await validateManifestBinding(
    captures.source_manifest_path,
    currentManifest.source_revision,
    captures.source_manifest_sha256,
  );
  if (JSON.stringify(currentStoredManifest) !== JSON.stringify(currentManifest)) {
    throw new Error("current source manifest is not the exact manifest for the app source tree");
  }

  if (captures.result_bundles.length !== 2) {
    throw new Error("simulator result provenance must contain only selected/day iPhone bundles; iPad evidence is physical");
  }
  const currentDevices: CurrentDeviceId[] = ["iphone-6.9"];
  const expectedRoles = ["selected", "garden-day"] as const;
  const currentBundles = captures.result_bundles;
  const expectedCurrentBundleKeys = currentDevices.flatMap((device) => expectedRoles.map((role) => `${device}/${role}`)).sort();
  const actualCurrentBundleKeys = currentBundles.map((bundle) => `${bundle.device}/${bundle.capture_role}`).sort();
  if (JSON.stringify(actualCurrentBundleKeys) !== JSON.stringify(expectedCurrentBundleKeys)) {
    throw new Error("the current iPhone must have exactly one selected-state and one Garden-day result bundle");
  }
  function bundleFor(device: CurrentDeviceId, role: "selected" | "garden-day") {
    const found = currentBundles.find((bundle) => bundle.device === device && bundle.capture_role === role);
    if (!found) throw new Error(`${device}/${role}: result bundle provenance is missing`);
    return found;
  }
  for (const device of currentDevices) {
    for (const role of expectedRoles) {
      const bundle = bundleFor(device, role);
      const expectedTests = (role === "selected"
        ? [expectedTestName("en-US", "selected"), expectedTestName("de-DE", "selected")]
        : [expectedTestName("en-US", "garden-day"), expectedTestName("de-DE", "garden-day")]).sort();
      if (
        !bundle.name.endsWith(".xcresult") ||
        !/^[a-f0-9]{64}$/.test(bundle.xcresult_tree_sha256) ||
        bundle.passed_tests !== 2 || bundle.failed_tests !== 0 || bundle.skipped_tests !== 0 ||
        bundle.source_revision !== currentManifest.source_revision ||
        bundle.source_commit !== sourceCommit ||
        bundle.source_manifest_path !== captures.source_manifest_path ||
        bundle.source_manifest_sha256 !== captures.source_manifest_sha256 ||
        JSON.stringify(bundle.test_identifiers) !== JSON.stringify(expectedTests) ||
        !bundle.runtime_warnings_by_test ||
        JSON.stringify(Object.keys(bundle.runtime_warnings_by_test).sort()) !== JSON.stringify(expectedTests) ||
        expectedTests.some((identifier) => !Array.isArray(bundle.runtime_warnings_by_test![identifier]) || bundle.runtime_warnings_by_test![identifier].some((warning) => typeof warning !== "string")) ||
        !bundle.simulator ||
        !bundle.simulator.model_name.includes("iPhone 17 Pro") ||
        bundle.simulator.os_version !== "26.5" ||
        bundle.simulator.platform !== "iOS Simulator" ||
        "udid" in bundle.simulator
      ) throw new Error(`${device}/${role}: exact source, test, simulator, and result-bundle provenance is incomplete`);
    }
    const selected = bundleFor(device, "selected");
    const day = bundleFor(device, "garden-day");
    if (selected.name === day.name || selected.xcresult_tree_sha256 === day.xcresult_tree_sha256) {
      throw new Error(`${device}: selected and Garden-day captures must have separate exact result bundles`);
    }
  }

  const physicalEvidence = await validatePhysicalEvidence(captures, currentBinding);
  const physicalBinding = captures.physical_capture_evidence_manifest!;
  const physicalManifest = JSON.parse(await readFile(sourceManifestPath(physicalBinding.path), "utf8")) as PhysicalCaptureEvidenceManifest;
  const currentDeviceIds: CurrentDeviceId[] = ["iphone-6.9"];
  const staleDeviceIds = captures.sets.filter((set) => set.capture_source.state !== "current").map((set) => set.device);
  if (staleDeviceIds.length !== 0) {
    throw new Error("every output device must have current source-bound screenshot captures");
  }

  const dayCaptures = captures.garden_day_captures ?? [];
  const expectedDayDevices = currentDeviceIds.sort();
  if (JSON.stringify(dayCaptures.map((day) => day.device).sort()) !== JSON.stringify(expectedDayDevices)) {
    throw new Error("real-clock Garden-day evidence must exist for the current iPhone set");
  }
  for (const day of dayCaptures) validateGardenDayMetadata(day, currentBinding);
  for (const day of dayCaptures) {
    const bundle = bundleFor(day.device, "garden-day");
    if (
      day.result_bundle.name !== bundle.name ||
      day.result_bundle.xcresult_tree_sha256 !== bundle.xcresult_tree_sha256 ||
      day.result_bundle.passed_tests !== bundle.passed_tests ||
      JSON.stringify(day.result_bundle.runtime_warnings_by_test) !== JSON.stringify(bundle.runtime_warnings_by_test) ||
      JSON.stringify(day.result_bundle.simulator) !== JSON.stringify(bundle.simulator)
    ) throw new Error(`${day.device}/garden-day: day-specific result bundle provenance mismatch`);
  }

  const publicRoot = await realpath(path.join(ROOT, "public"));
  for (const set of sets) {
    assertCaptureSetSourceBinding(set, currentBinding);
    const setManifest = await validateManifestBinding(
      set.capture_source.source_manifest_path,
      set.capture_source.source_revision,
      set.capture_source.source_manifest_sha256,
    );
    if (
      set.capture_source.state === "current" &&
      JSON.stringify(setManifest) !== JSON.stringify(currentManifest)
    ) {
      throw new Error(`${set.locale}/${set.device}: current capture manifest differs from the current app source tree`);
    }
    if (set.capture_source.state === "stale-incomplete" && !set.capture_source.missing_capture_ids.every((id) => expectedIDs.includes(id))) {
      throw new Error(`${set.locale}/${set.device}: stale set discloses an unrelated missing capture`);
    }
    let expectedSelectedTest: string | null = null;
    if (set.device === "iphone-6.9") {
      const resultBundle = bundleFor("iphone-6.9", "selected");
      expectedSelectedTest = expectedTestName(set.locale, "selected");
      if (
        !set.result_bundle || !set.result_bundle.name.endsWith(".xcresult") ||
        !/^[a-f0-9]{64}$/.test(set.result_bundle.xcresult_tree_sha256) ||
        set.result_bundle.test_identifier !== expectedSelectedTest || set.result_bundle.name !== resultBundle.name ||
        set.result_bundle.xcresult_tree_sha256 !== resultBundle.xcresult_tree_sha256
      ) throw new Error(set.locale + "/" + set.device + ": selected-state test/result provenance is incomplete");
      if (JSON.stringify(set.result_bundle.runtime_warnings) !== JSON.stringify(resultBundle.runtime_warnings_by_test?.[expectedSelectedTest])) {
        throw new Error(set.locale + "/" + set.device + ": selected-state runtime-warning provenance mismatch");
      }
    } else if (set.result_bundle !== null) {
      throw new Error(set.locale + "/" + set.device + ": physical capture set must not be represented as an xcresult");
    }
    const setExpectedIDs = expectedIDs.filter((id) => !set.capture_source.missing_capture_ids.includes(id));
    const absentBoundIDs = setExpectedIDs.filter((id) => !set.capture_source.bound_capture_ids.includes(id));
    if (absentBoundIDs.length || setExpectedIDs.some((id) => !set.captures[id])) {
      throw new Error(`${set.locale}/${set.device}: selected capture IDs are missing or not source-bound`);
    }
    if (set.capture_source.missing_capture_ids.some((id) => set.captures[id])) {
      throw new Error(`${set.locale}/${set.device}: a stale source cannot include its declared missing capture`);
    }

    for (const rawID of setExpectedIDs) {
      const id = rawID as CaptureId;
      const record = set.captures[id];
      const expectedIdentifier = expectedCaptureTestIdentifier(set.locale, id);
      if (set.device === "iphone-6.9" && record.test_identifier !== expectedIdentifier) {
        throw new Error(set.locale + "/" + set.device + "/" + id + ": capture attachment test identifier mismatch");
      }
      if (set.capture_source.state === "current") {
        if (set.device === "iphone-6.9") {
          const role = expectedCaptureRole(id);
          const sourceBundle = bundleFor("iphone-6.9", role);
          const simulatorEvidence = record.source_evidence as SimulatorCaptureSourceEvidence | undefined;
          assertCaptureSourceEvidence(simulatorEvidence, {
            device: "iphone-6.9",
            locale: set.locale,
            capture_id: id,
            source_commit: sourceCommit,
            build_proof_sha256: simulatorEvidence?.build_proof_sha256 ?? "",
            source_revision: currentBinding.source_revision,
            source_manifest_path: currentBinding.source_manifest_path,
            source_manifest_sha256: currentBinding.source_manifest_sha256,
            result_bundle: {
              role,
              name: sourceBundle.name,
              xcresult_tree_sha256: sourceBundle.xcresult_tree_sha256,
            },
          });
          if (simulatorEvidence!.test_identifier !== record.test_identifier) {
            throw new Error(set.locale + "/" + set.device + "/" + id + ": embedded and record test identifiers disagree");
          }
          const expectedWarnings = sourceBundle.runtime_warnings_by_test?.[expectedIdentifier];
          if (!expectedWarnings) throw new Error(set.device + "/" + role + ": runtime warnings for " + expectedIdentifier + " are missing");
          if (id === "garden-day") {
            const day = dayCaptures.find((candidate) => candidate.device === set.device);
            if (
              !day ||
              day.capture_local_date !== simulatorEvidence!.capture_local_date ||
              day.visible_status_times[set.locale] !== simulatorEvidence!.visible_status_time ||
              day.test_identifiers[set.locale] !== simulatorEvidence!.test_identifier
            ) throw new Error(set.locale + "/" + set.device + "/garden-day: per-capture time does not match its day result");
          }
        } else {
          const proof = physicalEvidence.get(physicalCaptureKey(set.locale, id));
          if (!proof) throw new Error(set.locale + "/" + set.device + "/" + id + ": physical manifest proof is missing");
          assertPhysicalCaptureSourceEvidence(record.source_evidence, proof, physicalBinding, currentBinding, physicalManifest.device);
          if (record.path !== proof.screenshot_path || record.sha256 !== proof.screenshot_sha256) {
            throw new Error(set.locale + "/" + set.device + "/" + id + ": physical PNG record does not match its runner evidence");
          }
        }
      }
      const absolute = path.resolve(ROOT, record.path);
      const actual = await realpath(absolute).catch(() => absolute);
      if (!(actual === publicRoot || actual.startsWith(`${publicRoot}${path.sep}`))) {
        throw new Error(`${set.locale}/${set.device}/${id}: capture path escapes public/`);
      }
      const validation = await validateOpaqueRgbPng(absolute, set.width, set.height);
      if (validation.status !== "pass") {
        throw new Error(`${set.locale}/${set.device}/${id}: ${validation.errors.join("; ")}`);
      }
      if (!/^[a-f0-9]{64}$/.test(record.sha256 ?? "")) {
        throw new Error(`${set.locale}/${set.device}/${id}: missing source SHA-256`);
      }
      if (sha256(await readFile(absolute)) !== record.sha256) {
        throw new Error(`${set.locale}/${set.device}/${id}: source SHA-256 mismatch`);
      }
    }
  }
}

async function main(): Promise<void> {
  const captures = await loadSourceCaptures();
  const plan = await loadPlan();
  const alternatives = await loadNarrativeAlternatives();
  assertNarrativeAlternatives(alternatives);
  const expectedSetKeys = plan.locales.flatMap((locale) =>
    plan.devices.map((device) => `${locale}/${device.id}`),
  ).sort();
  const actualSetKeys = captures.sets.map((set) => `${set.locale}/${set.device}`).sort();
  if (JSON.stringify(actualSetKeys) !== JSON.stringify(expectedSetKeys)) {
    throw new Error("source captures must contain each current locale/device set exactly once");
  }
  await validateCaptures(captures, captures.sets, plan.required_capture_ids);
  const currentSetCount = captures.sets.filter((set) => set.capture_source.state === "current").length;
  process.stdout.write(
    `Source captures passed: ${currentSetCount} current locale/device sets × ${plan.required_capture_ids.length} source-bound states.\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
