export type HistoricalCaptureRetention = {
  classification: "build-7-withdrawn-build-15-capture-retention";
  current_source_revision: string;
  changed_paths: string[];
  historical_submitted_version: "1.0";
  historical_submitted_build: 7;
  historical_review_state: "DEVELOPER_REJECTED_AFTER_WITHDRAWAL";
  replacement_candidate_build: 15;
  valid_until: "build-15-candidate-bound-capture";
  listing_mutation: "review-withdrawn-existing-live-images-retained";
  separate_iap_state: "READY_TO_SUBMIT_NOT_ATTACHED";
  next_action: "candidate-bind-and-read-back-before-build-15-submission";
  rationale: string;
};

export const RETAINED_CAPTURE_SOURCE_REVISION =
  "75031c7ee16fdf7f7463cfe943b573b0ba785af1051027296e32dd2c345d8bdf";

export const RETAINED_CAPTURE_CHANGED_PATHS = [
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

const REQUIRED_RATIONALE_FRAGMENTS = [
  "build 7 review was withdrawn",
  "DEVELOPER_REJECTED",
  "historical live screenshots are not build-15 evidence",
  "Guided catalogue now renders inline",
  "required Garden, Journey, and Journal capture IDs remain unchanged",
  "approved current-source captures must be candidate-bound",
  "build 15",
  "IAP is separate and not attached",
  "No build-15 archive, upload, physical, review, or storefront claim exists",
] as const;

export function isExactHistoricalCaptureRetention(
  attestation: HistoricalCaptureRetention | undefined,
  currentSourceRevision: string,
  changedPaths: string[],
): boolean {
  return Boolean(
    attestation?.classification === "build-7-withdrawn-build-15-capture-retention" &&
      attestation.current_source_revision === RETAINED_CAPTURE_SOURCE_REVISION &&
      currentSourceRevision === RETAINED_CAPTURE_SOURCE_REVISION &&
      JSON.stringify(attestation.changed_paths) === JSON.stringify(RETAINED_CAPTURE_CHANGED_PATHS) &&
      JSON.stringify(changedPaths) === JSON.stringify(RETAINED_CAPTURE_CHANGED_PATHS) &&
      attestation.historical_submitted_version === "1.0" &&
      attestation.historical_submitted_build === 7 &&
      attestation.historical_review_state === "DEVELOPER_REJECTED_AFTER_WITHDRAWAL" &&
      attestation.replacement_candidate_build === 15 &&
      attestation.valid_until === "build-15-candidate-bound-capture" &&
      attestation.listing_mutation === "review-withdrawn-existing-live-images-retained" &&
      attestation.separate_iap_state === "READY_TO_SUBMIT_NOT_ATTACHED" &&
      attestation.next_action === "candidate-bind-and-read-back-before-build-15-submission" &&
      REQUIRED_RATIONALE_FRAGMENTS.every((fragment) => attestation.rationale.includes(fragment)),
  );
}
