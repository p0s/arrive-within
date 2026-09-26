#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import {
  ROOT,
  type CaptureSet,
  type CurrentDeviceId,
  type LocaleId,
  type PhysicalCaptureEvidenceManifest,
  type PhysicalCaptureSourceEvidence,
  type SourceCaptures,
} from "./contracts";
import { SELECTED_CAPTURE_IDS } from "./capture-set-provenance";
import { CAPTURE_IDS, gardenPhaseAt, type CaptureId } from "./capture-evidence";
import { computeCaptureSourceManifest } from "./source-provenance";
import { CAPTURE_STATUS_BAR_PROFILE } from "./physical-capture-provenance";
import { resolveProjectRegularFile } from "./physical-profile-paths";
import { validateOpaqueRgbPng } from "./image-validation";
import {
  parseBuildAdapterBindingSummary,
  validateProjectBindingRecord,
  type GeneratedProjectBinding,
} from "./physical-build-provenance";
import { resolvePrivateArtifactPath } from "./private-artifact-paths";

const PROJECT_ROOT = path.resolve(ROOT, "../..");
const SOURCE_MANIFEST_PATH = "capture-source-manifest-v1.0.2-build-19.json";
const DEVICE = "ipad-13" as const;
const LOCALES: LocaleId[] = ["en-US", "de-DE"];
const DAY_IDS: CaptureId[] = ["garden-day", "journey-calendar", "journey-milestones", "journal"];
const NIGHT_IDS: CaptureId[] = ["garden-seed", "garden-hero"];
const sha256 = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

type JsonObject = Record<string, any>;

function arg(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${flag}`);
  return process.argv[index + 1];
}

async function plainJson(filename: string, context: string): Promise<JsonObject> {
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${context} must be a regular file`);
  const value = JSON.parse(await readFile(filename, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context} must be a JSON object`);
  return value as JsonObject;
}

async function privateArtifactPath(value: unknown, context: string): Promise<string> {
  return resolvePrivateArtifactPath(value, context);
}

function requireObject(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context} must be an object`);
  return value as JsonObject;
}

function requireSha(value: unknown, context: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${context} is not a SHA-256`);
  return value;
}

function profileCase(profile: JsonObject, checkID: string): JsonObject {
  const check = (profile.checks?.physical ?? []).find((item: JsonObject) => item.id === checkID);
  if (!check) throw new Error(`${checkID}: current verification profile case is missing`);
  return check;
}

function currentGeneratedProjectBinding(): GeneratedProjectBinding {
  const output = execFileSync("python3", [
    path.join(PROJECT_ROOT, "scripts/verify_marketing_capture_project.py"), "--json",
  ], { cwd: PROJECT_ROOT, encoding: "utf8" });
  const value = JSON.parse(output) as JsonObject;
  if (
    value.xcodegen_version !== "2.46.0" ||
    typeof value.project_spec_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.project_spec_sha256) ||
    typeof value.project_tree_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.project_tree_sha256)
  ) throw new Error("current generated-project validator returned an invalid binding");
  return {
    xcodegen_version: value.xcodegen_version,
    project_spec_sha256: value.project_spec_sha256,
    project_tree_sha256: value.project_tree_sha256,
  };
}

async function validateProjectBinding(
  check: JsonObject,
  receiptPath: string,
  receiptSummary: JsonObject,
  verifySource: JsonObject,
  currentSource: { source_revision: string; source_manifest_path: string; source_manifest_sha256: string },
  currentProject: GeneratedProjectBinding,
): Promise<PhysicalCaptureEvidenceManifest["captures"][number]["build_receipt"]["project_binding"]> {
  const buildStep = (check.steps ?? []).find((step: JsonObject) => step.operation === "build-adapter");
  if (typeof buildStep?.output !== "string") throw new Error(`${check.id}: build adapter did not emit project-binding evidence`);
  let summary: ReturnType<typeof parseBuildAdapterBindingSummary>;
  try {
    summary = parseBuildAdapterBindingSummary(buildStep.output, String(receiptSummary.sha256));
  } catch (error) {
    throw new Error(`${check.id}: build adapter output is not a project-binding record: ${String(error)}`);
  }
  const bindingPath = await privateArtifactPath(summary.binding_path, `${check.id} project binding`);
  const expectedPath = path.join(path.dirname(receiptPath), "capture-project-binding.json");
  if (
    bindingPath !== expectedPath
  ) throw new Error(`${check.id}: build adapter project-binding summary is invalid`);
  const bindingBytes = await readFile(bindingPath);
  const bindingSha256 = sha256(bindingBytes);
  if (bindingSha256 !== summary.binding_sha256) throw new Error(`${check.id}: project-binding sidecar hash mismatch`);
  const binding = JSON.parse(bindingBytes.toString("utf8")) as JsonObject;
  return validateProjectBindingRecord(binding, bindingSha256, String(receiptSummary.sha256), {
    source_commit: String(verifySource.commit),
    source_revision: currentSource.source_revision,
    source_manifest_path: currentSource.source_manifest_path,
    source_manifest_sha256: currentSource.source_manifest_sha256,
  }, currentProject);
}

function languageLocale(language: string): LocaleId {
  if (language === "en") return "en-US";
  if (language === "de") return "de-DE";
  throw new Error(`unsupported physical capture language: ${language}`);
}

function argumentAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function validatedRunnerCheck(
  check: JsonObject,
  verifySource: JsonObject,
  expectedScenario: string,
  currentSource: { source_revision: string; source_manifest_path: string; source_manifest_sha256: string },
  profile: JsonObject,
  currentProject: GeneratedProjectBinding,
): Promise<PhysicalCaptureEvidenceManifest["captures"][number]> {
  if (
    check.status !== "passed" || check.lane !== "physical" || check.required !== true ||
    check.scenario_id !== expectedScenario || check.source_binding?.source_bound !== true ||
    check.source_binding?.commit !== verifySource.commit
  ) throw new Error(`${check.id}: guarded physical verification did not pass with source binding`);
  const configured = profileCase(profile, check.id);
  const fixtureArgs = configured.fixture?.arguments;
  if (!Array.isArray(fixtureArgs) || !fixtureArgs.every((value: unknown) => typeof value === "string")) {
    throw new Error(`${check.id}: profile fixture arguments are invalid`);
  }
  const captureID = argumentAfter(fixtureArgs, "-ui-test-marketing-capture") as CaptureId | undefined;
  const language = argumentAfter(fixtureArgs, "-ui-test-language");
  const namespace = argumentAfter(fixtureArgs, "-ui-test-namespace");
  const locale = languageLocale(language ?? "");
  const shouldBeDay = DAY_IDS.includes(captureID as CaptureId);
  if (
    !captureID || !CAPTURE_IDS.includes(captureID) || !namespace ||
    configured.scenario_id !== expectedScenario || configured.fixture_id !== check.id ||
    check.id !== `appstore-ipad13-${language}-${captureID}` ||
    shouldBeDay !== (expectedScenario === "SCN-020")
  ) throw new Error(`${check.id}: profile fixture does not match the day/night capture contract`);

  const device = requireObject(check.device, `${check.id}.device`);
  if (device.family !== "iPad" || typeof device.model !== "string" || !device.model.includes("iPad Pro 13-inch") || typeof device.os_version !== "string") {
    throw new Error(`${check.id}: result is not from the configured physical 13-inch iPad`);
  }
  const receiptSummary = requireObject(check.receipt, `${check.id}.receipt`);
  const receiptPath = await privateArtifactPath(check.artifacts?.receipt, `${check.id} build receipt`);
  if (receiptSummary.path !== receiptPath || sha256(await readFile(receiptPath)) !== receiptSummary.sha256) {
    throw new Error(`${check.id}: runner output does not bind the build receipt bytes`);
  }
  const receipt = await plainJson(receiptPath, `${check.id} build receipt`);
  const projectBinding = await validateProjectBinding(check, receiptPath, receiptSummary, verifySource, currentSource, currentProject);
  if (
    receipt.schema_version !== 1 || receipt.source_dirty !== false || receipt.source_commit !== verifySource.commit ||
    receipt.bundle_id !== "com.philipps.arrivewithin.ios" || receipt.marketing_version !== "1.0.2" ||
    receipt.build_number !== "19" || receipt.executable_sha256 !== receiptSummary.executable_sha256 ||
    !/^[a-f0-9]{64}$/.test(String(receiptSummary.tree_sha256)) ||
    Object.keys(receipt.source_provenance ?? {}).sort().join(",") !== "key,plist" ||
    receipt.source_provenance?.plist !== "Info.plist" || receipt.source_provenance?.key !== "V2N_BUILD_SOURCE_COMMIT"
  ) throw new Error(`${check.id}: signed build receipt is not bound to the current 1.0.2 (19) source`);

  const artifactManifestPath = await privateArtifactPath(check.artifacts?.manifest, `${check.id} fixture manifest`);
  const artifactManifest = await plainJson(artifactManifestPath, `${check.id} fixture manifest`);
  if (
    artifactManifest.schema !== "physical-fixture-manifest/v1" ||
    artifactManifest.fixture_id !== check.id || artifactManifest.source?.commit !== verifySource.commit ||
    JSON.stringify(artifactManifest.fixture?.arguments) !== JSON.stringify(fixtureArgs) ||
    artifactManifest.build?.tree_sha256 !== receiptSummary.tree_sha256 ||
    artifactManifest.build?.build_receipt?.sha256 !== receiptSummary.sha256 ||
    JSON.stringify(artifactManifest.screenshots) !== JSON.stringify(check.artifacts?.screenshots)
  ) throw new Error(`${check.id}: runner fixture manifest, receipt, and screenshot paths disagree`);

  const reportRecord = (check.reports ?? []).find((report: JsonObject) => report.validator?.status === "passed");
  if (!reportRecord) throw new Error(`${check.id}: no fresh app report passed the profile-bound validator`);
  const reportPath = await privateArtifactPath(reportRecord.report, `${check.id} app report`);
  const reportBytes = await readFile(reportPath);
  if (sha256(reportBytes) !== reportRecord.report_sha256) throw new Error(`${check.id}: app report hash mismatch`);
  const appReport = JSON.parse(reportBytes.toString("utf8")) as JsonObject;
  const sourceManifestRevision = appReport.sourceManifestRevision;
  if (
    appReport.sourceCommit !== verifySource.commit ||
    sourceManifestRevision !== currentSource.source_revision ||
    appReport.namespace !== namespace || appReport.captureID !== captureID || appReport.locale !== locale
  ) throw new Error(`${check.id}: app report does not match the signed source, fixture, and current manifest`);
  const startedAfter = check.report_freshness?.started_after;
  const validatorPath = await resolveProjectRegularFile(PROJECT_ROOT, configured.report.validator);
  const validator = execFileSync("python3", [
    validatorPath,
    "--report", reportPath,
    "--bundle-id", receipt.bundle_id,
    "--marketing-version", receipt.marketing_version,
    "--build-number", receipt.build_number,
    "--source-commit", receipt.source_commit,
    "--device-family", String(device.family),
    "--device-model", String(device.model),
    "--os-version", String(device.os_version),
    "--started-after", String(startedAfter),
  ], { encoding: "utf8" });
  const validatorResult = JSON.parse(validator) as JsonObject;
  if (validatorResult.status !== "passed") throw new Error(`${check.id}: app report failed its fixture validator`);

  const screenshots = check.artifacts?.screenshots;
  if (!Array.isArray(screenshots) || screenshots.length !== 1) throw new Error(`${check.id}: expected exactly one physical iPad screenshot`);
  const screenshotPath = await privateArtifactPath(screenshots[0], `${check.id} physical screenshot`);
  const screenshotBytes = await readFile(screenshotPath);
  const screenshotSha256 = sha256(screenshotBytes);
  const screenStep = (check.steps ?? []).find((step: JsonObject) => step.operation === "native-screenshot-1");
  if (!screenStep || screenStep.sha256 !== screenshotSha256 || screenStep.path !== screenshotPath) {
    throw new Error(`${check.id}: captured PNG does not match the guarded runner screenshot hash`);
  }
  const metadata = await sharp(screenshotBytes).metadata();
  if (metadata.width !== 2064 || metadata.height !== 2752) throw new Error(`${check.id}: physical screenshot dimensions are not 2064x2752`);
  const validation = await validateOpaqueRgbPng(screenshotPath, 2064, 2752);
  if (validation.status !== "pass") throw new Error(`${check.id}: ${validation.errors.join("; ")}`);

  const visibleStatusTime = String(appReport.visibleStatusTime);
  const captureIDList = CAPTURE_IDS as readonly string[];
  if (!captureIDList.includes(captureID)) throw new Error(`${check.id}: unsupported capture id`);
  const screenshotRelative = `public/runtime-ui/${locale}/${DEVICE}/${captureID}.png`;
  return {
    check_id: check.id,
    scenario_id: expectedScenario as "SCN-019" | "SCN-020",
    fixture_id: configured.fixture_id,
    fixture_arguments: [...fixtureArgs],
    capture_id: captureID,
    locale,
    appearance: appReport.appearance,
    capture_local_date: appReport.captureLocalDate,
    visible_status_time: visibleStatusTime,
    timezone: "Asia/Singapore",
    garden_phase: gardenPhaseAt(visibleStatusTime),
    source_manifest_revision: sourceManifestRevision,
    build_receipt: {
      sha256: receiptSummary.sha256,
      bundle_id: receiptSummary.bundle_id,
      marketing_version: receiptSummary.marketing_version,
      build_number: receiptSummary.build_number,
      source_commit: receiptSummary.source_commit,
      executable_sha256: receiptSummary.executable_sha256,
      app_tree_sha256: receiptSummary.tree_sha256,
      source_provenance: receiptSummary.source_provenance,
      project_binding: projectBinding,
    },
    app_report_sha256: reportRecord.report_sha256,
    app_report: appReport,
    fixture_manifest_sha256: sha256(await readFile(artifactManifestPath)),
    screenshot_path: screenshotRelative,
    screenshot_sha256: screenshotSha256,
  };
}

async function runOutput(filename: string, scenario: string, expectedCount: number): Promise<{ output: JsonObject; path: string }> {
  const absolute = await privateArtifactPath(path.resolve(filename), `${scenario} verify output`);
  const output = await plainJson(absolute, `${scenario} verify output`);
  const source = requireObject(output.source, `${scenario} source`);
  const checks = output.automation?.checks;
  if (
    output.mode !== "strict" || output.acceptance?.physical !== "passed" ||
    source.state !== "clean-commit" || source.dirty !== false || source.signature_status !== "G" ||
    !Array.isArray(checks) || checks.length !== expectedCount ||
    checks.some((check: JsonObject) => check.scenario_id !== scenario)
  ) throw new Error(`${scenario}: verify output is not a complete signed clean physical pass`);
  return { output, path: absolute };
}

async function copyPreservingSuperseded(set: CaptureSet, locale: LocaleId, incomingIds: readonly string[]): Promise<Record<string, CaptureSet["captures"][string]>> {
  const retained: Record<string, CaptureSet["captures"][string]> = { ...(set.superseded_captures ?? {}) };
  const publicRoot = await realpath(path.join(ROOT, "public"));
  for (const [id, previous] of Object.entries(set.captures)) {
    if (!incomingIds.includes(id)) {
      retained[id] = previous;
      continue;
    }
    if (!previous.path.startsWith("public/runtime-ui/")) throw new Error(`${locale}/${id}: superseded capture path escapes runtime-ui`);
    const candidatePath = path.resolve(ROOT, previous.path);
    if (!candidatePath.startsWith(`${publicRoot}${path.sep}`)) throw new Error(`${locale}/${id}: superseded capture path escapes public/`);
    const candidateStat = await lstat(candidatePath).catch(() => null);
    if (candidateStat?.isSymbolicLink()) throw new Error("superseded capture path must not be a symbolic link");
    const previousPath = await realpath(candidatePath).catch(() => null);
    if (previousPath && !previousPath.startsWith(`${publicRoot}${path.sep}`)) throw new Error(`${locale}/${id}: superseded capture resolves outside public/`);
    const previousExists = previousPath
      ? await lstat(previousPath).then((stat) => stat.isFile() && !stat.isSymbolicLink()).catch(() => false)
      : false;
    if (previousExists && previousPath && previous.sha256) {
      const bytes = await readFile(previousPath);
      if (sha256(bytes) === previous.sha256) {
        const archivedPath = `public/runtime-ui/superseded/${locale}/${DEVICE}/${id}.png`;
        const destination = path.join(ROOT, archivedPath);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(previousPath, destination);
        retained[id] = { ...previous, path: archivedPath };
      } else {
        retained[id] = previous;
      }
    } else {
      retained[id] = previous;
    }
  }
  return retained;
}

async function main(): Promise<void> {
  const nightResult = await runOutput(arg("--night-result"), "SCN-019", 4);
  const dayResult = await runOutput(arg("--day-result"), "SCN-020", 8);
  const commit = nightResult.output.source.commit;
  if (dayResult.output.source.commit !== commit) throw new Error("night and day captures use different source commits");
  const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  const signature = execFileSync("git", ["log", "-1", "--format=%G?"], { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
  if (commit !== gitHead || signature !== "G") throw new Error("physical evidence does not match the current valid signed commit");

  const computedManifest = await computeCaptureSourceManifest();
  const sourceManifestPath = path.join(ROOT, SOURCE_MANIFEST_PATH);
  const sourceManifestBytes = await readFile(sourceManifestPath);
  const sourceManifestSha256 = sha256(sourceManifestBytes);
  const savedManifest = JSON.parse(sourceManifestBytes.toString("utf8")) as JsonObject;
  if (JSON.stringify(savedManifest) !== JSON.stringify(computedManifest)) throw new Error("stored app source manifest is not current");
  const currentSource = {
    source_revision: computedManifest.source_revision,
    source_manifest_path: SOURCE_MANIFEST_PATH,
    source_manifest_sha256: sourceManifestSha256,
  };
  const currentProject = currentGeneratedProjectBinding();
  const profile = JSON.parse(await readFile(path.join(PROJECT_ROOT, "docs/qa/verification-profile.json"), "utf8")) as JsonObject;
  const physicalChecks = [...nightResult.output.automation.checks, ...dayResult.output.automation.checks] as JsonObject[];
  const expectedIDs = new Set([
    ...NIGHT_IDS.flatMap((id) => ["en", "de"].map((lang) => `appstore-ipad13-${lang}-${id}`)),
    ...DAY_IDS.flatMap((id) => ["en", "de"].map((lang) => `appstore-ipad13-${lang}-${id}`)),
  ]);
  if (physicalChecks.length !== 12 || JSON.stringify(physicalChecks.map((check) => check.id).sort()) !== JSON.stringify([...expectedIDs].sort())) {
    throw new Error("night/day verification outputs must contain exactly the 12 current iPad fixture cases");
  }
  const evidenceCaptures: PhysicalCaptureEvidenceManifest["captures"] = [];
  for (const check of physicalChecks) {
    const scenario = check.scenario_id as string;
    const result = await validatedRunnerCheck(
      check,
      scenario === "SCN-019" ? nightResult.output.source : dayResult.output.source,
      scenario,
      currentSource,
      profile,
      currentProject,
    );
    evidenceCaptures.push(result);
  }
  evidenceCaptures.sort((a, b) => `${a.locale}/${a.capture_id}`.localeCompare(`${b.locale}/${b.capture_id}`));
  const firstDevice = requireObject(physicalChecks[0].device, "physical device metadata");
  for (const check of physicalChecks) {
    const device = requireObject(check.device, `${check.id}.device`);
    if (device.model !== firstDevice.model || device.os_version !== firstDevice.os_version) throw new Error("physical captures span different iPad hardware or OS versions");
  }
  const evidence: PhysicalCaptureEvidenceManifest = {
    schema: "arrive-within-physical-marketing-evidence/v1",
    source: {
      commit,
      signature_status: "G",
      source_revision: computedManifest.source_revision,
      source_manifest_path: SOURCE_MANIFEST_PATH,
      source_manifest_sha256: sourceManifestSha256,
    },
    device: { family: "iPad", model: String(firstDevice.model), os_version: String(firstDevice.os_version), route: "physical-device" },
    captures: evidenceCaptures,
  };
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
  const evidenceSha256 = sha256(evidenceBytes);
  const evidencePath = "physical-capture-evidence-v1.json";
  const sourceCapturesPath = path.join(ROOT, "source-captures.json");
  const sourceCaptures = await plainJson(sourceCapturesPath, "source-captures.json") as unknown as SourceCaptures;
  if (
    sourceCaptures.schema_version !== 4 || sourceCaptures.source_revision !== currentSource.source_revision ||
    sourceCaptures.source_manifest_path !== currentSource.source_manifest_path ||
    sourceCaptures.source_manifest_sha256 !== sourceManifestSha256
  ) throw new Error("current phone capture ingestion must finish at this exact source manifest before physical ingestion");

  const sets = sourceCaptures.sets;
  const currentPhoneSets = sets.filter((set) => set.device === "iphone-6.9" && set.capture_source.state === "current");
  const priorIPadSets = sets.filter((set) => set.device === DEVICE);
  if (currentPhoneSets.length !== 2 || priorIPadSets.length !== 2 ||
    JSON.stringify(currentPhoneSets.map((set) => set.locale).sort()) !== JSON.stringify([...LOCALES].sort()) ||
    JSON.stringify(priorIPadSets.map((set) => set.locale).sort()) !== JSON.stringify([...LOCALES].sort())) {
    throw new Error("source captures must include both current phone locales and both prior 13-inch iPad locales");
  }
  const updatedSets: CaptureSet[] = [];
  const replacements = new Map<string, PhysicalCaptureEvidenceManifest["captures"][number]>();
  for (const item of evidenceCaptures) replacements.set(`${item.locale}/${item.capture_id}`, item);
  for (const set of sets) {
    if (set.device !== DEVICE) {
      updatedSets.push(set);
      continue;
    }
    const locale = set.locale;
    const oldCaptures = await copyPreservingSuperseded(set, locale, CAPTURE_IDS);
    const captures: CaptureSet["captures"] = {};
    for (const captureID of CAPTURE_IDS) {
      const proof = replacements.get(`${locale}/${captureID}`);
      if (!proof) throw new Error(`${locale}/${captureID}: physical fixture proof is missing`);
      const destination = path.join(ROOT, proof.screenshot_path);
      const sourceCheck = physicalChecks.find((check) => check.id === proof.check_id)!;
      const sourcePath = await privateArtifactPath(sourceCheck.artifacts.screenshots[0], proof.check_id);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(sourcePath, destination);
      const bytes = await readFile(destination);
      if (sha256(bytes) !== proof.screenshot_sha256) throw new Error(`${locale}/${captureID}: copied physical screenshot hash mismatch`);
      const physicalSource: PhysicalCaptureSourceEvidence = {
        method: "guarded-physical-fixture",
        evidence_manifest_path: evidencePath,
        evidence_manifest_sha256: evidenceSha256,
        fixture_id: proof.fixture_id,
        capture_id: proof.capture_id,
        source_revision: currentSource.source_revision,
        source_manifest_path: currentSource.source_manifest_path,
        source_manifest_sha256: currentSource.source_manifest_sha256,
        source_commit: evidence.source.commit,
        build_receipt_sha256: proof.build_receipt.sha256,
        project_binding_sha256: proof.build_receipt.project_binding.sha256,
        app_report_sha256: proof.app_report_sha256,
        physical_device_model: evidence.device.model,
        device_os_version: evidence.device.os_version,
        capture_local_date: proof.capture_local_date,
        visible_status_time: proof.visible_status_time,
        timezone: proof.timezone,
        garden_phase: proof.garden_phase,
        appearance: proof.appearance,
      };
      captures[captureID] = {
        path: proof.screenshot_path,
        sha256: proof.screenshot_sha256,
        source_evidence: physicalSource,
      };
    }
    updatedSets.push({
      ...set,
      model: evidence.device.model,
      os: `iPadOS ${evidence.device.os_version} physical`,
      width: 2064,
      height: 2752,
      result_bundle: null,
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
      captures,
      superseded_captures: oldCaptures,
    });
  }

  const oldBundles = sourceCaptures.result_bundles;
  const currentBundles = oldBundles.filter((bundle) => bundle.device === "iphone-6.9");
  const supersededBundles = [...(sourceCaptures.superseded_result_bundles ?? []), ...oldBundles.filter((bundle) => bundle.device !== "iphone-6.9")];
  const updated: SourceCaptures = {
    ...sourceCaptures,
    schema_version: 5,
    state: "candidate-ready",
    capture_method: "Guarded XCUITest iPhone simulator captures and source-bound guarded physical iPad Pro 13-inch app fixtures; physical PNGs retain the exact original pixels.",
    capture_test: "Six per-locale iPad capture fixtures run through scripts/verify on the signed Debug build; each fixture report, receipt, source commit, device metadata, and screenshot hash is linked in physical-capture-evidence-v1.json.",
    status_bar_profile: CAPTURE_STATUS_BAR_PROFILE,
    source_commit: commit,
    source_revision: currentSource.source_revision,
    source_revision_kind: "sha256-capture-source-manifest",
    source_manifest_path: currentSource.source_manifest_path,
    source_manifest_sha256: currentSource.source_manifest_sha256,
    result_bundles: currentBundles,
    superseded_result_bundles: supersededBundles,
    physical_capture_evidence_manifest: { path: evidencePath, sha256: evidenceSha256 },
    garden_day_captures: (sourceCaptures.garden_day_captures ?? []).filter((day) => day.device === "iphone-6.9"),
    sets: updatedSets,
  };
  await writeFile(path.join(ROOT, evidencePath), evidenceBytes);
  await writeFile(sourceCapturesPath, `${JSON.stringify(updated, null, 2)}\n`);
  process.stdout.write(`Ingested 12 current physical iPad fixtures and bound their reports, receipts, source commit, model/OS, and original PNG hashes at ${computedManifest.source_revision}.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
