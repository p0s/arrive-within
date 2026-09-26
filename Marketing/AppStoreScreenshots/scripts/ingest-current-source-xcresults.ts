#!/usr/bin/env tsx
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

import sharp from "sharp";

import {
  ROOT,
  type CaptureResultBundle,
  type CaptureRole,
  type CaptureSet,
  type CurrentDeviceId,
  type GardenDayCapture,
  type LocaleId,
  type SimulatorProvenance,
  type SourceCaptures,
} from "./contracts";
import { SELECTED_CAPTURE_IDS } from "./capture-set-provenance";
import {
  CAPTURE_IDS,
  expectedCaptureTestIdentifier,
  matchesCaptureProofAttachmentName,
  makeCaptureSourceEvidence,
  parseCaptureBuildProof,
  parseCaptureEvidenceInput,
  type CaptureEvidenceExpectation,
  type CaptureEvidenceInput,
  type CaptureBuildProof,
  type CaptureId,
} from "./capture-evidence";
import { validateOpaqueRgbPng } from "./image-validation";
import { computeCaptureSourceManifest } from "./source-provenance";
import { CAPTURE_STATUS_BAR_PROFILE } from "./physical-capture-provenance";

const PROJECT_ROOT = path.resolve(ROOT, "../..");
const SOURCE_MANIFEST_PATH = "capture-source-manifest-v1.0.2-build-19.json";
const SELECTED_TESTS: Record<LocaleId, string> = {
  "en-US": expectedCaptureTestIdentifier("en-US", "garden-seed"),
  "de-DE": expectedCaptureTestIdentifier("de-DE", "garden-seed"),
};
const DAY_TESTS: Record<LocaleId, string> = {
  "en-US": expectedCaptureTestIdentifier("en-US", "garden-day"),
  "de-DE": expectedCaptureTestIdentifier("de-DE", "garden-day"),
};
const SELECTED_IDS = SELECTED_CAPTURE_IDS.filter((id): id is Exclude<CaptureId, "garden-day"> => id !== "garden-day");
const PHONE = "iphone-6.9" as const;
const PHONE_MODEL_HINT = "iPhone 17 Pro";
const LOCALES: LocaleId[] = ["en-US", "de-DE"];

type BundleInput = { selected: string; "garden-day": string };
type Attachment = {
  deviceName: string;
  exportedFileName: string;
  isAssociatedWithFailure: boolean;
  suggestedHumanReadableName: string;
};
type AttachmentGroup = { attachments: Attachment[]; testIdentifier: string };
type TestNode = {
  children?: TestNode[];
  name: string;
  nodeIdentifier?: string;
  nodeType: string;
  result?: string;
};
type TestResults = {
  devices: Array<{ deviceId: string; deviceName: string; modelName: string; osVersion: string; platform: string }>;
  testNodes: TestNode[];
};
type TestCaseEvidence = { result: string; runtimeWarnings: string[] };
type CaptureBundleResult = {
  device: CurrentDeviceId;
  role: CaptureRole;
  result: string;
  name: string;
  treeSha256: string;
  passedTests: number;
  runtimeWarningsByTest: Record<string, string[]>;
  testIdentifiers: string[];
  simulator: SimulatorProvenance;
  groups: AttachmentGroup[];
  captureProofs: Record<string, { proof: CaptureBuildProof; sha256: string }>;
};
type DeviceResult = {
  resultBundles: CaptureResultBundle[];
  sets: CaptureSet[];
  dayCapture: GardenDayCapture;
};

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function arg(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${flag}`);
  return process.argv[index + 1];
}

function parseInputs(): BundleInput {
  return {
    selected: arg("--iphone-selected-result"),
    "garden-day": arg("--iphone-day-result"),
  };
}

async function loadEvidenceInput(
  filename: string,
  currentSource: { source_revision: string; source_manifest_path: string; source_manifest_sha256: string },
): Promise<CaptureEvidenceInput> {
  const absolute = path.resolve(PROJECT_ROOT, filename);
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("capture evidence JSON must be a regular local file");
  return parseCaptureEvidenceInput(JSON.parse(await readFile(absolute, "utf8")) as unknown, currentSource);
}

function requireSignedCaptureSource(manifestPaths: string[]): string {
  const sourcePaths = new Set(manifestPaths);
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all", "-z"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
  });
  const changedSource = status.split("\0").filter(Boolean).map((entry) => entry.slice(3)).find((filename) => sourcePaths.has(filename));
  if (changedSource) throw new Error(`capture source input is dirty and must be committed before capture: ${changedSource}`);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  const signature = execFileSync("git", ["log", "-1", "--format=%G?", commit], { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit) || signature !== "G") {
    throw new Error("current app capture source must be a validly signed commit");
  }
  return commit;
}

async function assertPoolResult(input: string): Promise<string> {
  const configuredRoot = process.env.ARRIVE_WITHIN_SIMULATOR_RESULTS_ROOT;
  if (!configuredRoot) throw new Error("set ARRIVE_WITHIN_SIMULATOR_RESULTS_ROOT to the local simulator-pool result directory");
  const absolute = path.resolve(PROJECT_ROOT, input);
  const root = await realpath(configuredRoot);
  const result = await realpath(absolute);
  if (!result.startsWith(`${root}${path.sep}`) || !result.endsWith(".xcresult")) {
    throw new Error(`xcresult must be under the approved simulator-pool results root: ${input}`);
  }
  const stat = await lstat(result);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`xcresult is not a regular directory: ${input}`);
  return result;
}

async function hashTree(root: string): Promise<string> {
  const digest = createHash("sha256");
  async function visit(relative: string): Promise<void> {
    for (const child of (await readdir(path.join(root, relative), { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = path.join(relative, child.name);
      if (child.isSymbolicLink()) throw new Error(`xcresult contains a symbolic link: ${childRelative}`);
      if (child.isDirectory()) await visit(childRelative);
      else if (child.isFile()) {
        digest.update(childRelative.split(path.sep).join(path.posix.sep));
        digest.update("\0");
        digest.update(sha256(await readFile(path.join(root, childRelative))));
        digest.update("\n");
      } else throw new Error(`unsupported xcresult entry: ${childRelative}`);
    }
  }
  await visit("");
  return digest.digest("hex");
}

function readTestCases(results: TestResults): Map<string, TestCaseEvidence> {
  const cases = new Map<string, TestCaseEvidence>();
  function visit(node: TestNode): void {
    if (node.nodeType === "Test Case" && node.nodeIdentifier) {
      const warnings = (node.children ?? [])
        .filter((child) => child.nodeType === "Runtime Warning")
        .map((child) => child.name);
      cases.set(node.nodeIdentifier, { result: node.result ?? "", runtimeWarnings: warnings });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  }
  for (const node of results.testNodes) visit(node);
  return cases;
}

async function exportAttachments(result: string): Promise<{ root: string; groups: AttachmentGroup[] }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "arrive-within-current-marketing-"));
  execFileSync("xcrun", ["xcresulttool", "export", "attachments", "--path", result, "--output-path", root], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const groups = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as AttachmentGroup[];
  return { root, groups };
}

async function readBundle(
  input: string,
  device: CurrentDeviceId,
  role: CaptureRole,
  currentSource: { source_commit: string; source_revision: string },
): Promise<CaptureBundleResult> {
  const result = await assertPoolResult(input);
  const testResults = JSON.parse(execFileSync("xcrun", [
    "xcresulttool", "get", "test-results", "tests", "--path", result, "--compact",
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })) as TestResults;
  if (testResults.devices.length !== 1) throw new Error(`${device}/${role}: expected exactly one simulator destination`);
  const simulator = testResults.devices[0];
  if (
    !simulator.modelName.includes(PHONE_MODEL_HINT)
    || simulator.platform !== "iOS Simulator"
    || simulator.osVersion !== "26.5"
    || !/^[A-F0-9-]{36}$/.test(simulator.deviceId)
  ) throw new Error(`${device}/${role}: result metadata does not match the configured simulator route`);

  const expectedTests = Object.values(role === "selected" ? SELECTED_TESTS : DAY_TESTS).sort();
  const testCases = readTestCases(testResults);
  if (JSON.stringify([...testCases.keys()].sort()) !== JSON.stringify(expectedTests)) {
    throw new Error(`${device}/${role}: result must contain exactly the two locale ${role} tests`);
  }
  if ([...testCases.values()].some((test) => test.result !== "Passed")) {
    throw new Error(`${device}/${role}: both capture tests must pass with no skips or failures`);
  }

  const treeSha256 = await hashTree(result);
  const exported = await exportAttachments(result);
  const expectedAttachmentCounts = role === "selected" ? SELECTED_IDS.length : 1;
  const expectedCaptureIDs: CaptureId[] = role === "selected" ? SELECTED_IDS : ["garden-day"];
  const captureProofs: CaptureBundleResult["captureProofs"] = {};
  try {
    if (exported.groups.length !== 2) throw new Error(`${device}/${role}: expected two locale attachment groups`);
    const attachments = exported.groups.flatMap((group) => group.attachments);
    if (attachments.length !== expectedAttachmentCounts * 4 || attachments.some((attachment) => attachment.deviceName !== simulator.deviceName)) {
      throw new Error(`${device}/${role}: attachment device identity or total count is invalid`);
    }
    for (const locale of LOCALES) {
      const identifier = (role === "selected" ? SELECTED_TESTS : DAY_TESTS)[locale];
      const group = exported.groups.find((candidate) => candidate.testIdentifier === identifier);
      if (!group || group.attachments.length !== expectedAttachmentCounts * 2) {
        throw new Error(`${device}/${locale}/${role}: attachment count does not match the test contract`);
      }
      const screenshots = group.attachments.filter((attachment) =>
        attachment.suggestedHumanReadableName.endsWith(".png") || attachment.exportedFileName.endsWith(".png"),
      );
      const proofs = group.attachments.filter((attachment) =>
        attachment.suggestedHumanReadableName.endsWith(".json") || attachment.exportedFileName.endsWith(".json"),
      );
      if (screenshots.length !== expectedAttachmentCounts || proofs.length !== expectedAttachmentCounts) {
        throw new Error(`${device}/${locale}/${role}: each screenshot must have exactly one source-proof attachment`);
      }
      for (const captureID of expectedCaptureIDs) {
        const expectedProofBaseName = `capture-source-proof-${locale}-${captureID}`;
        const matchingProofs = proofs.filter((attachment) =>
          matchesCaptureProofAttachmentName(
            attachment.suggestedHumanReadableName,
            expectedProofBaseName,
          ));
        if (matchingProofs.length !== 1) throw new Error(`${device}/${locale}/${captureID}: exact source-proof attachment is missing`);
        const proofAttachment = matchingProofs[0];
        if (proofAttachment.isAssociatedWithFailure || proofAttachment.deviceName !== simulator.deviceName) {
          throw new Error(`${device}/${locale}/${captureID}: source-proof attachment has invalid device/failure metadata`);
        }
        const proofPath = path.resolve(exported.root, proofAttachment.exportedFileName);
        if (!proofPath.startsWith(`${path.resolve(exported.root)}${path.sep}`)) {
          throw new Error(`${device}/${locale}/${captureID}: source-proof path escapes the export root`);
        }
        const proofStat = await lstat(proofPath);
        if (!proofStat.isFile() || proofStat.isSymbolicLink()) throw new Error(`${device}/${locale}/${captureID}: source-proof attachment is unsafe`);
        const proofReal = await realpath(proofPath);
        const rootReal = await realpath(exported.root);
        if (!proofReal.startsWith(`${rootReal}${path.sep}`)) throw new Error(`${device}/${locale}/${captureID}: source-proof attachment escapes the export root`);
        const proofBytes = await readFile(proofReal);
        const proof = parseCaptureBuildProof(JSON.parse(proofBytes.toString("utf8")) as unknown, {
          capture_id: captureID,
          locale,
          source_commit: currentSource.source_commit,
          source_revision: currentSource.source_revision,
        });
        captureProofs[`${locale}/${captureID}`] = { proof, sha256: sha256(proofBytes) };
      }
    }
    return {
      device,
      role,
      result,
      name: path.basename(result),
      treeSha256,
      passedTests: testCases.size,
      runtimeWarningsByTest: Object.fromEntries([...testCases.entries()].map(([identifier, evidence]) => [identifier, evidence.runtimeWarnings])),
      testIdentifiers: [...testCases.keys()].sort(),
      simulator: {
        device_name: simulator.deviceName,
        model_name: simulator.modelName,
        os_version: simulator.osVersion,
        platform: simulator.platform,
      },
      groups: exported.groups,
      captureProofs,
    };
  } finally {
    await rm(exported.root, { recursive: true });
  }
}

function resultBundleRecord(
  bundle: CaptureBundleResult,
  currentSource: { source_commit: string; source_revision: string; source_manifest_path: string; source_manifest_sha256: string },
): CaptureResultBundle {
  return {
    device: bundle.device,
    capture_role: bundle.role,
    name: bundle.name,
    xcresult_tree_sha256: bundle.treeSha256,
    passed_tests: bundle.passedTests,
    failed_tests: 0,
    skipped_tests: 0,
    source_commit: currentSource.source_commit,
    source_revision: currentSource.source_revision,
    source_manifest_path: currentSource.source_manifest_path,
    source_manifest_sha256: currentSource.source_manifest_sha256,
    test_identifiers: bundle.testIdentifiers,
    runtime_warnings_by_test: bundle.runtimeWarningsByTest,
    simulator: bundle.simulator,
  };
}

async function copyCapture(
  exportedRoot: string,
  group: AttachmentGroup,
  locale: LocaleId,
  id: CaptureId,
  set: CaptureSet,
  bundle: CaptureBundleResult,
  source: { source_commit: string; source_revision: string; source_manifest_path: string; source_manifest_sha256: string },
  time: CaptureEvidenceInput["captures"]["iphone-6.9"][LocaleId][CaptureId],
): Promise<void> {
  const prefix = `marketing-${locale}-${id}_0_`;
  const matches = group.attachments.filter((attachment) =>
    attachment.suggestedHumanReadableName.startsWith(prefix)
    && attachment.suggestedHumanReadableName.endsWith(".png"),
  );
  if (matches.length !== 1) throw new Error(`${set.device}/${locale}/${id}: expected one exact screenshot attachment`);
  const attachment = matches[0];
  if (attachment.isAssociatedWithFailure || attachment.deviceName !== bundle.simulator.device_name) {
    throw new Error(`${set.device}/${locale}/${id}: attachment device or failure provenance is invalid (${attachment.deviceName})`);
  }
  const candidate = path.resolve(exportedRoot, attachment.exportedFileName);
  if (!candidate.startsWith(`${path.resolve(exportedRoot)}${path.sep}`)) throw new Error("attachment path escapes the export root");
  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${set.device}/${locale}/${id}: attachment is not a regular file`);
  const exportedRealRoot = await realpath(exportedRoot);
  const capturePath = await realpath(candidate);
  if (!capturePath.startsWith(`${exportedRealRoot}${path.sep}`)) throw new Error(`${set.device}/${locale}/${id}: attachment escapes temp export root`);
  const metadata = await sharp(capturePath).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`${set.device}/${locale}/${id}: missing PNG dimensions`);
  const validation = await validateOpaqueRgbPng(capturePath, metadata.width, metadata.height);
  if (validation.status !== "pass") throw new Error(`${set.device}/${locale}/${id}: ${validation.errors.join("; ")}`);

  if (set.width === 0 && set.height === 0) {
    set.width = metadata.width;
    set.height = metadata.height;
  } else if (set.width !== metadata.width || set.height !== metadata.height) {
    throw new Error(`${set.device}/${locale}/${id}: screenshot dimensions changed within a set`);
  }
  const relativePath = `public/runtime-ui/${locale}/${set.device}/${id}.png`;
  const destination = path.resolve(ROOT, relativePath);
  const publicRoot = path.resolve(ROOT, "public");
  if (!destination.startsWith(`${publicRoot}${path.sep}`)) throw new Error(`${set.device}/${locale}/${id}: path escapes public/`);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(capturePath, destination);
  const bytes = await readFile(destination);
  const role = id === "garden-day" ? "garden-day" : "selected";
  const buildProof = bundle.captureProofs[`${locale}/${id}`];
  if (!buildProof) throw new Error(`${set.device}/${locale}/${id}: source-proof attachment is missing`);
  const evidenceExpectation: CaptureEvidenceExpectation = {
    device: set.device as CurrentDeviceId,
    locale,
    capture_id: id,
    source_commit: source.source_commit,
    build_proof_sha256: buildProof.sha256,
    source_revision: source.source_revision,
    source_manifest_path: source.source_manifest_path,
    source_manifest_sha256: source.source_manifest_sha256,
    result_bundle: { role, name: bundle.name, xcresult_tree_sha256: bundle.treeSha256 },
  };
  const sourceEvidence = makeCaptureSourceEvidence(evidenceExpectation, time);
  set.captures[id] = {
    path: relativePath,
    sha256: sha256(bytes),
    test_identifier: group.testIdentifier,
    source_evidence: sourceEvidence,
  };
}

async function ingestDevice(
  inputs: BundleInput,
  device: "iphone-6.9",
  evidenceInput: CaptureEvidenceInput,
  currentSource: { source_commit: string; source_revision: string; source_manifest_path: string; source_manifest_sha256: string },
): Promise<DeviceResult> {
  const selected = await readBundle(inputs.selected, device, "selected", currentSource);
  const gardenDay = await readBundle(inputs["garden-day"], device, "garden-day", currentSource);
  if (selected.name === gardenDay.name || selected.treeSha256 === gardenDay.treeSha256) {
    throw new Error(`${device}: selected and Garden-day evidence must be separate exact result bundles`);
  }
  const appConfig = await readFile(path.join(PROJECT_ROOT, "Config/Base.xcconfig"), "utf8");
  if (!/^MARKETING_VERSION\s*=\s*1\.0\.2\s*$/m.test(appConfig) || !/^CURRENT_PROJECT_VERSION\s*=\s*19\s*$/m.test(appConfig)) {
    throw new Error("capture source is not the expected App Store build 1.0.2 (19)");
  }

  const selectedExport = await exportAttachments(selected.result);
  const dayExport = await exportAttachments(gardenDay.result);
  try {
    const sets: CaptureSet[] = [];
    for (const locale of LOCALES) {
      const selectedGroup = selected.groups.find((group) => group.testIdentifier === SELECTED_TESTS[locale]);
      const dayGroup = dayExport.groups.find((group) => group.testIdentifier === DAY_TESTS[locale]);
      if (!selectedGroup || !dayGroup) throw new Error(`${device}/${locale}: exact locale test attachments are missing`);
      const set: CaptureSet = {
        locale,
        device,
        model: selected.simulator.model_name,
        os: `iOS ${selected.simulator.os_version} Simulator`,
        width: 0,
        height: 0,
        result_bundle: {
          name: selected.name,
          xcresult_tree_sha256: selected.treeSha256,
          test_identifier: selectedGroup.testIdentifier,
          runtime_warnings: selected.runtimeWarningsByTest[selectedGroup.testIdentifier],
        },
        capture_source: {
          state: "current",
          source_revision: currentSource.source_revision,
          source_manifest_path: currentSource.source_manifest_path,
          source_manifest_sha256: currentSource.source_manifest_sha256,
          app_version: "1.0.2",
          build_number: "19",
          bound_capture_ids: [...SELECTED_CAPTURE_IDS],
          missing_capture_ids: [],
        },
        captures: {},
      };
      for (const id of SELECTED_IDS) {
        await copyCapture(
          selectedExport.root,
          selectedGroup,
          locale,
          id,
          set,
          selected,
          currentSource,
          evidenceInput.captures[device][locale][id],
        );
      }
      await copyCapture(
        dayExport.root,
        dayGroup,
        locale,
        "garden-day",
        set,
        gardenDay,
        currentSource,
        evidenceInput.captures[device][locale]["garden-day"],
      );
      sets.push(set);
    }

    const englishDayTime = evidenceInput.captures[device]["en-US"]["garden-day"];
    const germanDayTime = evidenceInput.captures[device]["de-DE"]["garden-day"];
    if (englishDayTime.capture_local_date !== germanDayTime.capture_local_date) {
      throw new Error(`${device}: English and German Garden-day captures must share one local capture date`);
    }
    const dayCapture: GardenDayCapture = {
      device,
      source_revision: currentSource.source_revision,
      source_manifest_path: currentSource.source_manifest_path,
      source_manifest_sha256: currentSource.source_manifest_sha256,
      result_bundle: {
        name: gardenDay.name,
        xcresult_tree_sha256: gardenDay.treeSha256,
        passed_tests: gardenDay.passedTests,
        failed_tests: 0,
        skipped_tests: 0,
        runtime_warnings_by_test: gardenDay.runtimeWarningsByTest,
        simulator: gardenDay.simulator,
      },
      test_identifiers: { ...DAY_TESTS },
      clock_mode: "unmodified-simulator-system-clock",
      capture_local_date: englishDayTime.capture_local_date,
      capture_local_times: {
        "en-US": englishDayTime.visible_status_time,
        "de-DE": germanDayTime.visible_status_time,
      },
      visible_status_times: {
        "en-US": englishDayTime.visible_status_time,
        "de-DE": germanDayTime.visible_status_time,
      },
      timezone: "Asia/Singapore",
      phase: "day",
    };
    return {
      resultBundles: [resultBundleRecord(selected, currentSource), resultBundleRecord(gardenDay, currentSource)],
      sets,
      dayCapture,
    };
  } finally {
    await rm(selectedExport.root, { recursive: true });
    await rm(dayExport.root, { recursive: true });
  }
}

async function main(): Promise<void> {
  const inputs = parseInputs();
  const evidenceInputPath = arg("--capture-evidence-json");
  const existingCapturesPath = path.join(ROOT, "source-captures.json");
  const existingStat = await lstat(existingCapturesPath);
  if (!existingStat.isFile() || existingStat.isSymbolicLink()) throw new Error("source-captures.json must be a regular file");
  const existing = JSON.parse(await readFile(existingCapturesPath, "utf8")) as SourceCaptures;
  if (![3, 4].includes(existing.schema_version) || !Array.isArray(existing.sets)) {
    throw new Error("phone capture ingestion requires schema 3 or transitional schema 4 source-captures.json");
  }
  const priorIPadSets = existing.sets.filter((set) => set.device === "ipad-13");
  if (
    priorIPadSets.length !== 2
    || JSON.stringify(priorIPadSets.map((set) => set.locale).sort()) !== JSON.stringify([...LOCALES].sort())
    || priorIPadSets.some((set) => set.capture_source.state !== "stale-incomplete")
  ) throw new Error("phone-only ingestion requires exactly two explicitly stale 13-inch iPad placeholders");

  const currentManifest = await computeCaptureSourceManifest();
  const sourceCommit = requireSignedCaptureSource(currentManifest.files.map((record) => record.path));
  const currentSource = {
    source_commit: sourceCommit,
    source_revision: currentManifest.source_revision,
    source_manifest_path: SOURCE_MANIFEST_PATH,
    source_manifest_sha256: sha256(Buffer.from(`${JSON.stringify(currentManifest, null, 2)}\n`)),
  };
  const evidenceInput = await loadEvidenceInput(evidenceInputPath, currentSource);

  const phone = await ingestDevice(inputs, PHONE, evidenceInput, currentSource);
  const finalManifest = await computeCaptureSourceManifest();
  if (JSON.stringify(finalManifest) !== JSON.stringify(currentManifest)) {
    throw new Error("App source changed during split-bundle ingestion; refusing to bind captures across revisions");
  }
  const currentManifestBytes = Buffer.from(`${JSON.stringify(currentManifest, null, 2)}\n`);

  for (const device of phone.sets) {
    device.captures = Object.fromEntries([...SELECTED_CAPTURE_IDS].map((id) => [id, device.captures[id]]));
  }
  const priorBundles = ((existing.result_bundles ?? []) as unknown as Array<Record<string, unknown>>)
    .filter((bundle) => bundle.device === "iphone-6.9" || bundle.device === "ipad-13") as unknown as CaptureResultBundle[];
  const supersededBundles = new Map<string, CaptureResultBundle>();
  for (const bundle of [...(existing.superseded_result_bundles ?? []), ...priorBundles]) {
    supersededBundles.set(`${bundle.device}\0${bundle.name}\0${bundle.xcresult_tree_sha256}`, bundle);
  }
  const updated: SourceCaptures = {
    ...existing,
    schema_version: 4,
    state: "candidate-ready",
    capture_method: "Guarded XCUITest selected-state and real-clock Garden-day runs on the configured iPhone simulator; the 13-inch iPad placeholders remain explicitly stale until separate signed physical-device fixtures pass.",
    capture_test: "ArriveWithinMarketingCaptureUITests: English/German selected-state captures at dusk/night and English/German Garden-day captures at 08:00–16:59 SGT in distinct iPhone result bundles; iPad evidence is ingested separately from guarded physical-fixture runs.",
    status_bar_profile: CAPTURE_STATUS_BAR_PROFILE,
    source_commit: sourceCommit,
    source_revision: currentManifest.source_revision,
    source_revision_kind: "sha256-capture-source-manifest",
    source_manifest_path: SOURCE_MANIFEST_PATH,
    source_manifest_sha256: currentSource.source_manifest_sha256,
    result_bundles: phone.resultBundles,
    superseded_result_bundles: [...supersededBundles.values()],
    safe_synthetic_data: true,
    garden_day_captures: [phone.dayCapture],
    sets: [...phone.sets, ...priorIPadSets],
    human_visual_review: undefined,
    post_capture_change: undefined,
  };

  await writeFile(path.join(ROOT, SOURCE_MANIFEST_PATH), currentManifestBytes);
  await writeFile(path.join(ROOT, "source-captures.json"), `${JSON.stringify(updated, null, 2)}\n`);
  process.stdout.write(
    `Ingested current iPhone selected/day bundles with signed-build proofs; 13-inch iPad placeholders remain explicitly stale pending physical iPad fixtures at revision ${currentManifest.source_revision}.\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
