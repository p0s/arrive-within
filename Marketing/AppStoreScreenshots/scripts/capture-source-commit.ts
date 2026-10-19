import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

const COMMIT = /^[a-f0-9]{40}$/;
const TRANSITION = "Marketing/AppStoreScreenshots/capture-history-transition.json";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function changedStatusPaths(status: string): string[] {
  const fields = status.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = fields[index]!;
    const kind = entry.slice(0, 2);
    paths.push(entry.slice(3));
    if (kind.includes("R") || kind.includes("C")) {
      const previousPath = fields[index + 1];
      if (previousPath !== undefined) {
        paths.push(previousPath);
        index += 1;
      }
    }
  }
  return paths;
}

function signedSnapshotBase(projectRoot: string, captureCommit: string, sourcePaths: ReadonlySet<string>): string {
  const roots = git(projectRoot, ["rev-list", "--max-parents=0", "HEAD"]).trim().split("\n");
  if (roots.length !== 1 || !COMMIT.test(roots[0]!)) throw new Error("capture history transition requires one signed root");
  const root = roots[0]!;
  const receipt = JSON.parse(git(projectRoot, ["show", `${root}:${TRANSITION}`]));
  if (Object.keys(receipt).sort().join(",") !== "historical_capture_commit,schema_version,source_manifest_path,source_manifest_sha256"
    || receipt.schema_version !== 1 || receipt.historical_capture_commit !== captureCommit
    || typeof receipt.source_manifest_path !== "string"
    || !/^Marketing\/AppStoreScreenshots\/capture-source-manifest-[A-Za-z0-9.-]+\.json$/.test(receipt.source_manifest_path)
    || !/^[a-f0-9]{64}$/.test(receipt.source_manifest_sha256)) throw new Error("invalid signed capture history transition");
  const manifestText = git(projectRoot, ["show", `${root}:${receipt.source_manifest_path}`]);
  if (createHash("sha256").update(manifestText).digest("hex") !== receipt.source_manifest_sha256) {
    throw new Error("signed capture transition manifest hash mismatch");
  }
  const manifest = JSON.parse(manifestText);
  if (!Array.isArray(manifest.files)
    || JSON.stringify(manifest.files.map((file: { path: string }) => file.path).sort()) !== JSON.stringify([...sourcePaths].sort())) {
    throw new Error("signed capture transition source inventory mismatch");
  }
  for (const file of manifest.files) {
    if (typeof file.path !== "string" || path.isAbsolute(file.path) || file.path.split("/").some((part: string) => ["..", ".", ""].includes(part))) {
      throw new Error("unsafe signed capture transition source path");
    }
    const filename = path.join(projectRoot, file.path);
    if (!lstatSync(filename).isFile() || lstatSync(filename).isSymbolicLink()
      || createHash("sha256").update(readFileSync(filename)).digest("hex") !== file.sha256) {
      throw new Error("signed capture transition does not match current source bytes");
    }
  }
  return root;
}

/**
 * Verifies that an immutable capture commit remains the app source of the
 * current checkout. Later signed commits may add capture/export evidence only.
 */
export function assertCaptureSourceCommit(
  projectRoot: string,
  captureCommit: string,
  sourcePaths: ReadonlySet<string>,
): string {
  if (!COMMIT.test(captureCommit)) throw new Error("capture evidence source commit is invalid");
  const head = git(projectRoot, ["rev-parse", "HEAD"]).trim();
  if (!COMMIT.test(head)) throw new Error("current checkout HEAD is invalid");

  let sourceBase = captureCommit;
  try {
    execFileSync("git", ["cat-file", "-e", `${captureCommit}^{commit}`], { cwd: projectRoot, stdio: "pipe" });
  } catch {
    // A fresh public repository preserves historical evidence through an exact
    // manifest attested by its signed root, without importing private history.
    sourceBase = signedSnapshotBase(projectRoot, captureCommit, sourcePaths);
  }
  for (const commit of [sourceBase, head]) {
    const signature = git(projectRoot, ["log", "-1", "--format=%G?", commit]).trim();
    if (signature !== "G") throw new Error(`capture source commit is missing or does not verify as signed: ${commit}`);
  }

  try {
    git(projectRoot, ["merge-base", "--is-ancestor", sourceBase, head]);
  } catch {
    throw new Error("capture source commit is not an ancestor of the current signed HEAD");
  }

  const descendants = git(projectRoot, ["diff", "--name-only", "-z", `${sourceBase}..${head}`, "--"])
    .split("\0")
    .filter(Boolean);
  const committedSourceChange = descendants.find((filename) => sourcePaths.has(filename));
  if (committedSourceChange) {
    throw new Error(`current signed descendants changed a captured app source input: ${committedSourceChange}`);
  }

  const dirty = git(projectRoot, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
  const dirtySource = changedStatusPaths(dirty).find((filename) => sourcePaths.has(filename));
  if (dirtySource) throw new Error(`capture source input is dirty after its signed commit: ${dirtySource}`);

  return head;
}
