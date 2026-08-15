#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const checks = [];
const blockers = [
  "automated 84-track narration candidate library and exact package inspection",
  "owner-deferred fluent bilingual, editorial, pronunciation, and rights review remains not passed",
  "future CloudKit deletion protocol and exact-candidate two-device proof before reactivation",
  "App Review approval, storefront availability, and storefront installation readback",
  "remaining exact physical audio, performance, and assistive-technology matrices",
  "future product pushes require a fresh tracked-tree and reachable-history privacy audit",
];

function pathFromRoot(path) {
  return resolve(root, path);
}

function read(path) {
  return readFileSync(pathFromRoot(path), "utf8");
}

function json(path) {
  return JSON.parse(read(path));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256Bytes(readFileSync(pathFromRoot(path)));
}

function record(id, passed, detail) {
  checks.push({ id, passed: Boolean(passed), detail });
  if (!passed) failures.push(`${id}: ${detail}`);
}

function equal(id, actual, expected) {
  record(id, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`);
}

function countCharacters(value) {
  return Array.from(value).length;
}

function byteCount(value) {
  return Buffer.byteLength(value, "utf8");
}

function walk(path, excludedNames = new Set()) {
  const absolute = pathFromRoot(path);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [absolute];
  const files = [];
  for (const name of readdirSync(absolute).sort()) {
    if (excludedNames.has(name)) continue;
    const child = join(absolute, name);
    if (statSync(child).isDirectory()) files.push(...walk(relative(root, child), excludedNames));
    else files.push(child);
  }
  return files;
}

function parsePlist(path) {
  const result = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", pathFromRoot(path)], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`plutil failed for ${path}: ${result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

const localePaths = ["docs/release/metadata/en-US.json", "docs/release/metadata/de-DE.json"];
const localeMetadata = Object.fromEntries(localePaths.map((path) => {
  const value = json(path);
  return [value.locale, value];
}));
const shared = json("docs/release/metadata/shared.json");
const screenshotPlan = json("Marketing/AppStoreScreenshots/screenshot-plan.json");
const privacyWorksheet = json("docs/release/app-privacy-worksheet.json");
const candidate = json("docs/release/candidate.example.json");
const currentRelease = json("docs/release/current-release.example.json");
const releaseTrain = json("docs/release/release-train.json");
const privacyManifest = parsePlist("Apps/ArriveWithin/Resources/PrivacyInfo.xcprivacy");
const infoPlist = parsePlist("Apps/ArriveWithin/Resources/Info.plist");

equal("metadata.locales", Object.keys(localeMetadata).sort(), ["de-DE", "en-US"]);
equal("metadata.plan-locales", [...screenshotPlan.locales].sort(), ["de-DE", "en-US"]);
record("metadata.shared-draft", shared.state === "draft-url-bound" && shared.release_attachable === false, "shared metadata must remain non-attachable while preserving the verified public URL binding");
record("metadata.rules-date", shared.current_rules?.verified_at === "2026-08-10", "current Apple-rule verification date must be explicit");

const expectedRuleURLs = {
  app_information: "https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/",
  platform_version_information: "https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information",
  screenshot_specifications: "https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/",
  age_rating: "https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating",
  app_privacy: "https://developer.apple.com/app-store/app-privacy-details/",
  required_reason_apis: "https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype",
};
equal("metadata.rule-sources", shared.current_rules?.sources, expectedRuleURLs);

const limits = shared.current_rules?.limits ?? {};
for (const [locale, metadata] of Object.entries(localeMetadata)) {
  record(`metadata.${locale}.draft`, metadata.state === "draft-unbound" && metadata.release_attachable === false, "locale metadata must remain draft and non-attachable before an immutable candidate");
  record(`metadata.${locale}.name`, countCharacters(metadata.name) >= limits.name_characters_min && countCharacters(metadata.name) <= limits.name_characters_max, `name is ${countCharacters(metadata.name)} characters`);
  record(`metadata.${locale}.subtitle`, countCharacters(metadata.subtitle) <= limits.subtitle_characters_max, `subtitle is ${countCharacters(metadata.subtitle)} characters`);
  record(`metadata.${locale}.promotional-text`, countCharacters(metadata.promotional_text) <= limits.promotional_text_characters_max, `promotional text is ${countCharacters(metadata.promotional_text)} characters`);
  const description = metadata.description_paragraphs.join("\n\n");
  record(`metadata.${locale}.description`, countCharacters(description) <= limits.description_characters_max, `description is ${countCharacters(description)} characters`);
  record(`metadata.${locale}.keywords-bytes`, byteCount(metadata.keywords) <= limits.keywords_utf8_bytes_max, `keywords are ${byteCount(metadata.keywords)} UTF-8 bytes`);
  record(`metadata.${locale}.keywords-spacing`, !metadata.keywords.includes(", ") && !metadata.keywords.startsWith(",") && !metadata.keywords.endsWith(","), "keywords must be comma-delimited without padding");
  const terms = metadata.keywords.split(",");
  const normalizedTerms = terms.map((term) => term.toLocaleLowerCase(locale));
  record(`metadata.${locale}.keyword-length`, terms.every((term) => countCharacters(term) > limits.keyword_characters_min_exclusive), "every keyword must exceed two characters");
  record(`metadata.${locale}.keyword-duplicates`, new Set(normalizedTerms).size === normalizedTerms.length, "keyword terms must be unique");
  const privateOwnerHandle = String.fromCharCode(112, 48, 115);
  record(`metadata.${locale}.keyword-brand`, !normalizedTerms.some((term) => ["arrive", "within", "arrive within", privateOwnerHandle].includes(term)), "keywords must not duplicate app/company names");
  record(`metadata.${locale}.whats-new`, countCharacters(metadata.whats_new) <= limits.whats_new_characters_max && metadata.whats_new_applicability === "not-applicable-to-first-version-retained-as-first-update-source", "What's New must be bounded and explicitly unavailable for version 1.0");
  record(`metadata.${locale}.tester-instructions`, byteCount(metadata.tester_instructions) <= 4000, `tester instructions are ${byteCount(metadata.tester_instructions)} UTF-8 bytes`);
  record(`metadata.${locale}.review-notes`, byteCount(metadata.review_notes) <= limits.review_notes_utf8_bytes_max, `review notes are ${byteCount(metadata.review_notes)} UTF-8 bytes`);
  record(`metadata.${locale}.claim-dependencies`, Array.isArray(metadata.claim_dependencies) && metadata.claim_dependencies.length >= 3, "release-facing narration, CloudKit, and candidate claims must remain explicitly gated");
  const plannedHeadlines = screenshotPlan.slides.map((slide) => slide.headline[locale].join(" "));
  equal(`metadata.${locale}.screenshot-headlines`, metadata.screenshot_headlines, plannedHeadlines);
}

equal("metadata.urls-bound", {
  marketing_url: shared.marketing_url,
  support_url: shared.support_url,
  privacy_url: shared.privacy_url,
}, {
  marketing_url: "https://arrivewithin.com/",
  support_url: "https://psapps.xyz/arrive-within/#support",
  privacy_url: "https://psapps.xyz/arrive-within/#privacy",
});
record(
  "metadata.url-binding",
  shared.url_binding?.state === "verified-custom-domain-production-readback"
    && shared.url_binding?.verified_at === "2026-08-12"
    && shared.url_binding?.base_url === "https://arrivewithin.com"
    && shared.url_binding?.custom_domain === "arrivewithin.com"
    && shared.url_binding?.hosting?.provider === "Vercel"
    && shared.url_binding?.hosting?.plan === "Hobby"
    && shared.url_binding?.hosting?.project === "arrive-within"
    && shared.url_binding?.required_routes?.marketing === "/"
    && shared.url_binding?.required_routes?.support === "/support"
    && shared.url_binding?.required_routes?.privacy === "/privacy",
  "release URLs must remain bound to the exact verified custom-domain production readback",
);
record("metadata.age-rating-unbound", shared.age_rating?.questionnaire_state === "unreconciled-no-asc-record" && shared.age_rating?.calculated_rating === null && shared.age_rating?.made_for_kids === false, "age rating must remain questionnaire-derived, region/OS-aware, and unclaimed before live reconciliation");
record(
  "metadata.storekit-contract",
  shared.storekit_contract?.required === true
    && shared.storekit_contract?.product_id === "com.philipps.arrivewithin.garden.materialstyles"
    && shared.storekit_contract?.app_store_connect_id === "6801014376"
    && shared.storekit_contract?.type === "NON_CONSUMABLE"
    && shared.storekit_contract?.base_price?.amount === "4.99"
    && shared.storekit_contract?.base_price?.currency === "USD"
    && shared.storekit_contract?.base_price?.territory === "USA"
    && shared.storekit_contract?.family_sharable === false
    && shared.storekit_contract?.available_territories === 175
    && shared.storekit_contract?.available_in_new_territories === true
    && JSON.stringify(shared.storekit_contract?.locales) === JSON.stringify(["de-DE", "en-US"])
    && shared.storekit_contract?.app_store_connect_state === "READY_TO_SUBMIT"
    && shared.storekit_contract?.current_app_review_attachment === false,
  "StoreKit must remain one exact non-consumable Garden entitlement, configured but not attached to the in-review app version",
);
record("metadata.candidate-unbound", shared.candidate_binding === null, "metadata must not bind a moving or nonexistent candidate");

equal("screenshots.devices", screenshotPlan.devices.map(({ id, width, height }) => ({ id, width, height })), [
  { id: "iphone-6.9", width: 1320, height: 2868 },
  { id: "ipad-13", width: 2064, height: 2752 },
]);
record("screenshots.matrix", screenshotPlan.slides.length === 6 && screenshotPlan.locales.length === 2 && screenshotPlan.devices.length === 2 && screenshotPlan.expected_final_images === 24, "screenshot plan must bind the 6 x 2 x 2 matrix");

const sourceExtensions = new Set([".swift", ".plist", ".xcconfig", ".strings", ".yml", ".yaml"]);
const sourceFiles = [
  ...walk("Apps", new Set([".build"])),
  ...walk("Packages", new Set([".build", ".swiftpm"])),
  ...walk("Config"),
  pathFromRoot("project.yml"),
].filter((path) => sourceExtensions.has(extname(path)) && !path.includes("/Tests/"));
sourceFiles.splice(0, sourceFiles.length, ...sourceFiles.filter(
  (path) => !path.includes("/Sources/ArriveWithinFeedback/"),
));
sourceFiles.sort();
const shippingSource = sourceFiles.map((path) => `${relative(root, path)}\0${readFileSync(path, "utf8")}`).join("\0");

const repositoryFiles = walk(".", new Set([".build", ".pnpm-store", ".venv", "node_modules", "dist", "auditions", "model-cache", ".git"]));
const premiumStoreKitSourcePath = "Apps/ArriveWithin/Sources/PremiumGardenStyles.swift";
const premiumStoreKitSource = read(premiumStoreKitSourcePath);
const storeKitImportFiles = sourceFiles
  .filter((path) => /\bimport\s+StoreKit\b/.test(readFileSync(path, "utf8")))
  .map((path) => relative(root, path));
equal("source.storekit.import-files", storeKitImportFiles, [premiumStoreKitSourcePath]);
const storeKitAPIFiles = sourceFiles
  .filter((path) => /\b(Product\.products|Transaction\.(?:updates|currentEntitlements)|AppStore\.sync)\b/.test(readFileSync(path, "utf8")))
  .map((path) => relative(root, path));
equal("source.storekit.api-files", storeKitAPIFiles, [premiumStoreKitSourcePath]);
record("source.storekit.verified-transactions", premiumStoreKitSource.includes("case .verified(let transaction)") && premiumStoreKitSource.includes("transaction.revocationDate == nil"), "the entitlement must require verified, unrevoked StoreKit transactions");
record("source.storekit.exact-product-id", premiumStoreKitSource.includes(`static let id = "${shared.storekit_contract.product_id}"`), "the native client must use the contracted product identifier");
record("source.storekit.no-legacy-api", !/\bSKPayment\w*\b/.test(shippingSource), "legacy StoreKit payment APIs remain forbidden");
const storeKitConfigFiles = repositoryFiles
  .filter((path) => path.toLocaleLowerCase().endsWith(".storekit"))
  .map((path) => relative(root, path));
equal("source.storekit-config-files", storeKitConfigFiles, ["Config/PremiumGardenStyles.storekit"]);
const storeKitConfig = json("Config/PremiumGardenStyles.storekit");
record("source.storekit-config-one-product", storeKitConfig.products?.length === 1 && storeKitConfig.nonRenewingSubscriptions?.length === 0 && storeKitConfig.subscriptionGroups?.length === 0, "local StoreKit data must contain one product and no subscription surface");
record(
  "source.storekit-config-product",
  storeKitConfig.products?.[0]?.productID === shared.storekit_contract.product_id
    && storeKitConfig.products?.[0]?.type === "NonConsumable"
    && storeKitConfig.products?.[0]?.displayPrice === shared.storekit_contract.base_price.amount
    && storeKitConfig.products?.[0]?.familyShareable === false
    && JSON.stringify(storeKitConfig.products?.[0]?.localizations?.map(({ locale }) => locale).sort()) === JSON.stringify(["de_DE", "en_US"]),
  "local StoreKit product must mirror the exact live non-consumable contract",
);
record("source.storekit-scheme-binding", read("project.yml").includes("storeKitConfiguration: Config/PremiumGardenStyles.storekit"), "the shared development scheme must bind the exact local StoreKit configuration");

const forbiddenTrackingPatterns = [
  /\bimport\s+AppTrackingTransparency\b/,
  /\bimport\s+AdSupport\b/,
  /\bATTrackingManager\b/,
  /\bASIdentifierManager\b/,
  /\b(FirebaseAnalytics|Amplitude|Mixpanel|AppsFlyer|Adjust|FacebookSDK|Segment)\b/,
];
for (const pattern of forbiddenTrackingPatterns) {
  record(`source.tracking.${pattern.source}`, !pattern.test(shippingSource), `forbidden tracking/analytics pattern ${pattern}`);
}

const forbiddenNetworkPatterns = [
  /\bNWConnection\b/,
  /\bimport\s+Network\b/,
  /\bSFSafariViewController\b/,
];
for (const pattern of forbiddenNetworkPatterns) {
  record(`source.network.${pattern.source}`, !pattern.test(shippingSource), `custom network-client pattern ${pattern} requires explicit review`);
}
const urlSessionSourceFiles = sourceFiles
  .filter((path) => /\bURLSession\b/.test(readFileSync(path, "utf8")))
  .map((path) => relative(root, path));
equal("source.network.shipping-url-session-files", urlSessionSourceFiles, []);
const gardenWebView = read("Apps/ArriveWithin/Sources/GardenWebView.swift");
record("source.webview-nonpersistent", gardenWebView.includes("configuration.websiteDataStore = .nonPersistent()"), "renderer WebView must use a nonpersistent data store");
record(
  "source.webview-bundled-document-only",
  gardenWebView.includes("loadHTMLString(rendererResources.indexSource, baseURL: allowedDirectory)")
    && gardenWebView.includes("bundle.bundleURL")
    && gardenWebView.includes("url.isFileURL")
    && gardenWebView.includes("return .cancel"),
  "renderer document and navigation must remain bounded to its validated app-bundle directory",
);

const requiredReasonPatterns = {
  systemBootTime: /ProcessInfo\.processInfo\.systemUptime/,
  fileTimestamp: /(?:\.creationDate\b|\.modificationDate\b|\bfileModificationDate\b|\bcontentModificationDateKey\b|\bcreationDateKey\b|\b(?:stat|fstat|fstatat|lstat|getattrlist|getattrlistbulk|fgetattrlist|getattrlistat)\s*\()/,
  userDefaults: /\b(?:UserDefaults|CFPreferences)\b/,
  diskSpace: /\b(?:volumeAvailableCapacity\w*|systemFreeSize|systemSize|statfs|statvfs)\b/,
  activeKeyboards: /\b(?:activeInputModes|availableInputModes)\b/,
};
record("privacy.required-reason-system-uptime-source", requiredReasonPatterns.systemBootTime.test(shippingSource), "systemUptime must remain represented by a required-reason declaration");
record("privacy.required-reason-no-file-timestamp", !requiredReasonPatterns.fileTimestamp.test(shippingSource), "file timestamp APIs require an additional audited declaration");
record("privacy.required-reason-no-user-defaults", !requiredReasonPatterns.userDefaults.test(shippingSource), "UserDefaults/CFPreferences require an additional audited declaration");
record("privacy.required-reason-no-disk-space", !requiredReasonPatterns.diskSpace.test(shippingSource), "disk-space APIs require an additional audited declaration");
record("privacy.required-reason-no-active-keyboards", !requiredReasonPatterns.activeKeyboards.test(shippingSource), "active-keyboard APIs require an additional audited declaration");

equal("privacy.manifest-tracking", privacyManifest.NSPrivacyTracking, false);
equal("privacy.manifest-tracking-domains", privacyManifest.NSPrivacyTrackingDomains, []);
equal("privacy.manifest-collected-types", privacyManifest.NSPrivacyCollectedDataTypes, []);
equal("privacy.manifest-required-reasons", privacyManifest.NSPrivacyAccessedAPITypes, [{
  NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
  NSPrivacyAccessedAPITypeReasons: ["35F9.1"],
}]);
record("privacy.manifest-project-resource", read("project.yml").includes("path: Apps/ArriveWithin/Resources"), "PrivacyInfo.xcprivacy must remain under the app resource group; exact archive packaging is a later gate");

equal("privacy.encryption-source", infoPlist.ITSAppUsesNonExemptEncryption, false);
record("privacy.microphone-source", typeof infoPlist.NSMicrophoneUsageDescription === "string" && infoPlist.NSMicrophoneUsageDescription.length > 0, "English microphone purpose string is required");
record("privacy.speech-source", typeof infoPlist.NSSpeechRecognitionUsageDescription === "string" && infoPlist.NSSpeechRecognitionUsageDescription.length > 0, "English speech-recognition purpose string is required");
for (const locale of ["en", "de"]) {
  const strings = read(`Apps/ArriveWithin/Resources/${locale}.lproj/InfoPlist.strings`);
  record(`privacy.${locale}.microphone-localized`, strings.includes('"NSMicrophoneUsageDescription"'), `${locale} microphone purpose string must be localized`);
  record(`privacy.${locale}.speech-localized`, strings.includes('"NSSpeechRecognitionUsageDescription"'), `${locale} speech-recognition purpose string must be localized`);
}
record("privacy.cloudkit-v1-disabled", infoPlist.ArriveWithinCloudKitContainerIdentifier === undefined && !infoPlist.UIBackgroundModes.includes("remote-notification") && /return \.localOnly/.test(read("Apps/ArriveWithin/Sources/AppDependencies.swift")), "V1 remains local-only until operation-specific deletion and stale-device convergence are proven");
record("privacy.feedback-v1-absent", infoPlist.ArriveWithinFeedbackEndpointURL === undefined && !read("project.yml").includes("product: ArriveWithinFeedback") && !existsSync(pathFromRoot("Apps/ArriveWithin/Sources/FeedbackFeature.swift")), "V1 binary must not link a feedback transport, endpoint, or sending surface");
const baseConfiguration = read("Config/Base.xcconfig");
const projectSpecification = read("project.yml");
record(
  "privacy.public-signing-unbound",
  /^DEVELOPMENT_TEAM\s*=\s*$/m.test(baseConfiguration)
    && /^ARRIVE_WITHIN_CODE_SIGN_ENTITLEMENTS\s*=\s*$/m.test(baseConfiguration)
    && !projectSpecification.includes("CODE_SIGN_ENTITLEMENTS:")
    && !baseConfiguration.includes(".entitlements.local")
    && !projectSpecification.includes(".entitlements.local"),
  "public and release source contain no entitlement binding; private identifiers stay ignored",
);
record("privacy.worksheet", privacyWorksheet.tracking === false && privacyWorksheet.att_prompt === false && privacyWorksheet.custom_product_data_backend === false && privacyWorksheet.current_candidate_user_initiated_feedback_receiver === false && privacyWorksheet.automatic_support_upload === false && privacyWorksheet.data_inventory.length === 5, "App Privacy worksheet must bind the exact local-only Data Not Collected candidate");
record("privacy.data-not-collected", privacyWorksheet.current_candidate_app_privacy_answer === "Data Not Collected" && privacyWorksheet.final_gate?.status === "build7-source-binary-and-owner-publication-reconciled", "Current candidate App Privacy answer must remain Data Not Collected and bind the inspected build-7 binary plus owner-confirmed publication");
record("privacy.no-feedback-accounting", privacyWorksheet.mode_analysis?.future_feedback_receiver === undefined && !privacyWorksheet.data_inventory.some((item) => item.id === "explicit-feedback-report"), "The V1 App Privacy inventory does not count a removed feedback capability or ordinary Support link as collected data");

const gitignore = read(".gitignore");
for (const requiredIgnore of ["/SPEC.md", "/AGENTS.md", "/.codex/", "/LOCAL_*.md", "/PRIVATE_*.md", ".env*", "*.p8", "*.p12", "*.mobileprovision", "**/*.entitlements.local", "/ContentProduction/auditions/", "/ContentProduction/model-cache/", "/References/", "/.evidence/"]) {
  record(`boundary.ignore.${requiredIgnore}`, gitignore.includes(requiredIgnore), `missing strict ignore entry ${requiredIgnore}`);
}
for (const publicShippingAudio of ["!/Content/guided/**/audio.*.m4a", "!/Content/guided/**/transcript.*.vtt", "!/Content/guided/**/provenance.*.json"]) {
  record(`boundary.public-shipping-audio.${publicShippingAudio}`, gitignore.includes(publicShippingAudio), `promoted shipping narration source must not be ignored: ${publicShippingAudio}`);
}

record("candidate.template-state", candidate.schema_version === 2 && candidate.status === "template" && candidate.frozen_at === null && candidate.manifest_sha256 === null, "candidate template must use the pre-Git-capable schema without claiming a freeze");
record("candidate.source-mode", candidate.source.provenance_mode === "prospective-public-tree" && candidate.source.git_lineage_available === false && candidate.source.full_commit === null && candidate.source.branch === null && candidate.source.annotated_build_tag === null, "pre-Git candidates must bind a deterministic prospective-public tree and claim no Git lineage");
record("candidate.source-unbound", candidate.source.prospective_public_manifest_sha256 === null && candidate.source.prospective_public_tree_sha256 === null && candidate.source.prospective_public_file_count === null && candidate.source.generated_project_policy_sha256 === null && candidate.source.public_boundary_report_sha256 === null && candidate.source.previous_live_snapshot_sha256 === null, "candidate source and previous-live boundary must be exact and currently unbound");
record("candidate.deviation-schema", candidate.approved_deviations?.pre_git_candidate?.status === "owner-approved" && candidate.approved_deviations.pre_git_candidate.git_lineage_claimed === false && candidate.approved_deviations?.formal_security_and_public_history?.passed === false && candidate.approved_deviations?.human_audio_and_rights_review?.passed === false, "pre-Git and deferred-review deviations must be explicit and must never be represented as passes");
record("candidate.media-state-unbound", candidate.media_state?.narration_packaging === null && candidate.media_state?.narration_track_count === null && candidate.media_state?.narration_manifest_sha256 === null && candidate.media_state?.narration_incomplete_baseline === null && candidate.media_state?.missing_narration_fails_closed === null && candidate.media_state?.human_audio_and_rights_review_passed === false && candidate.media_state?.testflight_note_states_narration_boundary === null, "candidate media state must bind packaged narration and the truthful baseline TestFlight note without claiming deferred human review");
record("candidate.binary-unbound", candidate.binary.archive_sha256 === null && candidate.binary.ipa_sha256 === null && candidate.binary.built_info_plist_sha256 === null && candidate.binary.entitlements_sha256 === null && candidate.binary.privacy_manifest_sha256 === null, "candidate binary hashes must remain unbound");
record("candidate.signing-unbound", candidate.signing.team_id === null && candidate.signing.profile_uuid === null && candidate.signing.profile_expiry === null && candidate.signing.get_task_allow === null, "candidate signing state must remain unbound");
record("candidate.cloudkit-unbound", candidate.cloudkit.container === null && candidate.cloudkit.environment === null && candidate.cloudkit.schema_version === null, "candidate CloudKit identity must remain unbound");
record("candidate.physical-schema", ["iphone", "ipad"].every((kind) => candidate.physical_evidence?.[kind]?.hardware_model === null && candidate.physical_evidence[kind].source_manifest_sha256 === null && Array.isArray(candidate.physical_evidence[kind].scenario_ids) && Array.isArray(candidate.physical_evidence[kind].side_effects_observed)), "candidate must bind exact public-safe device, OS, source manifest, scenarios, side effects, and result");
record("current-release.unreconciled", currentRelease.schema_version === 2 && currentRelease.status === "template-unreconciled" && currentRelease.captured_at === null && currentRelease.live_version.source_manifest_sha256 === null && currentRelease.live_version.source_commit === null && currentRelease.previous_live_boundary.exists === null, "current/live boundary must not be inferred from a moving branch tip");
record("prospective-manifest.tool", existsSync(pathFromRoot("scripts/create_prospective_public_manifest.mjs")), "pre-Git candidates require a deterministic prospective-public manifest generator");
record("prospective-manifest.test", existsSync(pathFromRoot("scripts/test_prospective_public_manifest.mjs")), "the prospective-public manifest generator requires a deterministic private-boundary regression");

const expectedStages = [
  "live-reconciliation",
  "archive-export-inspect",
  "upload",
  "valid",
  "internal-group-linkage",
  "in-beta-testing",
  "candidate-install-upgrade-physical",
  "metadata-screenshots-attach",
  "app-review-submit",
  "after-approval",
  "approval-ready-for-distribution",
  "storefront-install-verify",
  "public-repository-and-release-assets",
];
equal("release-train.stages", releaseTrain.stages.map((stage) => stage.id), expectedStages);
record("release-train.order", releaseTrain.stages.every((stage, index) => stage.order === index + 1), "release stages must be fixed in exact order");
record(
  "release-train.live-reconciliation-readback",
  releaseTrain.stages[0].status === "verified-exact-app-record-signing-ready-cloudkit-v1-deferred"
    && typeof releaseTrain.stages[0].readback === "string"
    && releaseTrain.stages[0].readback.includes("exactly one matching iOS app record")
    && releaseTrain.stages[0].readback.includes("historical future-capability configuration")
    && releaseTrain.stages[0].readback.includes("binds no container")
    && releaseTrain.stages[0].readback.includes("No signing certificate was created or revoked")
    && releaseTrain.stages[1].status === "verified-through-build-7"
    && typeof releaseTrain.stages[1].readback === "string"
    && releaseTrain.stages[1].readback.includes("Build 7 was archived and exported")
    && releaseTrain.stages[1].readback.includes("no CloudKit or push entitlement")
    && releaseTrain.stages[1].readback.includes("no narration")
    && releaseTrain.stages.slice(2, 7).every((stage) => typeof stage.readback === "string")
    && typeof releaseTrain.stages[7].readback === "string"
    && releaseTrain.stages.slice(8, 10).every((stage) => typeof stage.readback === "string")
    && releaseTrain.stages.slice(10, 12).every((stage) => stage.readback === null)
    && typeof releaseTrain.stages[12].readback === "string"
    && releaseTrain.stages[12].readback.includes("canonical repository is public")
    && releaseTrain.stages[12].readback.includes("6d7ba49967f3082e39dcb0437402a97593897276")
    && releaseTrain.stages[12].readback.includes("root remains immutable reachable history")
    && releaseTrain.stages[12].readback.includes("No GitHub Actions workflow or run exists"),
  "live identity, signing readiness, V1 CloudKit disablement, and the exact selected internal build must retain honest readback",
);
record("release-train.authority", releaseTrain.stages.every((stage) => typeof stage.authorization === "string" && stage.authorization.length > 0), "every release stage must carry an explicit authorization boundary");
record("release-train.repository-authority", releaseTrain.stages.slice(0, 12).every((stage) => !stage.status.startsWith("unauthorized") && !stage.status.startsWith("prohibited")) && releaseTrain.stages[12].status === "verified-public-origin-main-signed-root" && releaseTrain.stages[12].authorization.includes("exact-existing-origin-main-push-and-public-visibility") && releaseTrain.stages[12].authorization.includes("github-actions-tags-releases-and-unrelated-repository-settings-remain-separate"), "repository authority must bind the completed signed root publication while preserving GitHub Actions, tags, releases, and unrelated settings as separate boundaries");
record(
  "release-train.candidate-unbound",
  releaseTrain.candidate_manifest === null
    && releaseTrain.status === "build-7-submitted-waiting-for-review-build-13-rejected-new-build-14-required"
    && releaseTrain.baseline_internal_testflight?.build_number === 1
    && releaseTrain.baseline_internal_testflight?.apple_processing === "VALID"
    && releaseTrain.baseline_internal_testflight?.internal_distribution === "IN_BETA_TESTING"
    && releaseTrain.baseline_internal_testflight?.media_boundary?.includes("zero packaged guided narration tracks")
    && releaseTrain.baseline_internal_testflight?.claim_boundary?.includes("Exact build 1 only")
    && releaseTrain.selected_visual_internal_testflight?.build_number === 2
    && releaseTrain.selected_visual_internal_testflight?.visual_direction === "twilight-refuge"
    && releaseTrain.selected_visual_internal_testflight?.apple_processing === "VALID"
    && releaseTrain.selected_visual_internal_testflight?.internal_distribution === "IN_BETA_TESTING"
    && releaseTrain.selected_visual_internal_testflight?.runtime_readback === "pending-owner-install-and-launch"
    && releaseTrain.selected_visual_internal_testflight?.media_boundary?.includes("zero packaged guided narration tracks")
    && releaseTrain.selected_visual_internal_testflight?.claim_boundary?.includes("Exact build 2 only")
    && releaseTrain.renderer_replacement_lane?.rejected_build?.build_number === 3
    && releaseTrain.renderer_replacement_lane?.rejected_build?.apple_processing === "VALID"
    && releaseTrain.renderer_replacement_lane?.rejected_build?.internal_distribution === "IN_BETA_TESTING"
    && releaseTrain.renderer_replacement_lane?.rejected_build?.diagnostic === "bundle-validation-failed"
    && releaseTrain.renderer_replacement_lane?.rejected_build?.disposition === "rejected"
    && releaseTrain.renderer_replacement_lane?.next_build?.build_number === 4
    && releaseTrain.renderer_replacement_lane?.next_build?.source_runtime_readback?.includes("passed 1/1")
    && releaseTrain.renderer_replacement_lane?.next_build?.apple_processing === "VALID"
    && releaseTrain.renderer_replacement_lane?.next_build?.internal_distribution === "IN_BETA_TESTING"
    && releaseTrain.renderer_replacement_lane?.next_build?.testflight_runtime_readback?.includes("owner-installed exact build 4")
    && releaseTrain.renderer_replacement_lane?.next_build?.distribution_state === "verified-valid-internal-testflight-physical-ipad-threejs"
    && releaseTrain.renderer_replacement_lane?.next_build?.media_boundary?.includes("zero packaged guided narration tracks")
    && releaseTrain.renderer_replacement_lane?.garden_first_candidate?.build_number === 5
    && releaseTrain.renderer_replacement_lane?.garden_first_candidate?.source_runtime_readback?.includes("passed 1/1")
    && releaseTrain.renderer_replacement_lane?.garden_first_candidate?.apple_processing === "VALID"
    && releaseTrain.renderer_replacement_lane?.garden_first_candidate?.testflight_runtime_readback?.includes("owner-installed exact build 5")
    && releaseTrain.renderer_replacement_lane?.garden_first_candidate?.distribution_state === "ready-for-review-submission-build-owner-verified-on-physical-ipad"
    && releaseTrain.renderer_replacement_lane?.garden_first_candidate?.media_boundary?.includes("zero packaged guided narration tracks")
    && releaseTrain.renderer_replacement_lane?.lighting_replacement_candidate?.build_number === 6
    && releaseTrain.renderer_replacement_lane?.lighting_replacement_candidate?.source_change?.includes("42 to 26")
    && releaseTrain.renderer_replacement_lane?.lighting_replacement_candidate?.physical_source_runtime_readback?.includes("both guarded EN/DE marketing capture methods pass")
    && releaseTrain.renderer_replacement_lane?.lighting_replacement_candidate?.archive_and_binary?.includes("inspected signed archive")
    && releaseTrain.renderer_replacement_lane?.lighting_replacement_candidate?.apple_processing === "VALID"
    && releaseTrain.renderer_replacement_lane?.lighting_replacement_candidate?.app_store_eligible === true
    && releaseTrain.renderer_replacement_lane?.lighting_replacement_candidate?.internal_distribution?.includes("group add succeeded")
    && releaseTrain.renderer_replacement_lane?.lighting_replacement_candidate?.physical_runtime_readback?.includes("exact version 1.0 build 6")
    && releaseTrain.renderer_replacement_lane?.lighting_replacement_candidate?.distribution_state === "apple-valid-internal-group-add-version-launch-proven-owner-visual-testflight-confirmation-pending"
    && releaseTrain.renderer_replacement_lane?.lighting_replacement_candidate?.media_boundary?.includes("zero packaged guided narration tracks")
    && releaseTrain.renderer_replacement_lane?.notice_complete_replacement_candidate?.build_number === 7
    && releaseTrain.renderer_replacement_lane?.notice_complete_replacement_candidate?.source_change?.includes("packaging exact third-party license notices")
    && releaseTrain.renderer_replacement_lane?.notice_complete_replacement_candidate?.archive_and_binary?.includes("frozen 672-file source")
    && releaseTrain.renderer_replacement_lane?.notice_complete_replacement_candidate?.archive_and_binary?.includes("no CloudKit/push entitlements")
    && releaseTrain.renderer_replacement_lane?.notice_complete_replacement_candidate?.apple_processing === "VALID"
    && releaseTrain.renderer_replacement_lane?.notice_complete_replacement_candidate?.app_store_eligible === true
    && releaseTrain.renderer_replacement_lane?.notice_complete_replacement_candidate?.internal_distribution?.includes("IN_BETA_TESTING")
    && releaseTrain.renderer_replacement_lane?.notice_complete_replacement_candidate?.physical_runtime_readback?.includes("owner directly confirmed its real Three.js Twilight Garden is good")
    && releaseTrain.renderer_replacement_lane?.notice_complete_replacement_candidate?.distribution_state === "apple-valid-app-store-eligible-in-beta-testing-physical-ipad-owner-verified"
    && releaseTrain.renderer_replacement_lane?.notice_complete_replacement_candidate?.media_boundary?.includes("zero packaged guided narration tracks"),
  "verified builds 1 through 7 and the submitted build-7 review state must remain exact while the narration-complete update is unbound",
);

record(
  "release-train.post-publication-garden-follow-up",
  releaseTrain.post_publication_garden_follow_up?.status === "deferred-until-next-editable-app-store-metadata-opportunity"
    && releaseTrain.post_publication_garden_follow_up?.submitted_artifact?.includes("must not be relabeled")
    && releaseTrain.post_publication_garden_follow_up?.current_source_boundary?.includes("not represented by the submitted build-7 App Store screenshots")
    && releaseTrain.post_publication_garden_follow_up?.required_action?.includes("current-source English/German iPhone and iPad captures")
    && releaseTrain.post_publication_garden_follow_up?.required_action?.includes("only then replace"),
  "post-publication Garden proof must keep submitted build-7 screenshots frozen and require a fresh next-opportunity recapture",
);

const sourceHashes = Object.fromEntries([
  ...localePaths,
  "docs/release/metadata/shared.json",
  "docs/release/app-privacy-worksheet.json",
  "docs/release/current-release.example.json",
  "docs/release/candidate.example.json",
  "docs/release/release-train.json",
  "Apps/ArriveWithin/Resources/PrivacyInfo.xcprivacy",
  "Apps/ArriveWithin/Resources/Info.plist",
  "Marketing/AppStoreScreenshots/screenshot-plan.json",
].map((path) => [path, sha256File(path)]));

const report = {
  schema_version: 1,
  status: failures.length === 0 ? "passed-source-contract-selected-candidate-unbound" : "failed",
  release_ready: false,
  source_contract_passed: failures.length === 0,
  candidate_bound: false,
  apple_rules_verified_at: shared.current_rules?.verified_at ?? null,
  checks_passed: checks.filter((check) => check.passed).length,
  checks_failed: failures.length,
  shipping_source_file_count: sourceFiles.length,
  shipping_source_sha256: sha256Bytes(shippingSource),
  source_hashes: sourceHashes,
  blockers,
  failures,
  checks,
  claim_boundary: "This deterministic source check validates the repository's exact build-7 release-train and completed public-repository readbacks but does not itself reproduce the frozen build-7 archive/IPA, live ASC or TestFlight state, physical-device observation, website deployment, App Review outcome, storefront, human audio/rights review, or the external GitHub readback.",
};

if (process.argv.includes("--write-report")) {
  const outputDirectory = pathFromRoot("docs/qa/release");
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, "release-source-validation.json"), `${JSON.stringify(report, null, 2)}\n`);
  const textReport = [
    `status: ${report.status}`,
    `release_ready: ${report.release_ready}`,
    `source_contract_passed: ${report.source_contract_passed}`,
    `candidate_bound: ${report.candidate_bound}`,
    `checks_passed: ${report.checks_passed}`,
    `checks_failed: ${report.checks_failed}`,
    `shipping_source_file_count: ${report.shipping_source_file_count}`,
    `shipping_source_sha256: ${report.shipping_source_sha256}`,
    "",
    "Remaining gates:",
    ...blockers.map((blocker) => `- ${blocker}`),
    ...(failures.length ? ["", "Failures:", ...failures.map((failure) => `- ${failure}`)] : []),
    "",
    report.claim_boundary,
    "",
  ].join("\n");
  writeFileSync(join(outputDirectory, "release-source-validation.txt"), textReport);
}

console.log(`Release source validation ${report.status}: ${report.checks_passed} passed, ${report.checks_failed} failed; candidate remains unbound.`);
for (const failure of failures) console.error(`error: ${failure}`);
process.exitCode = failures.length === 0 ? 0 : 1;
