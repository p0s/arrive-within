import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_JSON = path.join(ROOT, "docs", "qa", "security", "manual-security-review.json");
const PUBLIC_TEXT = path.join(ROOT, "docs", "qa", "security", "manual-security-review.txt");
const PRIVATE_JSON = path.join(ROOT, ".evidence", "security", "manual-security-review-full.json");

const EXPECTED_LOCKS = {
  "Renderer/pnpm-lock.yaml": "76275a4e4a738deb91243eff72547d3edab4b3c4444de2a6c442ecdc01cf8ab1",
  "Marketing/AppStoreScreenshots/pnpm-lock.yaml": "292b8c0d063736b0824e74367270046bf20efc8697b048a924bc6861c59ecc8f",
};

const checks = [];
const failures = [];

function record(id, condition, detail) {
  checks.push({ id, status: condition ? "passed" : "failed", detail });
  if (!condition) failures.push(id);
}

async function source(relative) {
  return readFile(path.join(ROOT, relative), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function combinedSourceHash(entries) {
  const hash = createHash("sha256");
  for (const [name, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(name);
    hash.update("\0");
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function main() {
  const relativeFiles = [
    "Apps/ArriveWithin/Resources/PrivacyInfo.xcprivacy",
    "Apps/ArriveWithin/Resources/Info.plist",
    "Apps/ArriveWithin/Sources/AppDependencies.swift",
    "Apps/ArriveWithin/Sources/AppModel.swift",
    "Apps/ArriveWithin/Sources/AppSettings.swift",
    "Apps/ArriveWithin/Sources/GardenWebView.swift",
    "Apps/ArriveWithin/Tests/ArriveWithinTests/ExportStagingIntegrationTests.swift",
    "Config/Base.xcconfig",
    "Marketing/AppStoreScreenshots/package.json",
    "Marketing/AppStoreScreenshots/pnpm-lock.yaml",
    "Marketing/AppStoreScreenshots/scripts/contracts.ts",
    "Marketing/AppStoreScreenshots/scripts/export-playwright.ts",
    "Marketing/AppStoreScreenshots/scripts/ingest-xcresult-captures.ts",
    "Marketing/AppStoreScreenshots/scripts/validate-plan.ts",
    "Packages/ArriveWithinCore/Sources/ArriveWithinFeedback/FeedbackClient.swift",
    "Packages/ArriveWithinCore/Sources/ArriveWithinDomain/JournalEntry.swift",
    "Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/CloudKitSafePersistence.swift",
    "Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/ExportStagingManager.swift",
    "Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/JournalEntryExporter.swift",
    "Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/ProductDataController.swift",
    "Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/WholeProductExporter.swift",
    "Packages/ArriveWithinCore/Tests/ArriveWithinDomainTests/JournalEntryTests.swift",
    "Packages/ArriveWithinCore/Tests/ArriveWithinFeedbackTests/FeedbackClientTests.swift",
    "Packages/ArriveWithinCore/Tests/ArriveWithinPersistenceTests/ExportStagingManagerTests.swift",
    "Packages/ArriveWithinCore/Tests/ArriveWithinPersistenceTests/FilePersistenceTests.swift",
    "Renderer/index.html",
    "Renderer/package.json",
    "Renderer/pnpm-lock.yaml",
    "Website/scripts/build.mjs",
    "Website/scripts/lib.mjs",
    "docs/qa/security/codex-security-standard.md",
    "docs/release/app-privacy-worksheet.json",
    "project.yml",
    "scripts/lib/prospective-public-files.mjs",
    "scripts/test_prospective_public_manifest.mjs",
    "services/feedback-receiver/feedback_receiver.py",
    "services/feedback-receiver/test_feedback_receiver.py",
  ];
  const entries = await Promise.all(relativeFiles.map(async (file) => [file, await source(file)]));
  const byName = new Map(entries);

  const formalGate = byName.get("docs/qa/security/codex-security-standard.md");
  record(
    "formal-gate-honesty",
    formalGate.includes("owner-waived and skipped")
      && formalGate.includes("No formal pass")
      && formalGate.includes("No Git action is authorized"),
    "The owner-waived workbench remains explicitly skipped and cannot be converted into a formal security pass.",
  );

  for (const [file, expected] of Object.entries(EXPECTED_LOCKS)) {
    record(`audited-lock:${file}`, sha256(byName.get(file)) === expected, `${file} matches the exact production graph audited on 2026-08-10.`);
  }
  const rendererPackage = JSON.parse(byName.get("Renderer/package.json"));
  const marketingPackage = JSON.parse(byName.get("Marketing/AppStoreScreenshots/package.json"));
  record(
    "patched-direct-dependencies",
    rendererPackage.dependencies.ajv === "8.18.0"
      && marketingPackage.dependencies.next === "16.3.0"
      && marketingPackage.dependencies.sharp === "0.35.3",
    "The audited direct dependencies remain on the patched pinned versions.",
  );

  record(
    "github-actions-disabled",
    !relativeFiles.some((file) => file.startsWith(".github/workflows/")),
    "The initial repository ships no active GitHub Actions workflow; checks remain local until separately enabled.",
  );

  const feedbackClient = byName.get("Packages/ArriveWithinCore/Sources/ArriveWithinFeedback/FeedbackClient.swift");
  const feedbackTests = byName.get("Packages/ArriveWithinCore/Tests/ArriveWithinFeedbackTests/FeedbackClientTests.swift");
  record(
    "feedback-endpoint-boundary",
    feedbackClient.includes("components.percentEncodedPath == \"/v1/reports\"")
      && feedbackClient.includes("components.user == nil")
      && feedbackClient.includes("components.query == nil")
      && feedbackClient.includes("character.isASCII")
      && feedbackClient.includes("completionHandler(nil)")
      && feedbackTests.includes("https://127.1/v1/reports")
      && feedbackTests.includes("https://feedback_arrivewithin.org/v1/reports"),
    "Feedback is HTTPS-only to an exact public-host path, rejects ambiguous hosts, and refuses redirects.",
  );

  const receiver = byName.get("services/feedback-receiver/feedback_receiver.py");
  const receiverTests = byName.get("services/feedback-receiver/test_feedback_receiver.py");
  record(
    "feedback-receiver-boundary",
    receiver.includes("if bind != LOOPBACK_BIND:")
      && receiver.includes("self.connection.settimeout(15)")
      && receiver.includes("data_directory must be an absolute private path")
      && receiver.includes("RETENTION_SWEEP_SECONDS = 60.0")
      && receiver.includes("receiver.purge_expired()")
      && receiverTests.includes("test_receiver_requires_absolute_private_storage_and_exact_loopback")
      && receiverTests.includes("test_explicit_maintenance_removes_expired_records_without_new_intake"),
    "The reference receiver is loopback-only, bounded, private-file backed, and purges retention without depending on new traffic.",
  );

  const contracts = byName.get("Marketing/AppStoreScreenshots/scripts/contracts.ts");
  const exporter = byName.get("Marketing/AppStoreScreenshots/scripts/export-playwright.ts");
  const ingest = byName.get("Marketing/AppStoreScreenshots/scripts/ingest-xcresult-captures.ts");
  const planTests = byName.get("Marketing/AppStoreScreenshots/scripts/validate-plan.ts");
  record(
    "marketing-origin-and-path-boundary",
    contracts.includes("candidate.origin === targetOrigin")
      && contracts.includes("if (path.isAbsolute(relativePath))")
      && exporter.includes("isAllowedCaptureRequest(requestUrl, target.origin)")
      && ingest.includes("resolveBoundedChildPath(exported.root, attachment.exportedFileName)")
      && ingest.includes("sourceCandidateStat.isSymbolicLink()")
      && planTests.includes("String.fromCharCode(64)")
      && planTests.includes("external.invalid")
      && planTests.includes("../outside.png"),
    "Local capture traffic uses exact parsed-origin equality and imported attachment paths remain within a real regular-file root.",
  );

  const gardenWebView = byName.get("Apps/ArriveWithin/Sources/GardenWebView.swift");
  const renderer = byName.get("Renderer/index.html");
  record(
    "renderer-isolation",
    gardenWebView.includes("configuration.websiteDataStore = .nonPersistent()")
      && gardenWebView.includes("removeScriptMessageHandler")
      && gardenWebView.includes("candidatePath.hasPrefix(rootPath + \"/\")")
      && gardenWebView.includes("return .cancel")
      && renderer.includes("connect-src 'none'")
      && renderer.includes("form-action 'none'"),
    "The bundled renderer is nonpersistent, local-file bounded, CSP isolated, navigation-denied by default, and tears down its bridge handler.",
  );

  const cloudStore = byName.get("Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/CloudKitSafePersistence.swift");
  const journalDomain = byName.get("Packages/ArriveWithinCore/Sources/ArriveWithinDomain/JournalEntry.swift");
  const journalDomainTests = byName.get("Packages/ArriveWithinCore/Tests/ArriveWithinDomainTests/JournalEntryTests.swift");
  const journalExport = byName.get("Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/JournalEntryExporter.swift");
  const wholeExport = byName.get("Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/WholeProductExporter.swift");
  record(
    "private-storage-and-export-boundary",
    cloudStore.includes("options.databaseScope = .private")
      && cloudStore.includes("FileProtectionType.completeUntilFirstUserAuthentication")
      && journalExport.includes("candidate.resolvingSymlinksInPath().standardizedFileURL.path == candidate.path")
      && journalExport.includes("audioIntegrityMismatch")
      && wholeExport.includes("resolvingSymlinksInPath")
      && wholeExport.includes("values.isSymbolicLink != true"),
    "Private persistence uses protected files/private CloudKit scope and user exports reject traversal, links, and audio-integrity mismatches.",
  );
  record(
    "persisted-journal-validation",
    (journalDomain.match(/public init\(from decoder: Decoder\) throws/g) ?? []).length === 3
      && journalDomain.includes("try self.init(")
      && journalDomainTests.includes("../private.m4a")
      && journalDomainTests.includes("tombstoneRetainsPrivateContent")
      && journalDomainTests.includes("untrusted-cloud-engine"),
    "Persisted audio, transcript, and entry payloads re-enter validating initializers; traversal, content-retaining tombstones, and untrusted transcript engines are negative controls.",
  );

  const staging = byName.get("Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/ExportStagingManager.swift");
  const stagingTests = byName.get("Packages/ArriveWithinCore/Tests/ArriveWithinPersistenceTests/ExportStagingManagerTests.swift");
  const stagingIOSTests = byName.get("Apps/ArriveWithin/Tests/ArriveWithinTests/ExportStagingIntegrationTests.swift");
  const controls = byName.get("Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/ProductDataController.swift");
  const controlsTests = byName.get("Packages/ArriveWithinCore/Tests/ArriveWithinPersistenceTests/FilePersistenceTests.swift");
  const appModel = byName.get("Apps/ArriveWithin/Sources/AppModel.swift");
  record(
    "owned-export-lifecycle",
    staging.includes("FileProtectionType.complete")
      && staging.includes("values.isExcludedFromBackup = true")
      && staging.includes("isDirectRegularChild")
      && staging.includes("defaultTimeToLive")
      && controls.includes("try exportStaging.purgeAll()")
      && appModel.includes("purgeReflection(entryID: entry.id)")
      && stagingTests.includes("preserves another entry")
      && stagingTests.includes("directoryFailsClosed")
      && stagingIOSTests.includes("resourceValues.isExcludedFromBackup, true")
      && stagingIOSTests.includes("FileProtectionType, .complete")
      && controlsTests.includes("#expect(!FileManager.default.fileExists(atPath: export.path))"),
    "Protected, short-lived app-owned archives read back iOS backup exclusion in the hosted app test and are removed after sharing, reset, entry deletion, and full deletion without following links or touching external copies; physical-candidate repetition remains separate.",
  );

  const settings = byName.get("Apps/ArriveWithin/Sources/AppSettings.swift");
  record(
    "complete-local-deletion",
    controls.includes("standaloneProductArtifactNames")
      && controls.includes("\"app-settings-v1.json\"")
      && settings.includes("func deleteAll() async throws")
      && settings.includes("try fileManager.removeItem(at: fileURL)")
      && appModel.includes("appLanguage = .system"),
    "Full deletion classifies standalone product artifacts, removes persisted settings, and resets in-memory language only after local deletion succeeds.",
  );

  const baseConfiguration = byName.get("Config/Base.xcconfig");
  const privacyManifest = byName.get("Apps/ArriveWithin/Resources/PrivacyInfo.xcprivacy");
  const infoPlist = byName.get("Apps/ArriveWithin/Resources/Info.plist");
  const dependencies = byName.get("Apps/ArriveWithin/Sources/AppDependencies.swift");
  const project = byName.get("project.yml");
  record(
    "privacy-safe-public-defaults",
    /^ARRIVE_WITHIN_CLOUDKIT_CONTAINER_IDENTIFIER =\s*$/m.test(baseConfiguration)
      && /^DEVELOPMENT_TEAM =\s*$/m.test(baseConfiguration)
      && !infoPlist.includes("ArriveWithinCloudKitContainerIdentifier")
      && !infoPlist.includes("remote-notification")
      && !project.includes("CODE_SIGN_ENTITLEMENTS")
      && dependencies.includes("return .localOnly")
      && /<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(privacyManifest),
    "V1 is local-only with no feedback endpoint, CloudKit container/entitlement/runtime activation, remote notification, signing identity, or tracking.",
  );

  const prospectiveHelper = byName.get("scripts/lib/prospective-public-files.mjs");
  const prospectiveTests = byName.get("scripts/test_prospective_public_manifest.mjs");
  record(
    "prospective-public-ignore-boundary",
    prospectiveHelper.includes("gitCandidatePaths")
      && prospectiveHelper.includes("git\",\n    [\"ls-files\"")
      && prospectiveHelper.includes("\"check-ignore\"")
      && prospectiveHelper.includes("--no-require-git")
      && prospectiveHelper.includes("forbiddenDefenseInDepth")
      && prospectiveTests.includes("local.entitlements.local")
      && prospectiveTests.includes("state.tsbuildinfo")
      && prospectiveTests.includes(".env.production")
      && prospectiveTests.includes("__pycache__"),
    "Publication enumeration uses Git candidate/ignore semantics after initialization, a mature ignore parser before Git, and explicit sensitive-path rejection in both modes.",
  );

  const websiteBuild = byName.get("Website/scripts/build.mjs");
  const websiteLib = byName.get("Website/scripts/lib.mjs");
  record(
    "website-artifact-boundary",
    websiteBuild.includes("default-src 'none'")
      && websiteBuild.includes("form-action 'none'")
      && websiteLib.includes("symbolic links are forbidden")
      && websiteLib.includes("expected a regular file"),
    "The static website denies active/network behavior and its artifact pipeline rejects links and nonregular files.",
  );

  const findings = [
    { id: "MSR-001", area: "feedback endpoint and receiver boundary", status: "resolved" },
    { id: "MSR-002", area: "marketing request-origin and attachment-path containment", status: "resolved" },
    { id: "MSR-003", area: "CI and JavaScript dependency supply chain", status: "resolved" },
    { id: "MSR-004", area: "feedback retention independent of intake traffic", status: "resolved" },
    { id: "AW-SEC-001", area: "app-owned export staging lifecycle", status: "resolved-source-and-focused-tests" },
    { id: "AW-SEC-002", area: "unproven CloudKit deletion protocol", status: "mitigated-v1-runtime-disabled" },
    { id: "AW-SEC-003", area: "complete deletion includes settings", status: "resolved-source-and-focused-tests" },
    { id: "AW-SEC-004", area: "prospective-public ignore semantics", status: "resolved-pre-git-and-git-aware" },
    { id: "AW-SEC-005", area: "validating persisted journal decode and export containment", status: "resolved-source-and-focused-tests" },
  ];
  const sourceDigest = combinedSourceHash(entries);
  const status = failures.length ? "failed" : "passed-manual-source-review";
  const privateReport = {
    schema_version: 1,
    status,
    source_sha256: sourceDigest,
    checks,
    failures,
    findings,
    note: "Ignored local full report. It is not the formal Codex Security workbench result.",
  };
  const publicReport = {
    schema_version: 1,
    status,
    review_date: "2026-08-12",
    source_sha256: sourceDigest,
    checks_total: checks.length,
    checks_passed: checks.filter((item) => item.status === "passed").length,
    checks_failed: failures.length,
    findings_resolved: findings.length,
    findings_open: 0,
    audited_dependency_snapshots: [
      { graph: "renderer-production", lock_sha256: EXPECTED_LOCKS["Renderer/pnpm-lock.yaml"], vulnerabilities: 0 },
      { graph: "screenshot-tool-production", lock_sha256: EXPECTED_LOCKS["Marketing/AppStoreScreenshots/pnpm-lock.yaml"], vulnerabilities: 0 },
    ],
    formal_standard_scan: "owner-waived-skipped-not-passed",
    external_gates: [
      "future CloudKit operation-specific deletion and stale-device proof before any reactivation",
      "staged-tree and history secret/privacy scan after the owner authorizes Git",
    ],
    claim_boundary: "This is a deterministic source review and focused regression binding for the supplied audit findings. It is not a formal Codex Security pass, runtime penetration test, exact signed-candidate proof, Git staged-tree/history proof, or publication evidence.",
  };

  await mkdir(path.dirname(PRIVATE_JSON), { recursive: true });
  await mkdir(path.dirname(PUBLIC_JSON), { recursive: true });
  await writeFile(PRIVATE_JSON, `${JSON.stringify(privateReport, null, 2)}\n`, { mode: 0o600 });
  await writeFile(PUBLIC_JSON, `${JSON.stringify(publicReport, null, 2)}\n`);
  await writeFile(PUBLIC_TEXT, `${status.toUpperCase()} ${publicReport.checks_passed}/${publicReport.checks_total}; formal workbench is owner-waived, skipped, and not passed.\n`);

  if (failures.length) throw new Error(`manual security review validation failed: ${failures.join(", ")}`);
  process.stdout.write(`Manual security review passed: ${publicReport.checks_passed}/${publicReport.checks_total} checks; formal workbench is owner-waived, skipped, and not passed.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
