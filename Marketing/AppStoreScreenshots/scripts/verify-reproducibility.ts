#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { ROOT, loadSourceCaptures } from "./contracts";

const projectRoot = path.resolve(ROOT, "../..");
const reportPath = path.join(projectRoot, "docs", "qa", "marketing", "app-store-screenshots-reproducibility.json");
const expectedNode = "v26.7.0";

type Artifact = { file: string; bytes: number; sha256: string };
type Snapshot = { files: number; sha256: string; artifacts: Artifact[] };

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function collect(directory: string, relative = "", selectedOnly = false): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (selectedOnly && relative === "" && entry.name === "alternatives") continue;
    if (entry.name === "_reproducibility.json") continue;
    const child = path.join(relative, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(absolute, child, selectedOnly));
    else if (entry.isFile()) files.push(child.split(path.sep).join("/"));
    else throw new Error(`unsupported export entry ${child}`);
  }
  return files;
}

async function snapshot(narrative: string | null = null): Promise<Snapshot> {
  const root = narrative
    ? path.join(ROOT, "exports", "alternatives", narrative)
    : path.join(ROOT, "exports");
  const files = await collect(root, "", narrative === null);
  if (files.length !== 47) {
    throw new Error(`expected exactly 47 ${narrative ?? "selected"} export artifacts, found ${files.length}`);
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

function exportPass(baseUrl: string, narrative: string | null = null): void {
  const jobs = [
    ["iphone-6.9", "en-US", "1320", "2868", "exports/en-US/iphone-6.9"],
    ["iphone-6.9", "de-DE", "1320", "2868", "exports/de-DE/iphone-6.9"],
    ["ipad-13", "en-US", "2064", "2752", "exports/en-US/ipad-13"],
    ["ipad-13", "de-DE", "2064", "2752", "exports/de-DE/ipad-13"],
  ];
  for (const [device, locale, width, height, output] of jobs) {
    const url = new URL(baseUrl);
    url.searchParams.set("device", device);
    url.searchParams.set("locale", locale);
    if (narrative) url.searchParams.set("narrative", narrative);
    const args = [
      "--url", url.href,
      "--width", width,
      "--height", height,
      "--locale", locale,
      "--device", device,
      "--theme", "forest-twilight",
      "--out", narrative ? `exports/alternatives/${narrative}/${locale}/${device}` : output,
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
  const current = await snapshot();
  if (
    report.schema_version !== 1 ||
    report.status !== "passed" ||
    report.generated_at !== null ||
    report.source_revision !== captures.source_revision ||
    report.pass_1.sha256 !== report.pass_2.sha256 ||
    !snapshotsMatch(current, report.pass_2)
  ) throw new Error("screenshot reproducibility record does not match current 47-artifact export tree");
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
  const captures = await loadSourceCaptures();

  exportPass(baseUrl.href, narrative);
  const first = await snapshot(narrative);
  exportPass(baseUrl.href, narrative);
  const second = await snapshot(narrative);
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
    sets_per_pass: 4,
    images_per_pass: 24,
    external_network_policy: "Each exporter blocks non-local requests and fails if any are attempted.",
    narrative: narrative ?? "selected",
    human_visual_review: narrative
      ? { state: "pending", basis: "Non-shipping narrative candidate; inspect all four contact sheets before selection." }
      : {
          state: "approved",
          basis: "English and German iPhone/iPad contact sheets inspected after enforcing one headline, no subtitle layers, and a tight headline-to-product gap.",
        },
    upload_authorization: narrative ? "candidate-only-not-selected" : "authorized-for-app-store-version-1.0-after-current-source-validation",
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
