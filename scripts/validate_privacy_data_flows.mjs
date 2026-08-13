import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_JSON = path.join(ROOT, "docs", "qa", "privacy", "data-flow-audit.json");
const PUBLIC_TEXT = path.join(ROOT, "docs", "qa", "privacy", "data-flow-audit.txt");
const PRIVATE_JSON = path.join(ROOT, ".evidence", "privacy", "data-flow-audit-full.json");

const checks = [];
const failures = [];
function record(id, condition, detail) {
  checks.push({ id, status: condition ? "passed" : "failed", detail });
  if (!condition) failures.push(id);
}

async function text(relative) {
  return readFile(path.join(ROOT, relative), "utf8");
}

async function filesBelow(relative, extensions = null) {
  const base = path.join(ROOT, relative);
  const files = [];
  async function walk(directory, prefix = "") {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relativePath = path.join(prefix, entry.name).split(path.sep).join("/");
      const absolute = path.join(directory, entry.name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new Error(`symlink is outside the privacy source contract: ${relative}/${relativePath}`);
      if (entry.isDirectory()) await walk(absolute, relativePath);
      else if (entry.isFile() && (!extensions || extensions.has(path.extname(entry.name)))) files.push(`${relative}/${relativePath}`);
    }
  }
  await walk(base);
  return files;
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function sourceHash(entries) {
  const hash = createHash("sha256");
  for (const [name, value] of entries.sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(name);
    hash.update("\0");
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function main() {
  const swiftFiles = [
    ...await filesBelow("Apps/ArriveWithin/Sources", new Set([".swift"])),
    ...await filesBelow("Packages/ArriveWithinCore/Sources", new Set([".swift"])),
  ];
  const swiftEntries = await Promise.all(swiftFiles.map(async (file) => [file, await text(file)]));
  const combinedSwift = swiftEntries.map(([file, source]) => `${file}\0${source}`).join("\0");

  const networkFiles = swiftEntries
    .filter(([, source]) => /\bURLSession(?:Configuration|Task|\b)|\bdata\(for:\s*request\)/.test(source))
    .map(([file]) => file);
  record(
    "network-shipping-path-absent",
    JSON.stringify(sorted(networkFiles)) === JSON.stringify(["Packages/ArriveWithinCore/Sources/ArriveWithinFeedback/FeedbackClient.swift"]),
    "The future feedback package is isolated source; the app target must not link it."
  );
  record(
    "tracking-sdk-absence",
    !/\b(?:import\s+(?:AdSupport|AppTrackingTransparency)|ATTrackingManager|ASIdentifierManager|FirebaseAnalytics|PostHog|Mixpanel|Segment|Adjust|AppsFlyer)\b/.test(combinedSwift),
    "Shipping Swift contains no ATT, advertising identifier, analytics, attribution, or tracking SDK path."
  );
  record("clipboard-absence", !/\bUIPasteboard\b/.test(combinedSwift), "Shipping Swift never reads the clipboard.");
  record("runtime-ai-absence", !/\b(?:AVSpeechSynthesizer|SFSafariViewController|MLModel|OpenAI)\b/.test(combinedSwift), "Shipping Swift contains no runtime narration TTS, browser upload, or external AI client.");

  const packageSource = await text("Packages/ArriveWithinCore/Package.swift");
  record(
    "feedback-target-isolation",
    /\.target\(name:\s*"ArriveWithinFeedback"\)/.test(packageSource)
      && !/\.target\(\s*name:\s*"ArriveWithinFeedback",\s*dependencies:/s.test(packageSource),
    "ArriveWithinFeedback has no dependency on domain, persistence, journal, renderer, audio, or CloudKit modules."
  );

  const feedbackModels = await text("Packages/ArriveWithinCore/Sources/ArriveWithinFeedback/FeedbackModels.swift");
  const reportBlock = feedbackModels.match(/public struct FeedbackReport[\s\S]*?enum CodingKeys/)?.[0] ?? "";
  const reportFields = [...reportBlock.matchAll(/public let ([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]);
  record(
    "feedback-report-allowlist",
    JSON.stringify(sorted(reportFields)) === JSON.stringify(sorted(["reportID", "app", "category", "message", "replyEmail", "appContext"])),
    "The immutable report model contains only the documented explicit fields."
  );
  const contextBlock = feedbackModels.match(/public struct FeedbackAppContext[\s\S]*?public struct FeedbackReport/)?.[0] ?? "";
  const contextFields = [...contextBlock.matchAll(/public let ([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]);
  record(
    "feedback-context-allowlist",
    JSON.stringify(sorted(contextFields)) === JSON.stringify(sorted(["appVersion", "build", "operatingSystemVersion", "locale"])),
    "Opt-in context is limited to app version, build, OS version, and locale."
  );

  const feedbackClient = await text("Packages/ArriveWithinCore/Sources/ArriveWithinFeedback/FeedbackClient.swift");
  for (const [id, fragment] of [
    ["feedback-https-only", "components.scheme?.lowercased() == \"https\""],
    ["feedback-no-redirects", "completionHandler(nil)"],
    ["feedback-ephemeral-session", "URLSessionConfiguration.ephemeral"],
    ["feedback-no-cache", "configuration.urlCache = nil"],
    ["feedback-no-cookies", "configuration.httpCookieStorage = nil"],
    ["feedback-no-store-header", "request.setValue(\"no-store\", forHTTPHeaderField: \"Cache-Control\")"],
    ["feedback-idempotency", "request.setValue(report.reportID, forHTTPHeaderField: \"Idempotency-Key\")"],
    ["feedback-response-binding", "response.reportID == report.reportID"],
  ]) record(id, feedbackClient.includes(fragment), `Feedback client invariant: ${id}.`);

  const baseConfig = await text("Config/Base.xcconfig");
  const infoPlist = await text("Apps/ArriveWithin/Resources/Info.plist");
  const settingsView = await text("Apps/ArriveWithin/Sources/SettingsView.swift");
  record("v1-feedback-endpoint-absent", !infoPlist.includes("ArriveWithinFeedbackEndpointURL") && !baseConfig.includes("ARRIVE_WITHIN_FEEDBACK_ENDPOINT_URL"), "V1 contains no feedback endpoint binding.");
  record("v1-feedback-ui-absent", !settingsView.includes("FeedbackView") && !settingsView.includes("settings.feedback"), "V1 Settings exposes only Support and Privacy links.");
  record("public-cloudkit-empty", /^ARRIVE_WITHIN_CLOUDKIT_CONTAINER_IDENTIFIER =\s*$/m.test(baseConfig), "Public configuration selects local-only persistence.");
  record(
    "public-signing-empty",
    /^DEVELOPMENT_TEAM =\s*$/m.test(baseConfig)
      && /^ARRIVE_WITHIN_CODE_SIGN_ENTITLEMENTS =\s*$/m.test(baseConfig),
    "Public configuration contains no signing or entitlement binding."
  );

  const appDependencies = await text("Apps/ArriveWithin/Sources/AppDependencies.swift");
  const dataPreparationIndex = appDependencies.indexOf(
    "try AppDataDirectoryPreparer.prepare(root)"
  );
  const productStoreIndex = appDependencies.indexOf(
    "productStore = try CoreDataProductStore("
  );
  record(
    "durable-data-backup-excluded",
    appDependencies.includes("backupValues.isExcludedFromBackup = true")
      && appDependencies.includes("forKeys: [.isExcludedFromBackupKey]")
      && appDependencies.includes("forKeys: [.isDirectoryKey, .isSymbolicLinkKey]")
      && appDependencies.includes("AppDataDirectoryPreparationError.backupExclusionFailed")
      && dataPreparationIndex >= 0
      && productStoreIndex > dataPreparationIndex,
    "The validated durable app-data root is excluded from backup with launch-time readback before repositories open."
  );

  const receiver = await text("services/feedback-receiver/feedback_receiver.py");
  const receiverKeys = receiver.match(/REPORT_KEYS = \{([^}]+)\}/)?.[1]
    ?.match(/"[^"]+"/g)?.map((value) => JSON.parse(value)) ?? [];
  record(
    "receiver-field-allowlist",
    JSON.stringify(sorted(receiverKeys)) === JSON.stringify(sorted(["reportId", "app", "category", "message", "replyEmail", "appContext"])),
    "Receiver rejects unknown report fields."
  );
  for (const [id, condition] of [
    [
      "receiver-loopback-default",
      receiver.includes('LOOPBACK_BIND = "127.0.0.1"')
        && receiver.includes('serve.add_argument("--bind", default=LOOPBACK_BIND, choices=[LOOPBACK_BIND])')
        && receiver.includes("if bind != LOOPBACK_BIND:"),
    ],
    ["receiver-no-access-log", /def log_message[\s\S]*?return/.test(receiver)],
    ["receiver-private-directory", receiver.includes("directory.mkdir(mode=0o700") && receiver.includes("mode != 0o700")],
    ["receiver-private-files", receiver.includes("os.open(temporary, flags, 0o600)") && receiver.includes("os.chmod(target, 0o600)")],
    ["receiver-bounded-retention", receiver.includes("MAX_RETENTION_DAYS = 30") && receiver.includes("_purge_expired")],
    ["receiver-content-free-digest", receiver.includes('"withReplyEmail"') && receiver.includes('"withAppContext"') && !/def digest[\s\S]*?\["message"\]/.test(receiver)],
  ]) record(id, condition, `Feedback receiver invariant: ${id}.`);

  const contract = JSON.parse(await text("services/feedback-receiver/contract.json"));
  record(
    "receiver-contract",
    contract.method === "POST"
      && contract.path === "/v1/reports"
      && contract.maximum_request_bytes === 32768
      && JSON.stringify(sorted([...contract.required_fields, ...contract.optional_fields])) === JSON.stringify(sorted(["reportId", "app", "category", "message", "replyEmail", "appContext"])),
    "Machine-readable receiver contract matches the client allowlist and request bound."
  );

  const privacyManifest = await text("Apps/ArriveWithin/Resources/PrivacyInfo.xcprivacy");
  record("privacy-tracking-false", /<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(privacyManifest), "Privacy manifest declares tracking false.");
  record(
    "privacy-data-not-collected",
    /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\s*\/>/.test(privacyManifest)
      && !privacyManifest.includes("NSPrivacyCollectedDataTypeCustomerSupport")
      && !privacyManifest.includes("NSPrivacyCollectedDataTypeEmailAddress")
      && !privacyManifest.includes("NSPrivacyCollectedDataTypeOtherDiagnosticData"),
    "The exact local-only, empty-endpoint candidate declares no collected data."
  );
  record(
    "privacy-required-reason",
    privacyManifest.includes("NSPrivacyAccessedAPICategorySystemBootTime") && privacyManifest.includes("35F9.1"),
    "System uptime use has the declared required-reason category and reason."
  );
  const infoEnglish = await text("Apps/ArriveWithin/Resources/en.lproj/InfoPlist.strings");
  const infoGerman = await text("Apps/ArriveWithin/Resources/de.lproj/InfoPlist.strings");
  for (const key of ["NSMicrophoneUsageDescription", "NSSpeechRecognitionUsageDescription"]) {
    record(`localized-permission:${key}`, infoEnglish.includes(`\"${key}\"`) && infoGerman.includes(`\"${key}\"`), `${key} exists in English and German.`);
  }

  const cloudFiles = swiftEntries.filter(([, source]) => /\b(?:import CloudKit|NSPersistentCloudKitContainer)\b/.test(source)).map(([file]) => file);
  record(
    "cloudkit-one-private-store-path",
    JSON.stringify(sorted(cloudFiles)) === JSON.stringify(["Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/CloudKitSafePersistence.swift"]),
    "CloudKit code is isolated to the shared local/private persistence implementation."
  );
  const cloudStore = await text("Packages/ArriveWithinCore/Sources/ArriveWithinPersistence/CloudKitSafePersistence.swift");
  record("cloudkit-private-scope", cloudStore.includes("options.databaseScope = .private"), "Configured CloudKit uses only private database scope.");

  const rendererHTML = await text("Renderer/index.html");
  const gardenWebView = await text("Apps/ArriveWithin/Sources/GardenWebView.swift");
  record("renderer-network-denied", rendererHTML.includes("connect-src 'none'") && rendererHTML.includes("form-action 'none'"), "Bundled renderer CSP denies network and forms.");
  record(
    "renderer-webview-isolation",
    gardenWebView.includes("configuration.websiteDataStore = .nonPersistent()")
      && gardenWebView.includes("loadHTMLString(rendererResources.indexSource, baseURL: allowedDirectory)")
      && gardenWebView.includes("bundle.bundleURL")
      && gardenWebView.includes("candidatePath.hasPrefix(rootPath + \"/\")")
      && gardenWebView.includes("removeScriptMessageHandler"),
    "WKWebView is nonpersistent, app-bundle bounded, navigation allowlisted, and tears down its handler."
  );

  const websiteBuild = await text("Website/scripts/build.mjs");
  const websiteSource = await text("Website/src/content.mjs");
  record(
    "website-static-private",
    websiteBuild.includes("default-src 'none'")
      && websiteBuild.includes("form-action 'none'")
      && websiteSource.includes("No third-party analytics")
      && websiteSource.includes("Version 1.0 has no in-app feedback transmission"),
    "Website source is static, tracker-free, and explains that V1 has no feedback transmission."
  );

  const worksheet = JSON.parse(await text("docs/release/app-privacy-worksheet.json"));
  record(
    "privacy-worksheet-current-boundary",
    worksheet.mode_analysis?.local_only
      && worksheet.mode_analysis?.future_private_cloudkit
      && worksheet.mode_analysis?.future_feedback_receiver === undefined
      && !worksheet.data_inventory.some((item) => item.id === "explicit-feedback-report")
      && worksheet.tracking === false
      && worksheet.automatic_support_upload === false,
    "Privacy worksheet binds Data Not Collected to the exact local-only V1 without counting a removed feedback capability."
  );

  const project = await text("project.yml");
  record(
    "privacy-resource-source-intent",
    project.includes("Apps/ArriveWithin/Resources") && project.includes("Apps/ArriveWithin/Sources"),
    "Project generation includes the app resources and shipping source roots; exact archive packaging remains a candidate gate."
  );

  const hash = sourceHash([
    ...swiftEntries,
    ["Config/Base.xcconfig", baseConfig],
    ["Apps/ArriveWithin/Resources/PrivacyInfo.xcprivacy", privacyManifest],
    ["services/feedback-receiver/feedback_receiver.py", receiver],
    ["services/feedback-receiver/contract.json", JSON.stringify(contract)],
    ["Renderer/index.html", rendererHTML],
    ["Website/scripts/build.mjs", websiteBuild],
    ["Website/src/content.mjs", websiteSource],
    ["docs/release/app-privacy-worksheet.json", JSON.stringify(worksheet)],
  ]);

  await mkdir(path.dirname(PRIVATE_JSON), { recursive: true });
  await mkdir(path.dirname(PUBLIC_JSON), { recursive: true });
  const privateReport = {
    schema_version: 1,
    status: failures.length ? "failed" : "passed",
    source_sha256: hash,
    checks,
    failures,
    note: "Ignored local report. Never stage, package, or publish this file.",
  };
  await writeFile(PRIVATE_JSON, `${JSON.stringify(privateReport, null, 2)}\n`, { mode: 0o600 });

  const publicReport = {
    schema_version: 1,
    status: failures.length ? "failed" : "passed-source-intent",
    generated_at: null,
    generation_time_policy: "omitted-for-byte-reproducibility",
    source_sha256: hash,
    checks_total: checks.length,
    checks_passed: checks.filter((item) => item.status === "passed").length,
    checks_failed: failures.length,
    verified_boundaries: [
      "future feedback source isolated and absent from the V1 app target",
      "V1 endpoint absent and local-only store selected",
      "no tracking, analytics, ATT, clipboard, or automatic support upload path",
      "durable private app data excluded from backup with launch-time readback",
      "private CloudKit code isolated and private-scope only",
      "renderer and website network isolation",
      "conservative privacy manifest and bilingual permission-source intent",
    ],
    external_candidate_gates: [
      "future feedback privacy reconciliation before any app-target activation",
      "future private CloudKit deletion protocol, account isolation, and two-device behavior",
      "exact archive and IPA resources, frameworks, endpoints, entitlements, and encryption inspection",
      "live privacy-policy and App Store Connect answers",
    ],
    private_findings_report: "ignored-local-only",
    claim_boundary: "This is a deterministic source/data-flow audit. It is not runtime network capture, deployed-service proof, CloudKit proof, exact archive inspection, App Store reconciliation, or publication evidence.",
  };
  await writeFile(PUBLIC_JSON, `${JSON.stringify(publicReport, null, 2)}\n`);
  await writeFile(
    PUBLIC_TEXT,
    `${publicReport.status.toUpperCase()} ${publicReport.checks_passed}/${publicReport.checks_total} privacy/data-flow checks; candidate and external gates remain separate.\n`
  );

  if (failures.length) throw new Error(`privacy/data-flow validation failed: ${failures.join(", ")}`);
  process.stdout.write(`Privacy/data-flow validation passed: ${publicReport.checks_passed}/${publicReport.checks_total} source checks; external candidate gates remain open.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
