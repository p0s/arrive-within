import { execFileSync } from "node:child_process";

const COMMIT = /^[a-f0-9]{40}$/;

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

  for (const commit of [captureCommit, head]) {
    const signature = git(projectRoot, ["log", "-1", "--format=%G?", commit]).trim();
    if (signature !== "G") throw new Error(`capture source commit is missing or does not verify as signed: ${commit}`);
  }

  try {
    git(projectRoot, ["merge-base", "--is-ancestor", captureCommit, head]);
  } catch {
    throw new Error("capture source commit is not an ancestor of the current signed HEAD");
  }

  const descendants = git(projectRoot, ["diff", "--name-only", "-z", `${captureCommit}..${head}`, "--"])
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
