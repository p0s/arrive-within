#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ROOT, assertPlan, loadPlan, loadSourceCaptures, type ScreenshotPlan } from "./contracts";
import { collectCurrentExportFiles } from "./export-inventory";

const projectRoot = path.resolve(ROOT, "../..");
const reportPath = path.join(projectRoot, "docs", "qa", "marketing", "app-store-screenshots-reproducibility.json");
const expectedNode = "v26.7.0";

type Artifact = { file: string; bytes: number; sha256: string };
type Snapshot = { files: number; sha256: string; artifacts: Artifact[] };

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function expectedArtifactCount(plan: ScreenshotPlan): number {
  const setCount = plan.locales.length * plan.devices.length;
  return plan.expected_final_images + setCount * 5 + 3;
}

async function snapshot(plan: ScreenshotPlan, narrative: string | null = null): Promise<Snapshot> {
  const root = narrative
    ? path.join(ROOT, "exports", "alternatives", narrative)
    : path.join(ROOT, "exports");
  const files = await collectCurrentExportFiles(root, plan);
  const expected = expectedArtifactCount(plan);
  if (files.length !== expected) {
    throw new Error(`expected exactly ${expected} ${narrative ?? "selected"} current export artifacts, found ${files.length}`);
  }
  const artifacts: Artifact[] = [];
  const tree = createHash("sha256");
  for (const file of files) {
    const data = await readFile(path.join(root, file));
    const artifact = { file, bytes: data.byteLength, sha256: sha256(data) };
    artifacts.push(artifact);
    tree.update(file);
    tree.update("\0");
    tree.update(artifact.sha256);
    tree.update("\0");
  }
  return { files: artifacts.length, sha256: tree.digest("hex"), artifacts };
}

function run(script: string, args: string[] = []): void {
  execFileSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function exportPass(baseUrl: string, plan: ScreenshotPlan, narrative: string | null = null): void {
  for (const locale of plan.locales) for (const device of plan.devices) {
    const url = new URL(baseUrl);
    url.searchParams.set("device", device.id);
    url.searchParams.set("locale", locale);
    if (narrative) url.searchParams.set("narrative", narrative);
    const args = [
      "--url", url.href,
      "--width", String(device.width),
      "--height", String(device.height),
      "--locale", locale,
      "--device", device.id,
      "--theme", "forest-twilight",
      "--out", narrative ? `exports/alternatives/${narrative}/${locale}/${device.id}` : `exports/${locale}/${device.id}`,
    ];
    if (narrative) args.unshift("--narrative", narrative);
    run("scripts/export-playwright.ts", args);
  }
  run("scripts/validate-export-matrix.ts", narrative ? ["--narrative", narrative] : []);
}

function snapshotsMatch(left: Snapshot, right: Snapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function checkExisting(): Promise<void> {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const captures = await loadSourceCaptures();
  const plan = await loadPlan();
  assertPlan(plan);
  const current = await snapshot(plan);
  if (
    report.schema_version !== 1 ||
    report.status !== "passed" ||
    report.generated_at !== null ||
    report.source_revision !== captures.source_revision ||
    report.pass_1.sha256 !== report.pass_2.sha256 ||
    !snapshotsMatch(current, report.pass_2)
  ) throw new Error("screenshot reproducibility record does not match the current plan-bound export tree");
  process.stdout.write(`Screenshot reproducibility record passed: ${current.files} artifacts, tree SHA-256 ${current.sha256}.\n`);
}

async function main(): Promise<void> {
  if (process.version !== expectedNode) throw new Error(`expected Node ${expectedNode}, selected ${process.version}`);
  if (process.argv.includes("--check")) {
    await checkExisting();
    return;
  }
  const urlIndex = process.argv.indexOf("--url");
  if (urlIndex < 0 || !process.argv[urlIndex + 1]) throw new Error("usage: verify-reproducibility.ts --url http://127.0.0.1:PORT or --check");
  const baseUrl = new URL(process.argv[urlIndex + 1]);
  if (baseUrl.hostname !== "127.0.0.1" || baseUrl.protocol !== "http:") throw new Error("export URL must use local HTTP on 127.0.0.1");
  const narrativeIndex = process.argv.indexOf("--narrative");
  const narrative = narrativeIndex >= 0 ? process.argv[narrativeIndex + 1] : null;
  if (narrativeIndex >= 0 && !narrative) throw new Error("missing --narrative value");
  const plan = await loadPlan();
  assertPlan(plan);
  const captures = await loadSourceCaptures();

  exportPass(baseUrl.href, plan, narrative);
  const first = await snapshot(plan, narrative);
  exportPass(baseUrl.href, plan, narrative);
  const second = await snapshot(plan, narrative);
  if (!snapshotsMatch(first, second)) {
    const changed = first.artifacts.filter((item, index) => JSON.stringify(item) !== JSON.stringify(second.artifacts[index])).map((item) => item.file);
    throw new Error(`two-pass export is not byte reproducible: ${changed.join(", ")}`);
  }

  const report = {
    schema_version: 1,
    status: "passed",
    generated_at: null,
    generation_time_policy: "omitted-for-byte-reproducibility",
    product: "Arrive Within",
    source_revision: captures.source_revision,
    passes: 2,
    sets_per_pass: plan.locales.length * plan.devices.length,
    images_per_pass: plan.expected_final_images,
    external_network_policy: "Each exporter blocks non-local requests and fails if any are attempted.",
    narrative: narrative ?? "selected",
    human_visual_review: narrative
      ? { state: "pending", basis: "Non-shipping narrative candidate; inspect all four contact sheets before selection." }
      : captures.state === "human-reviewed" && captures.human_visual_review
      ? {
          state: "approved",
          basis: captures.human_visual_review.notes,
        }
      : {
          state: "pending",
          basis: "Fresh source captures require inspection of all four English/German iPhone/iPad contact sheets.",
        },
    upload_authorization: narrative ? "candidate-only-not-selected" : "candidate-only-human-review-pending-not-upload-authorized",
    pass_1: first,
    pass_2: second,
  };
  const outputReport = narrative
    ? path.join(ROOT, "exports", "alternatives", narrative, "_reproducibility.json")
    : reportPath;
  await writeFile(outputReport, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Two-pass ${narrative ?? "selected"} screenshot export reproducibility passed: ${second.files} artifacts, tree SHA-256 ${second.sha256}.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
