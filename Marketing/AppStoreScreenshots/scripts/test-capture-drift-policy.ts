import assert from "node:assert/strict";

import {
  isExactHistoricalCaptureRetention,
  RETAINED_CAPTURE_CHANGED_PATHS,
  RETAINED_CAPTURE_SOURCE_REVISION,
  type HistoricalCaptureRetention,
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

process.stdout.write("Capture drift policy passed: exact historical-capture retention plus 6 negative controls.\n");
