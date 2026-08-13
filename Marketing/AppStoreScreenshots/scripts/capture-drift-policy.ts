export type SubmittedBuildCaptureFreeze = {
  classification: "submitted-build-7-post-submission-source-change";
  current_source_revision: string;
  changed_paths: string[];
  submitted_version: "1.0";
  submitted_build: 7;
  submitted_state_at_freeze: "WAITING_FOR_REVIEW";
  valid_until: "next-editable-app-store-metadata-opportunity";
  submitted_listing_mutation: "none";
  separate_iap_state: "READY_TO_SUBMIT_NOT_ATTACHED";
  next_action: "recapture-and-review-at-next-editable-metadata-opportunity";
  rationale: string;
};

export const POST_SUBMISSION_SOURCE_REVISION =
  "00dcc81d10e5aa2470b6add166df50e6ca01c0cdf9598f75e4f9250a6cda6532";

export const POST_SUBMISSION_CHANGED_PATHS = [
  "Apps/ArriveWithin/Resources/de.lproj/Localizable.strings",
  "Apps/ArriveWithin/Resources/en.lproj/Localizable.strings",
  "Apps/ArriveWithin/Sources/AppDependencies.swift",
  "Apps/ArriveWithin/Sources/AppModel.swift",
  "Apps/ArriveWithin/Sources/AppSettings.swift",
  "Apps/ArriveWithin/Sources/GardenView.swift",
  "Apps/ArriveWithin/Sources/GardenWebView.swift",
  "Apps/ArriveWithin/Sources/GuidedLibraryView.swift",
  "Apps/ArriveWithin/Sources/MeditationAudioController.swift",
  "Apps/ArriveWithin/Sources/PracticeView.swift",
  "Apps/ArriveWithin/Sources/PremiumGardenStyles.swift",
  "Apps/ArriveWithin/Sources/PremiumGardenStylesView.swift",
  "Apps/ArriveWithin/Sources/RendererDiagnostics.swift",
  "Apps/ArriveWithin/Sources/SettingsView.swift",
  "Apps/ArriveWithin/Tests/ArriveWithinUITests/ArriveWithinUITests.swift",
  "ArriveWithin.xcodeproj/project.pbxproj",
  "ArriveWithin.xcodeproj/xcshareddata/xcschemes/ArriveWithin.xcscheme",
  "Config/ArriveWithin.entitlements.local",
  "Config/Base.xcconfig",
  "Config/Local.xcconfig",
  "Packages/ArriveWithinCore/Package.swift",
  "Packages/ArriveWithinCore/Sources/ArriveWithinDomain/GardenState.swift",
  "Packages/ArriveWithinCore/Sources/ArriveWithinDomain/ProgressionReducer.swift",
  "Packages/ArriveWithinCore/Sources/ArriveWithinDomain/WeeklyReminderSchedule.swift",
  "Packages/ArriveWithinCore/Sources/ArriveWithinGardenBridge/GardenDescription.swift",
  "Renderer/dist/renderer-manifest.json",
  "Renderer/dist/renderer.js",
  "project.yml",
] as const;

const REQUIRED_RATIONALE_FRAGMENTS = [
  "build 7",
  "WAITING_FOR_REVIEW",
  "must not be replaced, cancelled, edited, or resubmitted",
  "post-submission Garden",
  "not represented by the submitted App Store screenshots",
  "submitted App Store listing and screenshots remained untouched",
  "IAP is separate and not attached",
  "next editable metadata opportunity",
] as const;

export function isExactSubmittedBuildCaptureFreeze(
  attestation: SubmittedBuildCaptureFreeze | undefined,
  currentSourceRevision: string,
  changedPaths: string[],
): boolean {
  return Boolean(
    attestation?.classification === "submitted-build-7-post-submission-source-change" &&
      attestation.current_source_revision === POST_SUBMISSION_SOURCE_REVISION &&
      currentSourceRevision === POST_SUBMISSION_SOURCE_REVISION &&
      JSON.stringify(attestation.changed_paths) === JSON.stringify(POST_SUBMISSION_CHANGED_PATHS) &&
      JSON.stringify(changedPaths) === JSON.stringify(POST_SUBMISSION_CHANGED_PATHS) &&
      attestation.submitted_version === "1.0" &&
      attestation.submitted_build === 7 &&
      attestation.submitted_state_at_freeze === "WAITING_FOR_REVIEW" &&
      attestation.valid_until === "next-editable-app-store-metadata-opportunity" &&
      attestation.submitted_listing_mutation === "none" &&
      attestation.separate_iap_state === "READY_TO_SUBMIT_NOT_ATTACHED" &&
      attestation.next_action === "recapture-and-review-at-next-editable-metadata-opportunity" &&
      REQUIRED_RATIONALE_FRAGMENTS.every((fragment) => attestation.rationale.includes(fragment)),
  );
}
