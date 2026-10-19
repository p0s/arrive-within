import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ROOT } from "./contracts";
import { resolvePrivateArtifactPath } from "./private-artifact-paths";

async function temporaryFile(root: string, prefix: string): Promise<{ directory: string; file: string }> {
  const directory = await mkdtemp(path.join(root, prefix));
  const file = path.join(directory, "artifact.json");
  await writeFile(file, "{}\n", { mode: 0o600 });
  return { directory, file };
}

test("accepts regular files under the host and shared verifier temporary roots", async () => {
  const hostTemp = await temporaryFile(tmpdir(), "arrive-within-host-artifact-");
  const runnerTempRoot = path.join(path.sep, "private", "tmp");
  const runnerTemp = await temporaryFile(runnerTempRoot, "arrive-within-runner-artifact-");
  try {
    assert.equal(await resolvePrivateArtifactPath(hostTemp.file, "host artifact"), await realpath(hostTemp.file));
    assert.equal(await resolvePrivateArtifactPath(runnerTemp.file, "runner artifact"), await realpath(runnerTemp.file));
  } finally {
    await Promise.all([
      rm(hostTemp.directory, { recursive: true, force: true }),
      rm(runnerTemp.directory, { recursive: true, force: true }),
    ]);
  }
});

test("rejects repository files, directories, and symlinks as private artifacts", async () => {
  const fixture = await temporaryFile(tmpdir(), "arrive-within-artifact-path-test-");
  const link = path.join(fixture.directory, "artifact-link.json");
  await symlink(fixture.file, link);
  try {
    const repositoryFixture = path.join(ROOT, "capture-source-inputs.json");
    await assert.rejects(
      resolvePrivateArtifactPath(repositoryFixture, "repository file", [fixture.directory]),
      /approved private temporary directory/,
    );
    await assert.rejects(resolvePrivateArtifactPath(fixture.directory, "directory"), /regular file/);
    await assert.rejects(resolvePrivateArtifactPath(link, "symlink"), /regular file/);
    await assert.rejects(resolvePrivateArtifactPath("relative.json", "relative path"), /absolute path/);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
