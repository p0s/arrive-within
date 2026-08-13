import assert from "node:assert/strict";

import {
  isExactSubmittedBuildCaptureFreeze,
  POST_PUBLICATION_GARDEN_CHANGED_PATHS,
  POST_PUBLICATION_GARDEN_SOURCE_REVISION,
  type SubmittedBuildCaptureFreeze,
} from "./capture-drift-policy";

const exact: SubmittedBuildCaptureFreeze = {
  classification: "submitted-build-7-post-publication-garden-change",
  current_source_revision: POST_PUBLICATION_GARDEN_SOURCE_REVISION,
  changed_paths: [...POST_PUBLICATION_GARDEN_CHANGED_PATHS],
  submitted_version: "1.0",
  submitted_build: 7,
  submitted_state_at_freeze: "WAITING_FOR_REVIEW",
  valid_until: "next-editable-app-store-metadata-opportunity",
  app_store_connect_mutation: "none",
  next_action: "recapture-and-review-at-next-editable-metadata-opportunity",
  rationale:
    "Exact build 7 was already WAITING_FOR_REVIEW and must not be replaced, cancelled, edited, or resubmitted. The post-publication Garden is deliberately not represented by the submitted App Store screenshots; App Store Connect remained untouched, and fresh captures are required at the next editable metadata opportunity.",
};

function accepts(
  attestation: SubmittedBuildCaptureFreeze = exact,
  revision: string = POST_PUBLICATION_GARDEN_SOURCE_REVISION,
  paths: string[] = [...POST_PUBLICATION_GARDEN_CHANGED_PATHS],
): boolean {
  return isExactSubmittedBuildCaptureFreeze(attestation, revision, paths);
}

assert.equal(accepts(), true, "the exact frozen-build attestation must pass");
assert.equal(accepts(exact, `${POST_PUBLICATION_GARDEN_SOURCE_REVISION.slice(0, -1)}1`), false, "a near-match revision must fail");
assert.equal(accepts(exact, POST_PUBLICATION_GARDEN_SOURCE_REVISION, [...POST_PUBLICATION_GARDEN_CHANGED_PATHS, "Renderer/src/scene.ts"]), false, "an extra changed file must fail");
assert.equal(accepts({ ...exact, submitted_build: 8 as 7 }), false, "another build must fail");
assert.equal(accepts({ ...exact, valid_until: "expired" as "next-editable-app-store-metadata-opportunity" }), false, "an expired freeze must fail");
assert.equal(accepts({ ...exact, app_store_connect_mutation: "none " as "none" }), false, "a near-match mutation boundary must fail");
assert.equal(accepts({ ...exact, rationale: exact.rationale.replace("next editable metadata opportunity", "later") }), false, "a missing deferred action must fail");

process.stdout.write("Capture drift policy passed: exact submitted-build freeze plus 6 negative controls.\n");
