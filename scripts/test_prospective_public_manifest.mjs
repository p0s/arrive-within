#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listProspectivePublicFiles } from "./lib/prospective-public-files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputs = [
  ".evidence/release/prospective-public-manifest-test-a.json",
  ".evidence/release/prospective-public-manifest-test-b.json",
];

for (const output of outputs) {
  const result = spawnSync(process.execPath, ["scripts/create_prospective_public_manifest.mjs", "--output", output], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `manifest generation failed for ${output}`);
}

const firstBytes = readFileSync(path.join(root, outputs[0]));
const secondBytes = readFileSync(path.join(root, outputs[1]));
if (!firstBytes.equals(secondBytes)) throw new Error("prospective-public manifests are not byte deterministic");

const manifest = JSON.parse(firstBytes);
const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, encoding: "utf8" });
const gitLineageAvailable = head.status === 0;
const expectedProvenance = gitLineageAvailable
  ? "git-index-publication-candidate"
  : "prospective-public-tree";
if (manifest.provenance_mode !== expectedProvenance || manifest.git_lineage_available !== gitLineageAvailable) {
  throw new Error("manifest must truthfully describe the current Git provenance boundary");
}
if (manifest.generated_project_policy?.authority !== "project.yml" || manifest.generated_project_policy?.generated_project !== "ArriveWithin.xcodeproj") {
  throw new Error("generated-project policy is incomplete");
}
const privatePatterns = [
  /^SPEC\.md$/,
  /^AGENTS\.md$/,
  /^GOAL\.md$/,
  /^LOCAL_/,
  /^PRIVATE_/,
  /^\.git(?:\/|$)/,
  /^\.evidence(?:\/|$)/,
  /^\.codex(?:\/|$)/,
  /^ContentProduction\/production-candidates(?:\/|$)/,
];
const forbiddenPaths = manifest.files.map((file) => file.path).filter((file) => privatePatterns.some((pattern) => pattern.test(file)));
if (forbiddenPaths.length > 0) throw new Error(`private paths entered manifest: ${forbiddenPaths.join(", ")}`);
if (manifest.file_count !== manifest.files.length || manifest.file_count < 1) throw new Error("manifest file count is invalid");

const paths = new Set(manifest.files.map((file) => file.path));
for (const ignored of [
  "Config/Local.xcconfig",
  "Config/ArriveWithin.entitlements.local",
  "Marketing/AppStoreScreenshots/tsconfig.tsbuildinfo",
  "ArriveWithin.xcodeproj/project.pbxproj",
  "Marketing/SoundDesignLab/output/manifest.json",
]) {
  if (paths.has(ignored)) throw new Error(`manifest included a .gitignore-excluded path: ${ignored}`);
}

const fixture = await mkdtemp(path.join(os.tmpdir(), "arrive-public-ignore-"));
try {
  await mkdir(path.join(fixture, "nested"));
  await mkdir(path.join(fixture, "nested", "__pycache__"));
  await writeFile(
    path.join(fixture, ".gitignore"),
    ["*.secret", "!keep.secret", "/root-only.txt", "nested/*.tmp", ""].join("\n")
  );
  await writeFile(path.join(fixture, "keep.txt"), "public\n");
  await writeFile(path.join(fixture, "drop.secret"), "private\n");
  await writeFile(path.join(fixture, "keep.secret"), "public exception\n");
  await writeFile(path.join(fixture, "root-only.txt"), "private\n");
  await writeFile(path.join(fixture, "nested", "drop.tmp"), "private\n");
  await writeFile(path.join(fixture, "nested", "keep.txt"), "public\n");
  await writeFile(path.join(fixture, "nested", "local.entitlements.local"), "private\n");
  await writeFile(path.join(fixture, "nested", "state.tsbuildinfo"), "private\n");
  await writeFile(path.join(fixture, "nested", ".env.production"), "private\n");
  await writeFile(path.join(fixture, "nested", "secret.p8"), "private\n");
  await writeFile(path.join(fixture, "nested", "__pycache__", "x.pyc"), "private\n");
  let rejectedSensitiveFixture = false;
  try {
    await listProspectivePublicFiles(fixture);
  } catch (error) {
    rejectedSensitiveFixture = error instanceof Error
      && error.message.includes("defense-in-depth private paths")
      && error.message.includes("local.entitlements.local")
      && error.message.includes("state.tsbuildinfo")
      && error.message.includes(".env.production")
      && error.message.includes("secret.p8")
      && error.message.includes("__pycache__/x.pyc");
  }
  if (!rejectedSensitiveFixture) throw new Error("sensitive fixture paths did not fail closed");
  for (const rejected of [
    "nested/local.entitlements.local", "nested/state.tsbuildinfo",
    "nested/.env.production", "nested/secret.p8", "nested/__pycache__/x.pyc",
  ]) {
    await rm(path.join(fixture, rejected), { force: true });
  }
  const fixturePaths = new Set(
    (await listProspectivePublicFiles(fixture)).map((candidate) => candidate.relative)
  );
  for (const included of [".gitignore", "keep.txt", "keep.secret", "nested/keep.txt"]) {
    if (!fixturePaths.has(included)) throw new Error(`ignore parser omitted public fixture: ${included}`);
  }
  for (const excluded of ["drop.secret", "root-only.txt", "nested/drop.tmp"]) {
    if (fixturePaths.has(excluded)) throw new Error(`ignore parser included ignored fixture: ${excluded}`);
  }
} finally {
  await rm(fixture, { recursive: true, force: true });
}

process.stdout.write(`Prospective public manifest validation passed: ${manifest.file_count} files, deterministic, ignore-aware, and private-path-free.\n`);
