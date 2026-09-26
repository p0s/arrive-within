import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  parseBuildAdapterBindingSummary,
  validateProjectBindingRecord,
  type GeneratedProjectBinding,
} from "./physical-build-provenance";

const receiptSha = "a".repeat(64);
const bindingSha = "b".repeat(64);
const runnerTempRoot = path.join(path.sep, "private", "tmp");
const bindingPath = path.join(runnerTempRoot, "capture-project-binding.json");
const source = {
  source_commit: "c".repeat(40),
  source_revision: "d".repeat(64),
  source_manifest_path: "capture-source-manifest-v1.0.2-build-19.json",
  source_manifest_sha256: "e".repeat(64),
};
const project: GeneratedProjectBinding = {
  xcodegen_version: "2.46.0",
  project_spec_sha256: "f".repeat(64),
  project_tree_sha256: "1".repeat(64),
};
const sidecar = () => ({
  schema_version: 1,
  ...source,
  build_receipt_sha256: receiptSha,
  generated_project: { ...project },
});

test("adapter summary binds one absolute sidecar to the exact build receipt", () => {
  const summary = JSON.stringify({
    schema_version: 1,
    receipt_sha256: receiptSha,
    binding_path: bindingPath,
    binding_sha256: bindingSha,
  });
  assert.deepEqual(parseBuildAdapterBindingSummary(summary, receiptSha), {
    binding_path: bindingPath,
    binding_sha256: bindingSha,
  });
  assert.throws(() => parseBuildAdapterBindingSummary(summary, "9".repeat(64)), /exact build receipt/);
  assert.throws(() => parseBuildAdapterBindingSummary(summary.replace(`${runnerTempRoot}${path.sep}`, ""), receiptSha), /exact build receipt/);
  assert.throws(() => parseBuildAdapterBindingSummary(summary.replace("\"binding_sha256\":\"" + bindingSha, "\"unexpected\":true,\"binding_sha256\":\"" + bindingSha), receiptSha), /exact build receipt/);
});

test("project sidecar binds source, manifest, receipt, and generated project", () => {
  assert.deepEqual(validateProjectBindingRecord(sidecar(), bindingSha, receiptSha, source, project), {
    sha256: bindingSha,
    ...project,
  });
});

test("project sidecar rejects stale source, receipt, and generated project records", () => {
  const wrongCommit = sidecar();
  wrongCommit.source_commit = "9".repeat(40);
  assert.throws(() => validateProjectBindingRecord(wrongCommit, bindingSha, receiptSha, source, project), /does not match/);

  const wrongReceipt = sidecar();
  wrongReceipt.build_receipt_sha256 = "8".repeat(64);
  assert.throws(() => validateProjectBindingRecord(wrongReceipt, bindingSha, receiptSha, source, project), /does not match/);

  const wrongProject = sidecar();
  wrongProject.generated_project.project_tree_sha256 = "7".repeat(64);
  assert.throws(() => validateProjectBindingRecord(wrongProject, bindingSha, receiptSha, source, project), /does not match/);

  assert.throws(() => validateProjectBindingRecord({ ...sidecar(), local_path: runnerTempRoot }, bindingSha, receiptSha, source, project), /does not match/);
  assert.throws(() => validateProjectBindingRecord(sidecar(), "bad-hash", receiptSha, source, project), /does not match/);
});
