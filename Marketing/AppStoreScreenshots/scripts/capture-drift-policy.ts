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

export const RETAINED_CAPTURE_SOURCE_REVISION =
  "970cbd8250bbb522a5b09570f349fd6967b8f7fcc5d863216c3c7c45a0e94a49";

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

export function isExactHistoricalCaptureRetention(
  attestation: HistoricalCaptureRetention | undefined,
  currentSourceRevision: string,
  changedPaths: string[],
): boolean {
  return Boolean(
    attestation?.classification === "build-7-captures-retained-for-build-16-audio-replacement" &&
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
