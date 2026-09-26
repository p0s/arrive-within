import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { assertCaptureSourceCommit } from "./capture-source-commit";

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "arrive-within-capture-source-git-"));
  const repository = path.join(root, "repo");
  const keyPath = path.join(root, "signing-key");
  const allowedSignersPath = path.join(root, "allowed-signers");
  const identity = ["capture-fixture", "example.test"].join("@");

  function runGit(args: string[]): string {
    return execFileSync("git", args, { cwd: repository, encoding: "utf8" });
  }

  try {
    execFileSync("git", ["init", "--quiet", repository], { encoding: "utf8" });
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", identity, "-f", keyPath], {
      encoding: "utf8",
    });
    const publicKey = (await readFile(`${keyPath}.pub`, "utf8")).trim().split(/\s+/);
    await writeFile(allowedSignersPath, `${identity} ${publicKey[0]} ${publicKey[1]}\n`);
    for (const [key, value] of Object.entries({
      "user.name": "Capture Source Fixture",
      "user.email": identity,
      "user.signingkey": keyPath,
      "commit.gpgSign": "true",
      "gpg.format": "ssh",
      "gpg.ssh.allowedSignersFile": allowedSignersPath,
    })) runGit(["config", key, value]);

    await writeFile(path.join(repository, "app-source.swift"), "let version = 1\n");
    runGit(["add", "app-source.swift"]);
    runGit(["commit", "--quiet", "-m", "signed capture source A"]);
    const sourceA = runGit(["rev-parse", "HEAD"]).trim();
    const sourcePaths = new Set(["app-source.swift"]);
    assert.equal(assertCaptureSourceCommit(repository, sourceA, sourcePaths), sourceA);

    await writeFile(path.join(repository, "screenshot-evidence.json"), "{}\n");
    runGit(["add", "screenshot-evidence.json"]);
    runGit(["commit", "--quiet", "-m", "signed evidence-only descendant B"]);
    const evidenceB = runGit(["rev-parse", "HEAD"]).trim();
    assert.equal(assertCaptureSourceCommit(repository, sourceA, sourcePaths), evidenceB);

    await writeFile(path.join(repository, "app-source.swift"), "let version = 2\n");
    runGit(["add", "app-source.swift"]);
    runGit(["commit", "--quiet", "-m", "signed app-source descendant C"]);
    assert.throws(
      () => assertCaptureSourceCommit(repository, sourceA, sourcePaths),
      /changed a captured app source input/,
      "signed descendants that change app inputs must invalidate the capture evidence",
    );

    process.stdout.write("Capture source commit contract passed: signed evidence-only descendants pass; app-source descendants fail.\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
