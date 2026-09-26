import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

export async function resolvePrivateArtifactPath(
  value: unknown,
  context: string,
  allowedRoots: string[] = [tmpdir(), path.join(path.sep, "private", "tmp")],
): Promise<string> {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${context} must be an absolute path`);
  }

  const original = await lstat(value);
  if (!original.isFile() || original.isSymbolicLink()) {
    throw new Error(`${context} must be a regular file`);
  }

  const resolved = await realpath(value);
  const resolvedStat = await lstat(resolved);
  if (!resolvedStat.isFile() || resolvedStat.isSymbolicLink()) {
    throw new Error(`${context} must resolve to a regular file`);
  }

  for (const candidateRoot of allowedRoots) {
    let root: string;
    try {
      root = await realpath(candidateRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const relative = path.relative(root, resolved);
    if (
      relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    ) return resolved;
  }

  throw new Error(`${context} must stay inside an approved private temporary directory`);
}
