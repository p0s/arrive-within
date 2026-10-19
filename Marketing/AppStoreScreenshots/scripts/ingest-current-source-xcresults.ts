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
  type DeviceId,
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
  type CaptureEvidenceExpectation,
  type CaptureBuildProof,
  type CaptureId,
} from "./capture-evidence";
import { validateOpaqueRgbPng } from "./image-validation";
import { computeCaptureSourceManifest } from "./source-provenance";
import { APPROVED_SIMULATOR_RESULTS_ROOT, assertTrustedSimulatorResultsRoot } from "./simulator-result-paths";
import {
  expectedClockFixtureID,
  MARKETING_STATUS_BAR_DECLARATION,
  marketingClockFixture,
} from "./marketing-clock-fixtures";

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
const LOCALES: LocaleId[] = ["en-US", "de-DE"];

type BundleInput = Record<DeviceId, Record<CaptureRole, string>>;
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
  device: DeviceId;
  rawDeviceName: string;
  role: CaptureRole;
  result: string;
  name: string;
  treeSha256: string;
  passedTests: number;
  runtimeWarningsByTest: Record<string, string[]>;
  testIdentifiers: string[];
  simulator: SimulatorProvenance;
  clockFixtureID: "day-v1" | "dusk-v1";
  clockEpoch: string;
  timezone: "Asia/Singapore";
  gardenPhase: "day" | "dusk";
  groups: AttachmentGroup[];
  captureProofs: Record<string, { proof: CaptureBuildProof; sha256: string }>;
};
type DeviceResult = {
  resultBundles: CaptureResultBundle[];
  sets: CaptureSet[];
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
    "iphone-6.9": {
      selected: arg("--iphone-selected-result"),
      "garden-day": arg("--iphone-day-result"),
    },
    "ipad-13": {
      selected: arg("--ipad13-selected-result"),
      "garden-day": arg("--ipad13-day-result"),
    },
  };
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
  const configuredRoot = process.env.ARRIVE_WITHIN_SIMULATOR_RESULTS_ROOT ?? APPROVED_SIMULATOR_RESULTS_ROOT;
  const trustedRoot = await realpath(APPROVED_SIMULATOR_RESULTS_ROOT);
  const root = await realpath(configuredRoot);
  assertTrustedSimulatorResultsRoot(root, trustedRoot);
  const rootStat = await lstat(trustedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("simulator-pool result root is not a regular directory");
  const absolute = path.resolve(PROJECT_ROOT, input);
  const inputStat = await lstat(absolute);
  if (!inputStat.isDirectory() || inputStat.isSymbolicLink()) throw new Error(`xcresult is not a regular directory: ${input}`);
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
  device: DeviceId,
  role: CaptureRole,
  currentSource: { source_commit: string; source_revision: string },
): Promise<CaptureBundleResult> {
  const result = await assertPoolResult(input);
  const testResults = JSON.parse(execFileSync("xcrun", [
    "xcresulttool", "get", "test-results", "tests", "--path", result, "--compact",
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })) as TestResults;
  if (testResults.devices.length !== 1) throw new Error(`${device}/${role}: expected exactly one simulator destination`);
  const simulator = testResults.devices[0];
  const expectedModel = device === "iphone-6.9" ? "iPhone 17 Pro" : "iPad Pro 13-inch (M5)";
  if (
    simulator.modelName !== expectedModel
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
    const fixture = marketingClockFixture(expectedClockFixtureID(role));
    return {
      device,
      rawDeviceName: simulator.deviceName,
      role,
      result,
      name: `${device}-${role}-${treeSha256.slice(0, 16)}.xcresult`,
      treeSha256,
      passedTests: testCases.size,
      runtimeWarningsByTest: Object.fromEntries([...testCases.entries()].map(([identifier, evidence]) => [identifier, evidence.runtimeWarnings])),
      testIdentifiers: [...testCases.keys()].sort(),
      simulator: {
        model_name: simulator.modelName,
        os_version: simulator.osVersion,
        platform: simulator.platform,
      },
      clockFixtureID: fixture.id,
      clockEpoch: String(fixture.epoch),
      timezone: fixture.timezone,
      gardenPhase: fixture.garden_phase,
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
    clock_fixture_id: bundle.clockFixtureID,
    clock_epoch: bundle.clockEpoch,
    timezone: bundle.timezone,
    garden_phase: bundle.gardenPhase,
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
): Promise<void> {
  const prefix = `marketing-${locale}-${id}_0_`;
  const matches = group.attachments.filter((attachment) =>
    attachment.suggestedHumanReadableName.startsWith(prefix)
    && attachment.suggestedHumanReadableName.endsWith(".png"),
  );
  if (matches.length !== 1) throw new Error(`${set.device}/${locale}/${id}: expected one exact screenshot attachment`);
  const attachment = matches[0];
  if (attachment.isAssociatedWithFailure || attachment.deviceName !== bundle.rawDeviceName) {
    throw new Error(`${set.device}/${locale}/${id}: attachment device or failure provenance is invalid`);
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
  const buildProof = bundle.captureProofs[`${locale}/${id}`];
  if (!buildProof) throw new Error(`${set.device}/${locale}/${id}: source-proof attachment is missing`);
  const evidenceExpectation: CaptureEvidenceExpectation = {
    device: set.device as DeviceId,
    locale,
    capture_id: id,
    source_commit: source.source_commit,
    build_proof_sha256: buildProof.sha256,
    source_revision: source.source_revision,
    source_manifest_path: source.source_manifest_path,
    source_manifest_sha256: source.source_manifest_sha256,
    result_bundle: { role: bundle.role, name: bundle.name, xcresult_tree_sha256: bundle.treeSha256 },
  };
  const sourceEvidence = makeCaptureSourceEvidence(evidenceExpectation, buildProof.proof);
  set.captures[id] = {
    path: relativePath,
    sha256: sha256(bytes),
    test_identifier: group.testIdentifier,
    source_evidence: sourceEvidence,
  };
}

async function ingestDevice(
  inputs: BundleInput,
  device: DeviceId,
  currentSource: { source_commit: string; source_revision: string; source_manifest_path: string; source_manifest_sha256: string },
): Promise<DeviceResult> {
  const selected = await readBundle(inputs[device].selected, device, "selected", currentSource);
  const gardenDay = await readBundle(inputs[device]["garden-day"], device, "garden-day", currentSource);
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
      );
      sets.push(set);
    }
    return {
      resultBundles: [resultBundleRecord(selected, currentSource), resultBundleRecord(gardenDay, currentSource)],
      sets,
    };
  } finally {
    await rm(selectedExport.root, { recursive: true });
    await rm(dayExport.root, { recursive: true });
  }
}

async function main(): Promise<void> {
  const inputs = parseInputs();
  const currentManifest = await computeCaptureSourceManifest();
  const sourceCommit = requireSignedCaptureSource(currentManifest.files.map((record) => record.path));
  const currentSource = {
    source_commit: sourceCommit,
    source_revision: currentManifest.source_revision,
    source_manifest_path: SOURCE_MANIFEST_PATH,
    source_manifest_sha256: sha256(Buffer.from(`${JSON.stringify(currentManifest, null, 2)}\n`)),
  };
  const phone = await ingestDevice(inputs, "iphone-6.9", currentSource);
  const ipad = await ingestDevice(inputs, "ipad-13", currentSource);
  const finalManifest = await computeCaptureSourceManifest();
  if (JSON.stringify(finalManifest) !== JSON.stringify(currentManifest)) {
    throw new Error("App source changed during four-bundle ingestion; refusing to bind captures across revisions");
  }
  const currentManifestBytes = Buffer.from(`${JSON.stringify(currentManifest, null, 2)}\n`);
  const updated: SourceCaptures = {
    schema_version: 6,
    state: "candidate-ready",
    capture_method: "Four guarded XCUITest simulator result bundles for iPhone 17 Pro and iPad Pro 13-inch (M5), with source-bound day/dusk app-clock fixtures; simulator system status is captured as rendered.",
    capture_test: "ArriveWithinMarketingCaptureUITests: each selected/dusk and Garden-day/day bundle contains exactly the English and German test; every original screenshot is paired with source/build/clock proof from that same xcresult.",
    status_bar_profile: MARKETING_STATUS_BAR_DECLARATION,
    source_commit: sourceCommit,
    source_revision: currentManifest.source_revision,
    source_revision_kind: "sha256-capture-source-manifest",
    source_manifest_path: SOURCE_MANIFEST_PATH,
    source_manifest_sha256: currentSource.source_manifest_sha256,
    result_bundles: [...phone.resultBundles, ...ipad.resultBundles],
    safe_synthetic_data: true,
    sets: [...phone.sets, ...ipad.sets],
  };

  await writeFile(path.join(ROOT, SOURCE_MANIFEST_PATH), currentManifestBytes);
  await writeFile(path.join(ROOT, "source-captures.json"), `${JSON.stringify(updated, null, 2)}\n`);
  process.stdout.write(
    `Ingested four current simulator bundles for iPhone and 13-inch iPad, bound to signed source and day/dusk fixtures at ${currentManifest.source_revision}.\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
