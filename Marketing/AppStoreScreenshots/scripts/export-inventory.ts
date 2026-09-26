import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import type { ScreenshotPlan } from "./contracts";

const MATRIX_SUMMARIES = [
  "_matrix-manifest.json",
  "_matrix-validation.json",
  "_matrix-validation.txt",
] as const;

export async function collectCurrentExportFiles(root: string, plan: ScreenshotPlan): Promise<string[]> {
  const result: string[] = [];
  for (const locale of plan.locales) {
    for (const device of plan.devices) {
      const directory = path.join(root, locale, device.id);
      const directoryStat = await lstat(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        throw new Error(`current screenshot export directory is not a regular directory: ${locale}/${device.id}`);
      }
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isSymbolicLink() || !entry.isFile()) {
          throw new Error(`current screenshot export contains an unsupported entry: ${locale}/${device.id}/${entry.name}`);
        }
        result.push(path.posix.join(locale, device.id, entry.name));
      }
    }
  }

  for (const name of MATRIX_SUMMARIES) {
    const filename = path.join(root, name);
    try {
      const stat = await lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`matrix summary is not a regular file: ${name}`);
      result.push(name);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}
