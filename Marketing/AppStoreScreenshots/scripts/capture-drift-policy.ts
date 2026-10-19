export type HistoricalCaptureRetention = {
  classification: "build-7-captures-retained-for-build-16-audio-replacement";
  current_source_revision: string;
  changed_path_count: number;
  change_scope: "prior-reviewed-ui-delta-plus-approved-v4-narration-only";
  historical_submitted_version: "1.0";
  historical_submitted_build: 7;
  current_review_state: "REJECTED_UNRESOLVED_ISSUES";
  replacement_candidate_build: 16;
  valid_until: "build-16-candidate-bound-capture";
  listing_mutation: "rejected-version-existing-live-images-retained";
  separate_iap_state: "IN_REVIEW";
  next_action: "candidate-bind-and-read-back-before-build-16-resubmission";
  rationale: string;
};

export type LiveActivityCaptureRetention = {
  classification: "iphone-live-activity-nonvisual-capture-retention";
  captured_source_revision: string;
  current_source_revision: string;
  changed_path_count: number;
  change_scope: "iphone-live-activity-only-no-required-capture-pixel-delta";
  required_capture_ids_unchanged: true;
  prior_human_visual_review_retained: true;
  live_activity_physical_proof: "exact-build-18-compact-dynamic-island-core-verified-lock-screen-expanded-pending";
  app_store_listing_mutation: "none";
  rationale: string;
};

export type CaptureDriftAttestation = HistoricalCaptureRetention | LiveActivityCaptureRetention;

export type GardenDayRealClockCaptureRefresh = {
  classification: "garden-day-real-clock-capture-test-added";
  captured_source_revision: string;
  current_source_revision: string;
  changed_path_count: number;
  changed_paths: string[];
  new_capture_id: "garden-day";
  new_capture_device: "iphone-6.9";
  garden_day_clock: "unmodified-simulator-system-clock-in-local-day-range";
  existing_garden_seed_and_dusk_hero_retained: true;
  human_visual_review: "pending";
  app_store_listing_mutation: "none";
  rationale: string;
};

export type AnyCaptureDriftAttestation = CaptureDriftAttestation | GardenDayRealClockCaptureRefresh;

export const GARDEN_DAY_CAPTURED_SOURCE_REVISION =
  "aed3e83d30d6290cb99731be79675fcfbeb7941168ec960479e08148b1293925";
export const GARDEN_DAY_CURRENT_SOURCE_REVISION =
  "13477bc33d33ec130b1525c3e15e0b1d408da5509d6950a0828901e771c0a42c";
export const GARDEN_DAY_CAPTURE_TEST_PATH =
  "Apps/ArriveWithin/Tests/ArriveWithinUITests/ArriveWithinMarketingCaptureUITests.swift";

export const RETAINED_CAPTURE_SOURCE_REVISION =
  "970cbd8250bbb522a5b09570f349fd6967b8f7fcc5d863216c3c7c45a0e94a49";

export const LIVE_ACTIVITY_CAPTURED_SOURCE_REVISION =
  "aed3e83d30d6290cb99731be79675fcfbeb7941168ec960479e08148b1293925";

export const LIVE_ACTIVITY_CURRENT_SOURCE_REVISION =
  "ddee3520ef906537530f88c9a68f296dfdf6a62cfd208cddb3f31972162bae09";

export const LIVE_ACTIVITY_CHANGED_PATHS = [
  "Apps/ArriveWithin/Resources/Info.plist",
  "Apps/ArriveWithin/Resources/de.lproj/Localizable.strings",
  "Apps/ArriveWithin/Resources/en.lproj/Localizable.strings",
  "Apps/ArriveWithin/Sources/AppDependencies.swift",
  "Apps/ArriveWithin/Sources/AppModel.swift",
  "Apps/ArriveWithin/Sources/MeditationActivityAttributes.swift",
  "Apps/ArriveWithin/Sources/MeditationLiveActivity.swift",
  "ArriveWithin.xcodeproj/project.pbxproj",
  "Config/Base.xcconfig",
  "project.yml",
] as const;

export const GARDEN_DAY_CHANGED_PATHS = [
  ...LIVE_ACTIVITY_CHANGED_PATHS,
  GARDEN_DAY_CAPTURE_TEST_PATH,
  "Apps/ArriveWithin/Resources/.DS_Store",
  "Apps/ArriveWithin/Resources/AppIcon.icon/Assets/living-shoot.png",
  "Apps/ArriveWithin/Resources/AppIcon.icon/Assets/living-shoot.svg",
  "Apps/ArriveWithin/Resources/AppIcon.icon/Assets/threshold-arch.png",
  "Apps/ArriveWithin/Resources/AppIcon.icon/Assets/threshold-arch.svg",
  "Apps/ArriveWithin/Resources/AppIcon.icon/Assets/threshold-interior.png",
  "Apps/ArriveWithin/Resources/AppIcon.icon/Assets/threshold-interior.svg",
  "Apps/ArriveWithin/Resources/AppIcon.icon/icon.json",
  "Apps/ArriveWithin/Tests/ArriveWithinUITests/ArriveWithinVerificationUITests.swift",
].sort();

const PRIOR_REVIEWED_UI_CHANGED_PATHS = [
  "Apps/ArriveWithin/Resources/de.lproj/Localizable.strings",
  "Apps/ArriveWithin/Resources/en.lproj/Localizable.strings",
  "Apps/ArriveWithin/Sources/AppModel.swift",
  "Apps/ArriveWithin/Sources/GuidedLibraryView.swift",
  "Apps/ArriveWithin/Sources/MeditationAudioController.swift",
  "Apps/ArriveWithin/Sources/PracticeView.swift",
  "Apps/ArriveWithin/Tests/ArriveWithinUITests/ArriveWithinUITests.swift",
  "ArriveWithin.xcodeproj/project.pbxproj",
  "Config/Base.xcconfig",
  "project.yml",
] as const;

const V4_NARRATION_CHANGED_PATHS = Array.from({ length: 42 }, (_, index) => {
  const identifier = `G${String(index + 1).padStart(2, "0")}`;
  return [
    `Content/guided/${identifier}/audio.de.m4a`,
    `Content/guided/${identifier}/audio.en.m4a`,
    `Content/guided/${identifier}/provenance.de.json`,
    `Content/guided/${identifier}/provenance.en.json`,
    `Content/guided/${identifier}/transcript.de.vtt`,
    `Content/guided/${identifier}/transcript.en.vtt`,
  ];
}).flat();

export const RETAINED_CAPTURE_CHANGED_PATHS = [
  ...PRIOR_REVIEWED_UI_CHANGED_PATHS,
  ...V4_NARRATION_CHANGED_PATHS,
  "Content/guided/G02/script.en.md",
  "Content/guided/catalog.json",
].sort();

const REQUIRED_RATIONALE_FRAGMENTS = [
  "version 1.0 is rejected with unresolved issues",
  "build 15 remains valid",
  "historical live screenshots are not build-16 evidence",
  "Guided catalogue now renders inline",
  "required Garden, Journey, and Journal capture IDs remain unchanged",
  "v4 narration replacement changes only audio, transcripts, provenance, and editorial state",
  "approved captures must be candidate-bound",
  "build 16",
  "IAP remains separately IN_REVIEW",
  "No build-16 archive, upload, physical, review, or storefront claim exists",
] as const;

const LIVE_ACTIVITY_RATIONALE_FRAGMENTS = [
  "iPhone Live Activity",
  "required Garden, Journey, and Journal capture IDs are unchanged",
  "no existing localized value changed",
  "no required App Store screenshot pixel changed",
  "prior human review remains scoped to the retained 24 images",
  "exact build-18 compact Dynamic Island core lifecycle is verified",
  "Lock Screen and expanded Dynamic Island proof remains pending",
  "No App Store Connect mutation was performed",
] as const;

export function isExactHistoricalCaptureRetention(
  attestation: AnyCaptureDriftAttestation | undefined,
  currentSourceRevision: string,
  changedPaths: string[],
): boolean {
  if (attestation?.classification !== "build-7-captures-retained-for-build-16-audio-replacement") return false;
  return Boolean(
    attestation.current_source_revision === RETAINED_CAPTURE_SOURCE_REVISION &&
      currentSourceRevision === RETAINED_CAPTURE_SOURCE_REVISION &&
      attestation.changed_path_count === RETAINED_CAPTURE_CHANGED_PATHS.length &&
      attestation.change_scope === "prior-reviewed-ui-delta-plus-approved-v4-narration-only" &&
      JSON.stringify(changedPaths) === JSON.stringify(RETAINED_CAPTURE_CHANGED_PATHS) &&
      attestation.historical_submitted_version === "1.0" &&
      attestation.historical_submitted_build === 7 &&
      attestation.current_review_state === "REJECTED_UNRESOLVED_ISSUES" &&
      attestation.replacement_candidate_build === 16 &&
      attestation.valid_until === "build-16-candidate-bound-capture" &&
      attestation.listing_mutation === "rejected-version-existing-live-images-retained" &&
      attestation.separate_iap_state === "IN_REVIEW" &&
      attestation.next_action === "candidate-bind-and-read-back-before-build-16-resubmission" &&
      REQUIRED_RATIONALE_FRAGMENTS.every((fragment) => attestation.rationale.includes(fragment)),
  );
}

export function isExactLiveActivityCaptureRetention(
  attestation: AnyCaptureDriftAttestation | undefined,
  capturedSourceRevision: string,
  currentSourceRevision: string,
  changedPaths: string[],
): boolean {
  if (attestation?.classification !== "iphone-live-activity-nonvisual-capture-retention") return false;
  return Boolean(
    capturedSourceRevision === LIVE_ACTIVITY_CAPTURED_SOURCE_REVISION &&
      attestation.captured_source_revision === LIVE_ACTIVITY_CAPTURED_SOURCE_REVISION &&
      currentSourceRevision === LIVE_ACTIVITY_CURRENT_SOURCE_REVISION &&
      attestation.current_source_revision === LIVE_ACTIVITY_CURRENT_SOURCE_REVISION &&
      attestation.changed_path_count === LIVE_ACTIVITY_CHANGED_PATHS.length &&
      JSON.stringify(changedPaths) === JSON.stringify([...LIVE_ACTIVITY_CHANGED_PATHS]) &&
      attestation.change_scope === "iphone-live-activity-only-no-required-capture-pixel-delta" &&
      attestation.required_capture_ids_unchanged === true &&
      attestation.prior_human_visual_review_retained === true &&
      attestation.live_activity_physical_proof === "exact-build-18-compact-dynamic-island-core-verified-lock-screen-expanded-pending" &&
      attestation.app_store_listing_mutation === "none" &&
      LIVE_ACTIVITY_RATIONALE_FRAGMENTS.every((fragment) => attestation.rationale.includes(fragment)),
  );
}

export function isExactGardenDayRealClockCaptureRefresh(
  attestation: AnyCaptureDriftAttestation | undefined,
  capturedSourceRevision: string,
  currentSourceRevision: string,
  changedPaths: string[],
): boolean {
  if (attestation?.classification !== "garden-day-real-clock-capture-test-added") return false;
  return Boolean(
    capturedSourceRevision === GARDEN_DAY_CAPTURED_SOURCE_REVISION
      && attestation.captured_source_revision === GARDEN_DAY_CAPTURED_SOURCE_REVISION
      && currentSourceRevision === GARDEN_DAY_CURRENT_SOURCE_REVISION
      && attestation.current_source_revision === GARDEN_DAY_CURRENT_SOURCE_REVISION
      && attestation.changed_path_count === GARDEN_DAY_CHANGED_PATHS.length
      && JSON.stringify(changedPaths) === JSON.stringify(GARDEN_DAY_CHANGED_PATHS)
      && JSON.stringify(attestation.changed_paths) === JSON.stringify(GARDEN_DAY_CHANGED_PATHS)
      && attestation.new_capture_id === "garden-day"
      && attestation.new_capture_device === "iphone-6.9"
      && attestation.garden_day_clock === "unmodified-simulator-system-clock-in-local-day-range"
      && attestation.existing_garden_seed_and_dusk_hero_retained === true
      && attestation.human_visual_review === "pending"
      && attestation.app_store_listing_mutation === "none"
      && attestation.rationale.includes("unmodified simulator local clock")
      && attestation.rationale.includes("Garden seed and dusk hero source pixels were retained")
      && attestation.rationale.includes("iPad 13-inch capture remains unavailable")
      && attestation.rationale.includes("No App Store Connect mutation was performed")
  );
}
