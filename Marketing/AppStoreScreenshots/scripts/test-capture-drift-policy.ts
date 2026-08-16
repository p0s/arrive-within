import assert from "node:assert/strict";

import {
  isExactHistoricalCaptureRetention,
  RETAINED_CAPTURE_CHANGED_PATHS,
  RETAINED_CAPTURE_SOURCE_REVISION,
  type HistoricalCaptureRetention,
} from "./capture-drift-policy";

const exact: HistoricalCaptureRetention = {
  classification: "build-7-withdrawn-build-15-capture-retention",
  current_source_revision: RETAINED_CAPTURE_SOURCE_REVISION,
  changed_paths: [...RETAINED_CAPTURE_CHANGED_PATHS],
  historical_submitted_version: "1.0",
  historical_submitted_build: 7,
  historical_review_state: "DEVELOPER_REJECTED_AFTER_WITHDRAWAL",
  replacement_candidate_build: 15,
  valid_until: "build-15-candidate-bound-capture",
  listing_mutation: "review-withdrawn-existing-live-images-retained",
  separate_iap_state: "READY_TO_SUBMIT_NOT_ATTACHED",
  next_action: "candidate-bind-and-read-back-before-build-15-submission",
  rationale:
    "The build 7 review was withdrawn and version 1.0 now reads DEVELOPER_REJECTED. Its historical live screenshots are not build-15 evidence. The Guided catalogue now renders inline, while the required Garden, Journey, and Journal capture IDs remain unchanged. The approved current-source captures must be candidate-bound and read back before build 15 is submitted. The READY_TO_SUBMIT IAP is separate and not attached. No build-15 archive, upload, physical, review, or storefront claim exists.",
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
assert.equal(accepts({ ...exact, replacement_candidate_build: 16 as 15 }), false, "another replacement build must fail");
assert.equal(accepts({ ...exact, valid_until: "expired" as "build-15-candidate-bound-capture" }), false, "an expired retention must fail");
assert.equal(accepts({ ...exact, listing_mutation: "review-withdrawn-existing-live-images-retained " as "review-withdrawn-existing-live-images-retained" }), false, "a near-match mutation boundary must fail");
assert.equal(accepts({ ...exact, rationale: exact.rationale.replace("candidate-bound", "available") }), false, "a missing candidate-binding action must fail");

process.stdout.write("Capture drift policy passed: exact historical-capture retention plus 6 negative controls.\n");
