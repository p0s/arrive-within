import assert from "node:assert/strict";

import {
  isExactHistoricalCaptureRetention,
  isExactLiveActivityCaptureRetention,
  LIVE_ACTIVITY_CAPTURED_SOURCE_REVISION,
  LIVE_ACTIVITY_CHANGED_PATHS,
  LIVE_ACTIVITY_CURRENT_SOURCE_REVISION,
  RETAINED_CAPTURE_CHANGED_PATHS,
  RETAINED_CAPTURE_SOURCE_REVISION,
  type HistoricalCaptureRetention,
  type LiveActivityCaptureRetention,
} from "./capture-drift-policy";

const exact: HistoricalCaptureRetention = {
  classification: "build-7-captures-retained-for-build-16-audio-replacement",
  current_source_revision: RETAINED_CAPTURE_SOURCE_REVISION,
  changed_path_count: RETAINED_CAPTURE_CHANGED_PATHS.length,
  change_scope: "prior-reviewed-ui-delta-plus-approved-v4-narration-only",
  historical_submitted_version: "1.0",
  historical_submitted_build: 7,
  current_review_state: "REJECTED_UNRESOLVED_ISSUES",
  replacement_candidate_build: 16,
  valid_until: "build-16-candidate-bound-capture",
  listing_mutation: "rejected-version-existing-live-images-retained",
  separate_iap_state: "IN_REVIEW",
  next_action: "candidate-bind-and-read-back-before-build-16-resubmission",
  rationale:
    "App Store version 1.0 is rejected with unresolved issues while build 15 remains valid. Its historical live screenshots are not build-16 evidence. The Guided catalogue now renders inline, while the required Garden, Journey, and Journal capture IDs remain unchanged. The approved v4 narration replacement changes only audio, transcripts, provenance, and editorial state; it does not alter those captured pixels. The approved captures must be candidate-bound and read back before build 16 is submitted. The IAP remains separately IN_REVIEW. No build-16 archive, upload, physical, review, or storefront claim exists.",
};

function accepts(
  attestation: HistoricalCaptureRetention = exact,
  revision: string = RETAINED_CAPTURE_SOURCE_REVISION,
  paths: string[] = [...RETAINED_CAPTURE_CHANGED_PATHS],
): boolean {
  return isExactHistoricalCaptureRetention(attestation, revision, paths);
}

assert.equal(accepts(), true, "the exact historical-capture retention must pass");
assert.equal(accepts(exact, `${RETAINED_CAPTURE_SOURCE_REVISION.slice(0, -1)}0`), false, "a near-match revision must fail");
assert.equal(accepts(exact, RETAINED_CAPTURE_SOURCE_REVISION, [...RETAINED_CAPTURE_CHANGED_PATHS, "Renderer/src/scene.ts"]), false, "an extra changed file must fail");
assert.equal(accepts({ ...exact, replacement_candidate_build: 15 as 16 }), false, "another replacement build must fail");
assert.equal(accepts({ ...exact, valid_until: "expired" as "build-16-candidate-bound-capture" }), false, "an expired retention must fail");
assert.equal(accepts({ ...exact, change_scope: "prior-reviewed-ui-delta-plus-approved-v4-narration-only " as "prior-reviewed-ui-delta-plus-approved-v4-narration-only" }), false, "a near-match scope must fail");
assert.equal(accepts({ ...exact, rationale: exact.rationale.replace("candidate-bound", "available") }), false, "a missing candidate-binding action must fail");

const liveActivityExact: LiveActivityCaptureRetention = {
  classification: "iphone-live-activity-nonvisual-capture-retention",
  captured_source_revision: LIVE_ACTIVITY_CAPTURED_SOURCE_REVISION,
  current_source_revision: LIVE_ACTIVITY_CURRENT_SOURCE_REVISION,
  changed_path_count: LIVE_ACTIVITY_CHANGED_PATHS.length,
  change_scope: "iphone-live-activity-only-no-required-capture-pixel-delta",
  required_capture_ids_unchanged: true,
  prior_human_visual_review_retained: true,
  live_activity_physical_proof: "pending-exact-iphone-lock-screen-and-dynamic-island-review",
  app_store_listing_mutation: "none",
  rationale:
    "The iPhone Live Activity adds a read-only system surface while the required Garden, Journey, and Journal capture IDs are unchanged. New localization keys were appended and no existing localized value changed, so no required App Store screenshot pixel changed. The prior human review remains scoped to the retained 24 images; physical iPhone Lock Screen and Dynamic Island proof remains pending. No App Store Connect mutation was performed.",
};

function acceptsLiveActivity(
  attestation: LiveActivityCaptureRetention = liveActivityExact,
  capturedRevision: string = LIVE_ACTIVITY_CAPTURED_SOURCE_REVISION,
  currentRevision: string = LIVE_ACTIVITY_CURRENT_SOURCE_REVISION,
  paths: string[] = [...LIVE_ACTIVITY_CHANGED_PATHS],
): boolean {
  return isExactLiveActivityCaptureRetention(attestation, capturedRevision, currentRevision, paths);
}

assert.equal(acceptsLiveActivity(), true, "the exact nonvisual Live Activity retention must pass");
assert.equal(acceptsLiveActivity(liveActivityExact, "0".repeat(64)), false, "another captured source must fail");
assert.equal(acceptsLiveActivity(liveActivityExact, LIVE_ACTIVITY_CAPTURED_SOURCE_REVISION, "0".repeat(64)), false, "another current source must fail");
assert.equal(acceptsLiveActivity(liveActivityExact, LIVE_ACTIVITY_CAPTURED_SOURCE_REVISION, LIVE_ACTIVITY_CURRENT_SOURCE_REVISION, [...LIVE_ACTIVITY_CHANGED_PATHS, "Apps/ArriveWithin/Sources/PracticeView.swift"]), false, "an additional app-screen change must fail");
assert.equal(acceptsLiveActivity({ ...liveActivityExact, live_activity_physical_proof: "complete" as LiveActivityCaptureRetention["live_activity_physical_proof"] }), false, "unverified physical proof must fail");
assert.equal(acceptsLiveActivity({ ...liveActivityExact, rationale: liveActivityExact.rationale.replace("No App Store Connect mutation was performed", "Listing updated") }), false, "a missing listing boundary must fail");

process.stdout.write("Capture drift policy passed: exact historical and Live Activity nonvisual retention boundaries plus negative controls.\n");
