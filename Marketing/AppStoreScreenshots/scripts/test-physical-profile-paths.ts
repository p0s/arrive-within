import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { assertCaptureStatusBarProfile, CAPTURE_STATUS_BAR_PROFILE } from "./physical-capture-provenance";
import { resolveProjectRegularFile } from "./physical-profile-paths";

const projectRoot = path.resolve(process.cwd(), "../..");

async function main(): Promise<void> {
  const profile = JSON.parse(await readFile(path.join(projectRoot, "docs/qa/verification-profile.json"), "utf8")) as {
    checks?: { physical?: Array<{ report?: { validator?: unknown } }> };
  };
  const validator = profile.checks?.physical?.find((check) => typeof check.report?.validator === "string")?.report?.validator;
  assert.equal(typeof validator, "string", "the physical verification profile must declare report validators");
  const resolved = await resolveProjectRegularFile(projectRoot, validator);
  await access(resolved);
  assert.ok(resolved.startsWith(`${projectRoot}${path.sep}`));
  await assert.rejects(
    () => resolveProjectRegularFile(projectRoot, "../outside.py"),
    /safe project-relative path/,
  );

  assert.doesNotThrow(() => assertCaptureStatusBarProfile(CAPTURE_STATUS_BAR_PROFILE));
  assert.throws(
    () => assertCaptureStatusBarProfile("Actual visible system status; no status-bar override."),
    /missing or inconsistent/,
    "the former producer wording must not satisfy the current validator contract",
  );

  process.stdout.write("Physical capture integration passed: profile validator resolves inside the repo and status-bar producer/validator share one exact contract.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
