export type SubmittedBuildCaptureFreeze = {
  classification: "submitted-build-7-post-submission-source-changes";
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
  "b524cea2c85cbee8d1a9933026d94f31cb7c482af1c517b892a52e371f90517c";

export const POST_SUBMISSION_CHANGED_PATHS = [
  "ArriveWithin.xcodeproj/project.pbxproj",
  "Config/Base.xcconfig",
  "project.yml",
] as const;

const REQUIRED_RATIONALE_FRAGMENTS = [
  "build 7",
  "WAITING_FOR_REVIEW",
  "must not be replaced, cancelled, edited, or resubmitted",
  "post-submission Garden",
  "not represented by the submitted App Store screenshots",
  "timer audio correction",
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
    attestation?.classification === "submitted-build-7-post-submission-source-changes" &&
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
