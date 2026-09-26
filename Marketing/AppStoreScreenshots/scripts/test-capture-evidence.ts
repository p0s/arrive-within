import assert from "node:assert/strict";

import {
  assertCaptureSourceEvidence,
  expectedCaptureAppearance,
  gardenPhaseAt,
  makeCaptureSourceEvidence,
  matchesCaptureProofAttachmentName,
  parseCaptureBuildProof,
  parseCaptureEvidenceInput,
  type CaptureEvidenceExpectation,
  type CaptureEvidenceInput,
} from "./capture-evidence";

const currentSource = {
  source_commit: "4".repeat(40),
  source_revision: "1".repeat(64),
  source_manifest_path: "capture-source-manifest-v1.0.2-build-19.json",
  source_manifest_sha256: "2".repeat(64),
};

function evidenceInput(): CaptureEvidenceInput {
  const captures = {
    "iphone-6.9": {
      "en-US": {
        "garden-hero": { capture_local_date: "2026-09-25", visible_status_time: "18:20", timezone: "Asia/Singapore" as const },
        "garden-day": { capture_local_date: "2026-09-26", visible_status_time: "09:41", timezone: "Asia/Singapore" as const },
        "garden-seed": { capture_local_date: "2026-09-25", visible_status_time: "18:19", timezone: "Asia/Singapore" as const },
        "journey-calendar": { capture_local_date: "2026-09-25", visible_status_time: "18:21", timezone: "Asia/Singapore" as const },
        "journey-milestones": { capture_local_date: "2026-09-25", visible_status_time: "18:22", timezone: "Asia/Singapore" as const },
        journal: { capture_local_date: "2026-09-25", visible_status_time: "18:23", timezone: "Asia/Singapore" as const },
      },
      "de-DE": {
        "garden-hero": { capture_local_date: "2026-09-25", visible_status_time: "18:20", timezone: "Asia/Singapore" as const },
        "garden-day": { capture_local_date: "2026-09-26", visible_status_time: "09:42", timezone: "Asia/Singapore" as const },
        "garden-seed": { capture_local_date: "2026-09-25", visible_status_time: "18:19", timezone: "Asia/Singapore" as const },
        "journey-calendar": { capture_local_date: "2026-09-25", visible_status_time: "18:21", timezone: "Asia/Singapore" as const },
        "journey-milestones": { capture_local_date: "2026-09-25", visible_status_time: "18:22", timezone: "Asia/Singapore" as const },
        journal: { capture_local_date: "2026-09-25", visible_status_time: "18:23", timezone: "Asia/Singapore" as const },
      },
    },
  } satisfies CaptureEvidenceInput["captures"];
  const sourceBindings = {} as CaptureEvidenceInput["source_bindings"];
  const manifestBinding = {
    source_revision: currentSource.source_revision,
    source_manifest_path: currentSource.source_manifest_path,
    source_manifest_sha256: currentSource.source_manifest_sha256,
  };
  sourceBindings["iphone-6.9"] = {
    selected: { ...manifestBinding },
    "garden-day": { ...manifestBinding },
  };
  return { source_bindings: sourceBindings, captures };
}

const parsed = parseCaptureEvidenceInput(evidenceInput(), currentSource);
assert.equal(
  matchesCaptureProofAttachmentName(
    "capture-source-proof-en-US-garden-seed_0_0-18f4a9be-2e20-4eb2-9f02-910a68d603d7.json",
    "capture-source-proof-en-US-garden-seed",
  ),
  true,
);
assert.equal(
  matchesCaptureProofAttachmentName(
    "capture-source-proof-en-US-garden-seed_0_0-18f4a9be-2e20-4eb2-9f02-910a68d603d7.json",
    "capture-source-proof-de-DE-garden-seed",
  ),
  false,
);
assert.equal(
  matchesCaptureProofAttachmentName(
    `capture-source-proof-en-US-garden-seed_0_${"x".repeat(129)}.json`,
    "capture-source-proof-en-US-garden-seed",
  ),
  false,
);
const expectation: CaptureEvidenceExpectation = {
  device: "iphone-6.9",
  locale: "en-US",
  capture_id: "garden-seed",
  source_commit: currentSource.source_commit,
  build_proof_sha256: "5".repeat(64),
  source_revision: currentSource.source_revision,
  source_manifest_path: currentSource.source_manifest_path,
  source_manifest_sha256: currentSource.source_manifest_sha256,
  result_bundle: {
    role: "selected",
    name: "20260925T100000Z-1-abc.xcresult",
    xcresult_tree_sha256: "3".repeat(64),
  },
};
const buildProof = {
  schema: "arrive-within-capture-build-proof/v1",
  capture_id: expectation.capture_id,
  locale: expectation.locale,
  bundle_id: "com.philipps.arrivewithin.ios",
  marketing_version: "1.0.2",
  build_number: "19",
  appearance: "dark",
  source_commit: currentSource.source_commit,
  source_revision: currentSource.source_revision,
};
assert.deepEqual(parseCaptureBuildProof(buildProof, {
  capture_id: expectation.capture_id,
  locale: expectation.locale,
  source_commit: currentSource.source_commit,
  source_revision: currentSource.source_revision,
}), buildProof);
const seed = makeCaptureSourceEvidence(expectation, parsed.captures["iphone-6.9"][expectation.locale][expectation.capture_id]);
assert.equal(seed.garden_phase, "dusk");
assert.equal(seed.appearance, "dark");
assert.doesNotThrow(() => assertCaptureSourceEvidence(seed, expectation));
assert.deepEqual(
  ["garden-seed", "garden-hero", "garden-day", "journey-calendar", "journey-milestones", "journal"].map((id) =>
    expectedCaptureAppearance(id as typeof expectation.capture_id)),
  ["dark", "dark", "light", "light", "light", "light"],
);

assert.equal(gardenPhaseAt("04:59"), "night");
assert.equal(gardenPhaseAt("05:00"), "dawn");
assert.equal(gardenPhaseAt("07:59"), "dawn");
assert.equal(gardenPhaseAt("08:00"), "day");
assert.equal(gardenPhaseAt("16:59"), "day");
assert.equal(gardenPhaseAt("17:00"), "dusk");
assert.equal(gardenPhaseAt("19:59"), "dusk");
assert.equal(gardenPhaseAt("20:00"), "night");

const wrongPhase = evidenceInput();
wrongPhase.captures["iphone-6.9"]["en-US"]["garden-seed"].visible_status_time = "16:59";
assert.throws(() => parseCaptureEvidenceInput(wrongPhase, currentSource), /requires a dusk\/night/);
const wrongDay = evidenceInput();
wrongDay.captures["iphone-6.9"]["de-DE"]["garden-day"].visible_status_time = "17:00";
assert.throws(() => parseCaptureEvidenceInput(wrongDay, currentSource), /requires a Day-phase/);
const wrongRevision = evidenceInput();
wrongRevision.source_bindings["iphone-6.9"]["garden-day"].source_revision = "0".repeat(64);
assert.throws(() => parseCaptureEvidenceInput(wrongRevision, currentSource), /different source manifest/);
const wrongManifest = evidenceInput();
wrongManifest.source_bindings["iphone-6.9"].selected.source_manifest_sha256 = "0".repeat(64);
assert.throws(() => parseCaptureEvidenceInput(wrongManifest, currentSource), /different source manifest/);
const wrongManifestPath = evidenceInput();
wrongManifestPath.source_bindings["iphone-6.9"]["garden-day"].source_manifest_path = "capture-source-manifest.json";
assert.throws(() => parseCaptureEvidenceInput(wrongManifestPath, currentSource), /different source manifest/);

const wrongDevice = evidenceInput() as unknown as Record<string, unknown>;
(wrongDevice.source_bindings as Record<string, unknown>)["ipad-13"] = {};
assert.throws(() => parseCaptureEvidenceInput(wrongDevice, currentSource), /source_bindings: expected exactly keys/);
const missingTime = evidenceInput() as unknown as Record<string, unknown>;
const timeCaptures = missingTime.captures as Record<string, Record<string, Record<string, unknown>>>;
delete timeCaptures["iphone-6.9"]["en-US"].journal;
assert.throws(() => parseCaptureEvidenceInput(missingTime, currentSource), /expected exactly keys/);

assert.throws(
  () => assertCaptureSourceEvidence({ ...seed, garden_phase: "day" }, expectation),
  /does not match visible local time/,
);
assert.throws(
  () => assertCaptureSourceEvidence({ ...seed, source_revision: "0".repeat(64) }, expectation),
  /does not match the current source manifest\/device/,
);
assert.throws(
  () => parseCaptureBuildProof({ ...buildProof, source_revision: "0".repeat(64) }, {
    capture_id: expectation.capture_id,
    locale: expectation.locale,
    source_commit: currentSource.source_commit,
    source_revision: currentSource.source_revision,
  }),
  /does not match the current signed build and source/,
);
assert.throws(
  () => parseCaptureBuildProof({ ...buildProof, appearance: "light" }, {
    capture_id: expectation.capture_id,
    locale: expectation.locale,
    source_commit: currentSource.source_commit,
    source_revision: currentSource.source_revision,
  }),
  /does not match the current signed build and source/,
);
assert.throws(
  () => assertCaptureSourceEvidence({ ...seed, build_proof_sha256: "0".repeat(64) }, expectation),
  /capture source does not match the current source manifest\/device/,
);
assert.throws(
  () => assertCaptureSourceEvidence({ ...seed, result_bundle: { ...seed.result_bundle, xcresult_tree_sha256: "0".repeat(64) } }, expectation),
  /different result bundle/,
);
assert.throws(
  () => assertCaptureSourceEvidence({ ...seed, test_identifier: "ArriveWithinMarketingCaptureUITests/testCaptureGardenDayEnglish()" }, expectation),
  /test identifier mismatch/,
);

process.stdout.write("Per-capture evidence passed: source/bundle/test/device/time binding and phase, timezone, and appearance negative controls.\n");
