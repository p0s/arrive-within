import path from "node:path";

export type GeneratedProjectBinding = {
  xcodegen_version: "2.46.0";
  project_spec_sha256: string;
  project_tree_sha256: string;
};

export type PhysicalBuildProjectBinding = GeneratedProjectBinding & { sha256: string };

type SourceBinding = {
  source_commit: string;
  source_revision: string;
  source_manifest_path: string;
  source_manifest_sha256: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sha256Pattern = /^[a-f0-9]{64}$/;

export function parseBuildAdapterBindingSummary(output: string, receiptSha256: string): {
  binding_path: string;
  binding_sha256: string;
} {
  const value: unknown = JSON.parse(output);
  if (!isRecord(value)) throw new Error("build adapter output must be an object");
  const keys = Object.keys(value).sort().join(",");
  if (
    keys !== "binding_path,binding_sha256,receipt_sha256,schema_version" ||
    value.schema_version !== 1 || typeof value.binding_path !== "string" || !path.isAbsolute(value.binding_path) ||
    typeof value.binding_sha256 !== "string" || !sha256Pattern.test(value.binding_sha256) ||
    value.receipt_sha256 !== receiptSha256
  ) throw new Error("build adapter output does not bind one project sidecar to the exact build receipt");
  return { binding_path: value.binding_path, binding_sha256: value.binding_sha256 };
}

export function validateProjectBindingRecord(
  value: unknown,
  actualSha256: string,
  receiptSha256: string,
  source: SourceBinding,
  currentProject: GeneratedProjectBinding,
): PhysicalBuildProjectBinding {
  if (!isRecord(value)) throw new Error("project-binding sidecar must be an object");
  const keys = Object.keys(value).sort().join(",");
  const project = value.generated_project;
  if (!isRecord(project)) throw new Error("project-binding sidecar lacks generated project proof");
  const projectKeys = Object.keys(project).sort().join(",");
  if (
    keys !== "build_receipt_sha256,generated_project,schema_version,source_commit,source_manifest_path,source_manifest_sha256,source_revision" ||
    projectKeys !== "project_spec_sha256,project_tree_sha256,xcodegen_version" ||
    value.schema_version !== 1 || !sha256Pattern.test(actualSha256) ||
    value.build_receipt_sha256 !== receiptSha256 || value.source_commit !== source.source_commit ||
    value.source_revision !== source.source_revision || value.source_manifest_path !== source.source_manifest_path ||
    value.source_manifest_sha256 !== source.source_manifest_sha256 ||
    project.xcodegen_version !== currentProject.xcodegen_version ||
    project.project_spec_sha256 !== currentProject.project_spec_sha256 ||
    project.project_tree_sha256 !== currentProject.project_tree_sha256 ||
    typeof project.project_spec_sha256 !== "string" || !sha256Pattern.test(project.project_spec_sha256) ||
    typeof project.project_tree_sha256 !== "string" || !sha256Pattern.test(project.project_tree_sha256)
  ) throw new Error("project-binding sidecar does not match the signed source, receipt, and current generated project");
  return {
    sha256: actualSha256,
    xcodegen_version: currentProject.xcodegen_version,
    project_spec_sha256: currentProject.project_spec_sha256,
    project_tree_sha256: currentProject.project_tree_sha256,
  };
}
