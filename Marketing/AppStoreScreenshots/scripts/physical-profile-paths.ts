import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

export async function resolveProjectRegularFile(projectRoot: string, relativePath: unknown): Promise<string> {
  if (
    typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/).includes("..")
  ) throw new Error("profile file path must be a safe project-relative path");

  const root = await realpath(projectRoot);
  const candidate = path.resolve(root, relativePath);
  const lexicalRelative = path.relative(root, candidate);
  if (!lexicalRelative || lexicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(lexicalRelative)) {
    throw new Error("profile file path escapes the repository");
  }
  const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("profile validator must be a regular file");
  const resolved = await realpath(candidate);
  const realRelative = path.relative(root, resolved);
  if (!realRelative || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error("profile validator resolves outside the repository");
  }
  return resolved;
}
