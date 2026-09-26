import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "./contracts";

const PROJECT_ROOT = path.resolve(ROOT, "../..");

export const CAPTURE_SOURCE_INPUTS_PATH = "Marketing/AppStoreScreenshots/capture-source-inputs.json";

export type CaptureSourceManifest = {
  schema_version: 1;
  algorithm: string;
  generated_at: null;
  generation_time_policy: "omitted-for-byte-reproducibility";
  project_root: ".";
  inputs: string[];
  source_revision: string;
  files: Array<{ path: string; bytes: number; sha256: string }>;
};

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function loadCaptureSourceInputs(): Promise<string[]> {
  const contractPath = path.join(PROJECT_ROOT, CAPTURE_SOURCE_INPUTS_PATH);
  const contract = JSON.parse(await readFile(contractPath, "utf8")) as {
    schema_version?: unknown;
    inputs?: unknown;
  };
  if (contract.schema_version !== 1 || !Array.isArray(contract.inputs) || !contract.inputs.every((item) => typeof item === "string")) {
    throw new Error("capture source input contract is invalid");
  }
  const inputs = contract.inputs as string[];
  if (
    !inputs.includes(CAPTURE_SOURCE_INPUTS_PATH) ||
    new Set(inputs).size !== inputs.length ||
    inputs.some((item) => item.length === 0 || item.startsWith("/") || item.split("/").includes("..") || item.includes("\\"))
  ) throw new Error("capture source inputs must be unique safe repository-relative paths and include their contract");
  return inputs;
}

async function collect(relative: string): Promise<string[]> {
  const absolute = path.join(PROJECT_ROOT, relative);
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) throw new Error(`capture source input must not be a symbolic link: ${relative}`);
  if (stat.isFile()) return [relative];
  if (!stat.isDirectory()) throw new Error(`unsupported capture source input: ${relative}`);

  const children = await readdir(absolute, { withFileTypes: true });
  const result: string[] = [];
  for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
    const childRelative = path.posix.join(relative.split(path.sep).join(path.posix.sep), child.name);
    if (child.isSymbolicLink()) throw new Error(`capture source input must not contain a symbolic link: ${childRelative}`);
    if (child.isDirectory()) result.push(...(await collect(childRelative)));
    else if (child.isFile()) result.push(childRelative);
    else throw new Error(`unsupported capture source entry: ${childRelative}`);
  }
  return result;
}

export async function computeCaptureSourceManifest(): Promise<CaptureSourceManifest> {
  const inputs = await loadCaptureSourceInputs();
  const relativePaths = (await Promise.all(inputs.map(collect))).flat().sort();
  if (relativePaths.length === 0) throw new Error("capture source manifest cannot be empty");

  const files = [];
  const revision = createHash("sha256");
  for (const relative of relativePaths) {
    const data = await readFile(path.join(PROJECT_ROOT, relative));
    const digest = sha256(data);
    const normalized = relative.split(path.sep).join(path.posix.sep);
    files.push({ path: normalized, bytes: data.byteLength, sha256: digest });
    revision.update(normalized);
    revision.update("\0");
    revision.update(digest);
    revision.update("\n");
  }

  return {
    schema_version: 1,
    algorithm: "SHA-256 over sorted UTF-8 relative-path, NUL, file-SHA-256, LF records",
    generated_at: null,
    generation_time_policy: "omitted-for-byte-reproducibility",
    project_root: ".",
    inputs,
    source_revision: revision.digest("hex"),
    files,
  };
}
