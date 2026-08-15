import assert from "node:assert/strict";

import {
  isExactSubmittedBuildCaptureFreeze,
  POST_SUBMISSION_CHANGED_PATHS,
  POST_SUBMISSION_SOURCE_REVISION,
  type SubmittedBuildCaptureFreeze,
} from "./capture-drift-policy";

const exact: SubmittedBuildCaptureFreeze = {
  classification: "submitted-build-7-post-submission-source-changes",
  current_source_revision: POST_SUBMISSION_SOURCE_REVISION,
  changed_paths: [...POST_SUBMISSION_CHANGED_PATHS],
  submitted_version: "1.0",
  submitted_build: 7,
  submitted_state_at_freeze: "WAITING_FOR_REVIEW",
  valid_until: "next-editable-app-store-metadata-opportunity",
  submitted_listing_mutation: "none",
  separate_iap_state: "READY_TO_SUBMIT_NOT_ATTACHED",
  next_action: "recapture-and-review-at-next-editable-metadata-opportunity",
  rationale:
    "Exact build 7 was already WAITING_FOR_REVIEW and must not be replaced, cancelled, edited, or resubmitted. The post-submission Garden and timer audio correction are deliberately not represented by the submitted App Store screenshots. The Guided availability, browse navigation, and hash-bound playback fix changes only supplemental non-marketing Guided captures; the required Garden, Journey, and Journal capture IDs remain unchanged. The submitted App Store listing and screenshots remained untouched. The READY_TO_SUBMIT IAP is separate and not attached, and fresh captures are required at the next editable metadata opportunity.",
};

function accepts(
  attestation: SubmittedBuildCaptureFreeze = exact,
  revision: string = POST_SUBMISSION_SOURCE_REVISION,
  paths: string[] = [...POST_SUBMISSION_CHANGED_PATHS],
): boolean {
  return isExactSubmittedBuildCaptureFreeze(attestation, revision, paths);
}

assert.equal(accepts(), true, "the exact frozen-build attestation must pass");
assert.equal(accepts(exact, `${POST_SUBMISSION_SOURCE_REVISION.slice(0, -1)}0`), false, "a near-match revision must fail");
assert.equal(accepts(exact, POST_SUBMISSION_SOURCE_REVISION, [...POST_SUBMISSION_CHANGED_PATHS, "Renderer/src/scene.ts"]), false, "an extra changed file must fail");
assert.equal(accepts({ ...exact, submitted_build: 8 as 7 }), false, "another build must fail");
assert.equal(accepts({ ...exact, valid_until: "expired" as "next-editable-app-store-metadata-opportunity" }), false, "an expired freeze must fail");
assert.equal(accepts({ ...exact, submitted_listing_mutation: "none " as "none" }), false, "a near-match mutation boundary must fail");
assert.equal(accepts({ ...exact, rationale: exact.rationale.replace("next editable metadata opportunity", "later") }), false, "a missing deferred action must fail");

process.stdout.write("Capture drift policy passed: exact submitted-build freeze plus 6 negative controls.\n");
