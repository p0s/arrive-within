#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listProspectivePublicFiles } from "./lib/prospective-public-files.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = path.join(ROOT, ".evidence", "release");
const DEFAULT_OUTPUT = path.join(OUTPUT_ROOT, "prospective-public-source-manifest.json");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function collect() {
  const files = [];
  for (const candidate of await listProspectivePublicFiles(ROOT)) {
    const bytes = await readFile(candidate.absolute);
    files.push({
      path: candidate.relative,
      mode: candidate.stat.mode & 0o111 ? "100755" : "100644",
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return files;
}

function outputArgument() {
  const index = process.argv.indexOf("--output");
  if (index === -1) return DEFAULT_OUTPUT;
  if (!process.argv[index + 1] || process.argv[index + 2]) throw new Error("usage: create_prospective_public_manifest.mjs [--output .evidence/release/<name>.json]");
  return path.resolve(ROOT, process.argv[index + 1]);
}

const outputPath = outputArgument();
if (outputPath !== OUTPUT_ROOT && !outputPath.startsWith(`${OUTPUT_ROOT}${path.sep}`)) {
  throw new Error("output must stay inside ignored .evidence/release");
}

const files = await collect();
const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
  cwd: ROOT,
  encoding: "utf8",
});
const gitLineageAvailable = head.status === 0 && /^[a-f0-9]{40,64}$/.test(head.stdout.trim());
const treeVector = files.map((file) => `${file.mode}\0${file.path}\0${file.bytes}\0${file.sha256}`).join("\0");
const projectSpecBytes = await readFile(path.join(ROOT, "project.yml"));
const projectDirectory = path.join(ROOT, "ArriveWithin.xcodeproj");
const projectPresent = await stat(projectDirectory).then((value) => value.isDirectory()).catch(() => false);
const payload = {
  schema_version: 1,
  provenance_mode: gitLineageAvailable ? "git-index-publication-candidate" : "prospective-public-tree",
  git_lineage_available: gitLineageAvailable,
  public_tree_sha256: sha256(Buffer.from(treeVector, "utf8")),
  file_count: files.length,
  total_bytes: files.reduce((total, file) => total + file.bytes, 0),
  generated_project_policy: {
    authority: "project.yml",
    generator: "xcodegen",
    generated_project: "ArriveWithin.xcodeproj",
    generated_project_present: projectPresent,
    regeneration_command: "xcodegen generate",
    project_spec_sha256: sha256(projectSpecBytes),
  },
  exclusions: {
    private_authority: true,
    local_configuration: true,
    credentials_and_signing: true,
    model_cache_and_raw_audio: true,
    generated_build_outputs: true,
    git_metadata: true,
  },
  files,
};
payload.payload_sha256 = sha256(Buffer.from(JSON.stringify(payload), "utf8"));
const serialized = `${JSON.stringify(payload, null, 2)}\n`;

await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
await writeFile(outputPath, serialized, { mode: 0o600 });
process.stdout.write(`Prospective public manifest: ${payload.file_count} files, tree ${payload.public_tree_sha256}, file ${sha256(Buffer.from(serialized))}.\n`);
