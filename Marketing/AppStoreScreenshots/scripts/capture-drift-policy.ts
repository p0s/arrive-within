export type SubmittedBuildCaptureFreeze = {
  classification: "submitted-build-7-post-publication-garden-change";
  current_source_revision: string;
  changed_paths: string[];
  submitted_version: "1.0";
  submitted_build: 7;
  submitted_state_at_freeze: "WAITING_FOR_REVIEW";
  valid_until: "next-editable-app-store-metadata-opportunity";
  app_store_connect_mutation: "none";
  next_action: "recapture-and-review-at-next-editable-metadata-opportunity";
  rationale: string;
};

export const POST_PUBLICATION_GARDEN_SOURCE_REVISION =
  "da013bb46fe5748d8020fd34db30aaab449baafac45f92467d8e27904a886f6b";

export const POST_PUBLICATION_GARDEN_CHANGED_PATHS = [
  "Apps/ArriveWithin/Sources/AppModel.swift",
  "Apps/ArriveWithin/Sources/GuidedLibraryView.swift",
  "Apps/ArriveWithin/Sources/MeditationAudioController.swift",
  "Apps/ArriveWithin/Sources/PracticeView.swift",
  "Apps/ArriveWithin/Sources/RendererDiagnostics.swift",
  "ArriveWithin.xcodeproj/project.pbxproj",
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
  "post-publication Garden",
  "not represented by the submitted App Store screenshots",
  "App Store Connect remained untouched",
  "next editable metadata opportunity",
] as const;

export function isExactSubmittedBuildCaptureFreeze(
  attestation: SubmittedBuildCaptureFreeze | undefined,
  currentSourceRevision: string,
  changedPaths: string[],
): boolean {
  return Boolean(
    attestation?.classification === "submitted-build-7-post-publication-garden-change" &&
      attestation.current_source_revision === POST_PUBLICATION_GARDEN_SOURCE_REVISION &&
      currentSourceRevision === POST_PUBLICATION_GARDEN_SOURCE_REVISION &&
      JSON.stringify(attestation.changed_paths) === JSON.stringify(POST_PUBLICATION_GARDEN_CHANGED_PATHS) &&
      JSON.stringify(changedPaths) === JSON.stringify(POST_PUBLICATION_GARDEN_CHANGED_PATHS) &&
      attestation.submitted_version === "1.0" &&
      attestation.submitted_build === 7 &&
      attestation.submitted_state_at_freeze === "WAITING_FOR_REVIEW" &&
      attestation.valid_until === "next-editable-app-store-metadata-opportunity" &&
      attestation.app_store_connect_mutation === "none" &&
      attestation.next_action === "recapture-and-review-at-next-editable-metadata-opportunity" &&
      REQUIRED_RATIONALE_FRAGMENTS.every((fragment) => attestation.rationale.includes(fragment)),
  );
}
