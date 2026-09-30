import assert from "node:assert/strict";

import {
  assertCaptureSourceEvidence,
  expectedCaptureAppearance,
  expectedCaptureRole,
  expectedCaptureTestIdentifier,
  gardenPhaseAt,
  makeCaptureSourceEvidence,
  matchesCaptureProofAttachmentName,
  parseCaptureBuildProof,
  type CaptureBuildProof,
  type CaptureEvidenceExpectation,
  type CaptureId,
} from "./capture-evidence";
import { expectedClockFixtureIDForCapture, marketingClockFixture } from "./marketing-clock-fixtures";
import type { DeviceId, LocaleId } from "./contracts";

const source = {
  source_commit: "4".repeat(40),
  source_revision: "1".repeat(64),
  source_manifest_path: "capture-source-manifest-v1.0.2-build-19.json",
  source_manifest_sha256: "2".repeat(64),
};
const devices: DeviceId[] = ["iphone-6.9", "ipad-13"];
const locales: LocaleId[] = ["en-US", "de-DE"];
const captureIDs: CaptureId[] = [
  "garden-hero", "garden-day", "garden-seed", "journey-calendar", "journey-milestones", "journal",
];

function expectation(device: DeviceId, locale: LocaleId, captureID: CaptureId): CaptureEvidenceExpectation {
  const role = expectedCaptureRole(captureID);
  return {
    device,
    locale,
    capture_id: captureID,
    source_commit: source.source_commit,
    build_proof_sha256: "5".repeat(64),
    source_revision: source.source_revision,
    source_manifest_path: source.source_manifest_path,
    source_manifest_sha256: source.source_manifest_sha256,
    result_bundle: {
      role,
      name: `${device}-${role}.xcresult`,
      xcresult_tree_sha256: "3".repeat(64),
    },
  };
}

function proofFor(expected: CaptureEvidenceExpectation): CaptureBuildProof {
  const fixtureID = expectedClockFixtureIDForCapture(expected.capture_id);
  const fixture = marketingClockFixture(fixtureID);
  return {
    schema: "arrive-within-capture-build-proof/v2",
    capture_id: expected.capture_id,
    locale: expected.locale,
    bundle_id: "com.philipps.arrivewithin.ios",
    marketing_version: "1.0.2",
    build_number: "19",
    appearance: expectedCaptureAppearance(expected.capture_id),
    source_commit: source.source_commit,
    source_revision: source.source_revision,
    clock_fixture_id: fixture.id,
    clock_epoch: String(fixture.epoch),
    timezone: fixture.timezone,
    garden_phase: fixture.garden_phase,
    captured_at: "2026-09-30T03:22:14.431Z",
    system_timezone: "Etc/UTC",
  };
}

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

for (const device of devices) {
  for (const locale of locales) {
    for (const captureID of captureIDs) {
      const expected = expectation(device, locale, captureID);
      const proof = proofFor(expected);
      assert.deepEqual(parseCaptureBuildProof(proof, {
        capture_id: captureID,
        locale,
        source_commit: source.source_commit,
        source_revision: source.source_revision,
      }), proof);
      const evidence = makeCaptureSourceEvidence(expected, proof);
      assert.equal(evidence.clock_fixture_id, captureID === "garden-day" ? "day-v1" : "dusk-v1");
      assert.equal(evidence.clock_epoch, captureID === "garden-day" ? "1785548460" : "1785577260");
      assert.equal(evidence.garden_local_date, "2026-08-01");
      assert.equal(evidence.garden_local_time, captureID === "garden-day" ? "09:41" : "17:41");
      assert.equal(evidence.garden_phase, captureID === "garden-day" ? "day" : "dusk");
      assert.equal(evidence.captured_at, proof.captured_at);
      assert.equal(evidence.system_timezone, "Etc/UTC");
      assert.doesNotThrow(() => assertCaptureSourceEvidence(evidence, expected));
    }
  }
}

assert.deepEqual(
  captureIDs.map((id) => expectedCaptureAppearance(id)),
  ["dark", "light", "dark", "light", "light", "light"],
);
assert.equal(gardenPhaseAt("04:59"), "night");
assert.equal(gardenPhaseAt("05:00"), "dawn");
assert.equal(gardenPhaseAt("07:59"), "dawn");
assert.equal(gardenPhaseAt("08:00"), "day");
assert.equal(gardenPhaseAt("16:59"), "day");
assert.equal(gardenPhaseAt("17:00"), "dusk");
assert.equal(gardenPhaseAt("19:59"), "dusk");
assert.equal(gardenPhaseAt("20:00"), "night");

const selected = expectation("iphone-6.9", "en-US", "garden-seed");
const selectedProof = proofFor(selected);
assert.throws(
  () => parseCaptureBuildProof({ ...selectedProof, clock_fixture_id: "day-v1" }, {
    capture_id: selected.capture_id, locale: selected.locale,
    source_commit: source.source_commit, source_revision: source.source_revision,
  }),
  /current signed source or clock fixture/,
);
assert.throws(
  () => parseCaptureBuildProof({ ...selectedProof, clock_epoch: "1785548460" }, {
    capture_id: selected.capture_id, locale: selected.locale,
    source_commit: source.source_commit, source_revision: source.source_revision,
  }),
  /current signed source or clock fixture/,
);
assert.throws(
  () => parseCaptureBuildProof({ ...selectedProof, timezone: "UTC" }, {
    capture_id: selected.capture_id, locale: selected.locale,
    source_commit: source.source_commit, source_revision: source.source_revision,
  }),
  /current signed source or clock fixture/,
);
assert.throws(
  () => parseCaptureBuildProof({ ...selectedProof, garden_phase: "day" }, {
    capture_id: selected.capture_id, locale: selected.locale,
    source_commit: source.source_commit, source_revision: source.source_revision,
  }),
  /current signed source or clock fixture/,
);
assert.throws(
  () => parseCaptureBuildProof({ ...selectedProof, captured_at: "2026-02-30T03:22:14Z" }, {
    capture_id: selected.capture_id, locale: selected.locale,
    source_commit: source.source_commit, source_revision: source.source_revision,
  }),
  /invalid calendar date/,
);
assert.throws(
  () => parseCaptureBuildProof({ ...selectedProof, system_timezone: "Definitely/Not_A_Zone" }, {
    capture_id: selected.capture_id, locale: selected.locale,
    source_commit: source.source_commit, source_revision: source.source_revision,
  }),
  /valid IANA timezone/,
);
assert.throws(
  () => parseCaptureBuildProof({ ...selectedProof, source_revision: "0".repeat(64) }, {
    capture_id: selected.capture_id, locale: selected.locale,
    source_commit: source.source_commit, source_revision: source.source_revision,
  }),
  /current signed source or clock fixture/,
);

const selectedEvidence = makeCaptureSourceEvidence(selected, selectedProof);
assert.throws(
  () => assertCaptureSourceEvidence({ ...selectedEvidence, clock_fixture_id: "day-v1" }, selected),
  /unknown clock fixture|source-bound fixture/,
);
assert.throws(
  () => assertCaptureSourceEvidence({ ...selectedEvidence, garden_local_time: "09:41" }, selected),
  /source-bound fixture/,
);
assert.throws(
  () => assertCaptureSourceEvidence({ ...selectedEvidence, captured_at: "not-a-timestamp" }, selected),
  /ISO-8601 UTC instant/,
);
assert.throws(
  () => assertCaptureSourceEvidence({ ...selectedEvidence, system_timezone: "Mars/Olympus" }, selected),
  /valid IANA timezone/,
);
assert.throws(
  () => assertCaptureSourceEvidence({ ...selectedEvidence, source_revision: "0".repeat(64) }, selected),
  /current source manifest\/device/,
);
assert.throws(
  () => assertCaptureSourceEvidence({ ...selectedEvidence, build_proof_sha256: "0".repeat(64) }, selected),
  /current source manifest\/device/,
);
assert.throws(
  () => assertCaptureSourceEvidence({ ...selectedEvidence, result_bundle: { ...selectedEvidence.result_bundle, xcresult_tree_sha256: "0".repeat(64) } }, selected),
  /different result bundle/,
);
assert.throws(
  () => assertCaptureSourceEvidence({ ...selectedEvidence, test_identifier: expectedCaptureTestIdentifier("en-US", "garden-day") }, selected),
  /test identifier mismatch/,
);

process.stdout.write("Simulator capture evidence passed: phone/iPad fixture proofs and source, bundle, locale, timestamp, timezone, phase, and appearance negative controls.\n");
