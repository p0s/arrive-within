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

import {
  ROOT,
  assertNarrativeAlternatives,
  assertPlan,
  loadNarrativeAlternatives,
  loadPlan,
  loadSourceCaptures,
  resolveBoundedChildPath,
  type CaptureSet,
  type DeviceId,
  type LocaleId,
  type SourceCaptures,
} from "./contracts";
import { validateOpaqueRgbPng } from "./image-validation";
import { computeCaptureSourceManifest } from "./source-provenance";

const PROJECT_ROOT = path.resolve(ROOT, "../..");
const EXPECTED_TESTS: Record<LocaleId, string> = {
  "en-US": "ArriveWithinMarketingCaptureUITests/testCaptureAllRequiredMarketingStatesEnglish()",
  "de-DE": "ArriveWithinMarketingCaptureUITests/testCaptureAllRequiredMarketingStatesGerman()",
};

type Options = { iphoneResult: string; ipadResult: string };
type Attachment = {
  deviceName: string;
  exportedFileName: string;
  isAssociatedWithFailure: boolean;
  suggestedHumanReadableName: string;
};
type AttachmentGroup = { attachments: Attachment[]; testIdentifier: string };

function parseOptions(argv: string[]): Options {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    if (index < 0 || !argv[index + 1]) throw new Error(`missing ${flag}`);
    return argv[index + 1];
  };
  return { iphoneResult: value("--iphone-result"), ipadResult: value("--ipad-result") };
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function assertResultPath(input: string): Promise<string> {
  const absolute = path.resolve(PROJECT_ROOT, input);
  const buildRoot = await realpath(path.join(PROJECT_ROOT, ".build"));
  const actual = await realpath(absolute);
  if (!actual.startsWith(`${buildRoot}${path.sep}`) || !actual.endsWith(".xcresult")) {
    throw new Error(`xcresult must be beneath the project .build directory: ${input}`);
  }
  if (!(await lstat(actual)).isDirectory()) throw new Error(`xcresult is not a directory: ${input}`);
  return actual;
}

async function hashTree(root: string): Promise<string> {
  const digest = createHash("sha256");
  async function visit(relative: string): Promise<void> {
    const absolute = path.join(root, relative);
    const children = await readdir(absolute, { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
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

function readSummary(result: string): {
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  totalTestCount: number;
  result: string;
} {
  const output = execFileSync(
    "xcrun",
    ["xcresulttool", "get", "test-results", "summary", "--path", result, "--compact"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(output) as ReturnType<typeof readSummary>;
}

async function exportAttachments(result: string): Promise<{ root: string; groups: AttachmentGroup[] }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "arrive-within-marketing-xcresult-"));
  execFileSync("xcrun", ["xcresulttool", "export", "attachments", "--path", result, "--output-path", root], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return { root, groups: JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8")) as AttachmentGroup[] };
}

function setFor(captures: SourceCaptures, locale: LocaleId, device: DeviceId): CaptureSet {
  const set = captures.sets.find((candidate) => candidate.locale === locale && candidate.device === device);
  if (!set) throw new Error(`missing source capture set ${locale}/${device}`);
  return set;
}

async function ingestResult(
  captures: SourceCaptures,
  result: string,
  device: DeviceId,
  expectedIDs: string[],
): Promise<SourceCaptures["result_bundles"][number]> {
  const summary = readSummary(result);
  if (
    summary.result !== "Passed" ||
    summary.totalTestCount !== 2 ||
    summary.passedTests !== 2 ||
    summary.failedTests !== 0 ||
    summary.skippedTests !== 0
  ) {
    throw new Error(`${device}: expected exactly two passed capture tests and no failures/skips`);
  }

  const treeSha256 = await hashTree(result);
  const exported = await exportAttachments(result);
  try {
    if (exported.groups.length !== 2) throw new Error(`${device}: expected two attachment groups`);
    for (const locale of ["en-US", "de-DE"] as LocaleId[]) {
      const group = exported.groups.find((candidate) => candidate.testIdentifier === EXPECTED_TESTS[locale]);
      if (!group) throw new Error(`${device}/${locale}: expected test attachment group is missing`);
      if (group.attachments.length !== expectedIDs.length) {
        throw new Error(`${device}/${locale}: expected ${expectedIDs.length} kept screenshot attachments`);
      }
      const set = setFor(captures, locale, device);
      set.result_bundle = {
        name: path.basename(result),
        xcresult_tree_sha256: treeSha256,
        test_identifier: group.testIdentifier,
      };
      for (const id of expectedIDs) {
        const prefix = `marketing-${locale}-${id}_0_`;
        const matches = group.attachments.filter(
          (attachment) =>
            attachment.suggestedHumanReadableName.startsWith(prefix) &&
            attachment.suggestedHumanReadableName.endsWith(".png"),
        );
        if (matches.length !== 1) throw new Error(`${device}/${locale}/${id}: expected one exact attachment`);
        const attachment = matches[0];
        if (attachment.isAssociatedWithFailure) throw new Error(`${device}/${locale}/${id}: attachment is failure-associated`);
        const sourceCandidate = resolveBoundedChildPath(exported.root, attachment.exportedFileName);
        const sourceCandidateStat = await lstat(sourceCandidate);
        if (!sourceCandidateStat.isFile() || sourceCandidateStat.isSymbolicLink()) {
          throw new Error(`${device}/${locale}/${id}: exported attachment is not a regular file`);
        }
        const exportedRoot = await realpath(exported.root);
        const source = await realpath(sourceCandidate);
        if (!source.startsWith(`${exportedRoot}${path.sep}`)) {
          throw new Error(`${device}/${locale}/${id}: exported attachment escapes its temporary root`);
        }
        const record = set.captures[id] ?? {
          path: `public/runtime-ui/${locale}/${device}/${id}.png`,
          sha256: null,
        };
        set.captures[id] = record;
        const destination = path.resolve(ROOT, record.path);
        const publicRoot = path.resolve(ROOT, "public");
        if (!destination.startsWith(`${publicRoot}${path.sep}`)) throw new Error(`${device}/${locale}/${id}: path escapes public`);
        const validation = await validateOpaqueRgbPng(source, set.width, set.height);
        if (validation.status !== "pass") throw new Error(`${device}/${locale}/${id}: ${validation.errors.join("; ")}`);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(source, destination);
        record.sha256 = sha256(await readFile(destination));
      }
    }
  } finally {
    await rm(exported.root, { recursive: true });
  }

  return {
    device,
    name: path.basename(result),
    xcresult_tree_sha256: treeSha256,
    passed_tests: summary.passedTests,
    failed_tests: summary.failedTests,
    skipped_tests: summary.skippedTests,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const [iphoneResult, ipadResult] = await Promise.all([
    assertResultPath(options.iphoneResult),
    assertResultPath(options.ipadResult),
  ]);
  const plan = await loadPlan();
  assertPlan(plan);
  const alternatives = await loadNarrativeAlternatives();
  assertNarrativeAlternatives(alternatives);
  const captures = await loadSourceCaptures();
  if (captures.schema_version !== 2) throw new Error("source-captures.json must use schema 2");

  const sourceManifest = await computeCaptureSourceManifest();
  const bundles = [];
  bundles.push(await ingestResult(captures, iphoneResult, "iphone-6.9", plan.required_capture_ids));
  bundles.push(await ingestResult(captures, ipadResult, "ipad-13", plan.required_capture_ids));

  captures.state = "candidate-ready";
  delete captures.human_visual_review;
  delete captures.post_capture_change;
  captures.source_revision = sourceManifest.source_revision;
  captures.source_revision_kind = "sha256-capture-source-manifest";
  captures.source_manifest_path = "capture-source-manifest.json";
  captures.result_bundles = bundles;
  await writeFile(path.join(ROOT, "capture-source-manifest.json"), `${JSON.stringify(sourceManifest, null, 2)}\n`);
  await writeFile(path.join(ROOT, "source-captures.json"), `${JSON.stringify(captures, null, 2)}\n`);
  process.stdout.write(
    `Ingested ${captures.sets.length * plan.required_capture_ids.length} selected real UI captures from 2 passed result bundles; source revision ${sourceManifest.source_revision}.\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
