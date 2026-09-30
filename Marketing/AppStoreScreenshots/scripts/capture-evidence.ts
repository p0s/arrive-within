import type {
  CaptureAppearance,
  CaptureRole,
  CurrentDeviceId,
  GardenPhase,
  LocaleId,
} from "./contracts";
import {
  expectedClockFixtureIDForCapture,
  marketingClockFixture,
} from "./marketing-clock-fixtures";

export const CAPTURE_IDS = [
  "garden-hero",
  "garden-day",
  "garden-seed",
  "journey-calendar",
  "journey-milestones",
  "journal",
] as const;

export type CaptureId = typeof CAPTURE_IDS[number];

export type CaptureSourceEvidence = {
  device: CurrentDeviceId;
  source_commit: string;
  build_proof_sha256: string;
  source_revision: string;
  source_manifest_path: string;
  source_manifest_sha256: string;
  result_bundle: { role: CaptureRole; name: string; xcresult_tree_sha256: string };
  test_identifier: string;
  clock_fixture_id: "day-v1" | "dusk-v1";
  clock_epoch: string;
  garden_local_date: string;
  garden_local_time: string;
  timezone: "Asia/Singapore";
  garden_phase: GardenPhase;
  captured_at: string;
  system_timezone: string;
  appearance: CaptureAppearance;
};

export type CaptureEvidenceExpectation = {
  device: CurrentDeviceId;
  locale: LocaleId;
  capture_id: CaptureId;
  source_commit: string;
  build_proof_sha256: string;
  source_revision: string;
  source_manifest_path: string;
  source_manifest_sha256: string;
  result_bundle: { role: CaptureRole; name: string; xcresult_tree_sha256: string };
};

export type CaptureBuildProof = {
  schema: "arrive-within-capture-build-proof/v2";
  capture_id: CaptureId;
  locale: LocaleId;
  bundle_id: "com.philipps.arrivewithin.ios";
  marketing_version: "1.0.2";
  build_number: "19";
  appearance: CaptureAppearance;
  source_commit: string;
  source_revision: string;
  clock_fixture_id: "day-v1" | "dusk-v1";
  clock_epoch: string;
  timezone: "Asia/Singapore";
  garden_phase: "day" | "dusk";
  captured_at: string;
  system_timezone: string;
};

const LOCALES: LocaleId[] = ["en-US", "de-DE"];
const DEVICES: CurrentDeviceId[] = ["iphone-6.9", "ipad-13"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[], context: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${context}: expected exactly keys ${wanted.join(", ")}`);
  }
}

function sha256(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${context}: expected a lowercase SHA-256`);
  }
}

function assertCapturedAt(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    throw new Error(`${context}: captured_at must be an ISO-8601 UTC instant`);
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error(`${context}: captured_at is invalid`);
  const seconds = value.replace(/\.\d+Z$/, "Z");
  if (new Date(seconds).toISOString().slice(0, 19) !== seconds.slice(0, 19)) {
    throw new Error(`${context}: captured_at has an invalid calendar date or time`);
  }
}

function assertIanaTimezone(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new Error(`${context}: system_timezone is missing or invalid`);
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date(0));
  } catch {
    throw new Error(`${context}: system_timezone is not a valid IANA timezone`);
  }
}

export function parseCaptureBuildProof(
  value: unknown,
  expected: { capture_id: CaptureId; locale: LocaleId; source_commit: string; source_revision: string },
): CaptureBuildProof {
  if (!isRecord(value)) throw new Error("capture build proof must be a JSON object");
  exactKeys(value, [
    "schema", "capture_id", "locale", "bundle_id", "marketing_version", "build_number", "appearance",
    "source_commit", "source_revision", "clock_fixture_id", "clock_epoch", "timezone", "garden_phase", "captured_at", "system_timezone",
  ], "capture build proof");
  const fixture = marketingClockFixture(value.clock_fixture_id);
  assertCapturedAt(value.captured_at, "capture build proof");
  assertIanaTimezone(value.system_timezone, "capture build proof");
  if (
    value.schema !== "arrive-within-capture-build-proof/v2" ||
    value.capture_id !== expected.capture_id || value.locale !== expected.locale ||
    value.bundle_id !== "com.philipps.arrivewithin.ios" ||
    value.marketing_version !== "1.0.2" || value.build_number !== "19" ||
    value.appearance !== expectedCaptureAppearance(expected.capture_id) ||
    value.source_commit !== expected.source_commit || value.source_revision !== expected.source_revision ||
    typeof value.source_commit !== "string" || !/^[a-f0-9]{40}$/.test(value.source_commit) ||
    typeof value.source_revision !== "string" || !/^[a-f0-9]{64}$/.test(value.source_revision) ||
    value.clock_fixture_id !== expectedClockFixtureIDForCapture(expected.capture_id) ||
    value.clock_epoch !== String(fixture.epoch) || value.timezone !== fixture.timezone ||
    value.garden_phase !== fixture.garden_phase
  ) throw new Error("capture build proof does not match the current signed source or clock fixture");
  return value as CaptureBuildProof;
}

export function parseVisibleStatusTime(value: unknown, context: string): { hour: number; minute: number } {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`${context}: expected exact visible local time HH:MM`);
  }
  return { hour: Number(value.slice(0, 2)), minute: Number(value.slice(3, 5)) };
}

export function gardenPhaseAt(localTime: string): GardenPhase {
  const { hour } = parseVisibleStatusTime(localTime, "Garden phase time");
  if (hour < 5) return "night";
  if (hour < 8) return "dawn";
  if (hour < 17) return "day";
  if (hour < 20) return "dusk";
  return "night";
}

export function expectedCaptureRole(captureID: CaptureId): CaptureRole {
  return captureID === "garden-day" ? "garden-day" : "selected";
}

export function expectedCaptureTestIdentifier(locale: LocaleId, captureID: CaptureId): string {
  const language = locale === "en-US" ? "English" : "German";
  return captureID === "garden-day"
    ? `ArriveWithinMarketingCaptureUITests/testCaptureGardenDay${language}()`
    : `ArriveWithinMarketingCaptureUITests/testCaptureAllRequiredMarketingStates${language}()`;
}

export function expectedCaptureAppearance(captureID: CaptureId): CaptureAppearance {
  return captureID === "garden-seed" || captureID === "garden-hero" ? "dark" : "light";
}

export function matchesCaptureProofAttachmentName(
  suggestedName: unknown,
  expectedBaseName: string,
): boolean {
  if (typeof suggestedName !== "string") return false;
  const baseName = suggestedName.split(/[\\/]/).at(-1) ?? "";
  if (baseName === `${expectedBaseName}.json`) return true;
  const suffixPrefix = `${expectedBaseName}_0_`;
  if (!baseName.startsWith(suffixPrefix) || !baseName.endsWith(".json")) return false;
  const xcresultSuffix = baseName.slice(suffixPrefix.length, -".json".length);
  return /^[A-Za-z0-9_-]{1,128}$/.test(xcresultSuffix);
}

export function makeCaptureSourceEvidence(
  expected: CaptureEvidenceExpectation,
  proof: CaptureBuildProof,
): CaptureSourceEvidence {
  const fixture = marketingClockFixture(proof.clock_fixture_id);
  const evidence: CaptureSourceEvidence = {
    device: expected.device,
    source_commit: expected.source_commit,
    build_proof_sha256: expected.build_proof_sha256,
    source_revision: expected.source_revision,
    source_manifest_path: expected.source_manifest_path,
    source_manifest_sha256: expected.source_manifest_sha256,
    result_bundle: { ...expected.result_bundle },
    test_identifier: expectedCaptureTestIdentifier(expected.locale, expected.capture_id),
    clock_fixture_id: fixture.id,
    clock_epoch: String(fixture.epoch),
    garden_local_date: fixture.local_date,
    garden_local_time: fixture.local_time,
    timezone: fixture.timezone,
    garden_phase: fixture.garden_phase,
    captured_at: proof.captured_at,
    system_timezone: proof.system_timezone,
    appearance: expectedCaptureAppearance(expected.capture_id),
  };
  assertCaptureSourceEvidence(evidence, expected);
  return evidence;
}

export function assertCaptureSourceEvidence(
  value: unknown,
  expected: CaptureEvidenceExpectation,
): asserts value is CaptureSourceEvidence {
  if (!isRecord(value)) throw new Error(`${expected.device}/${expected.locale}/${expected.capture_id}: missing source evidence`);
  exactKeys(value, [
    "device", "source_commit", "build_proof_sha256", "source_revision", "source_manifest_path", "source_manifest_sha256", "result_bundle",
    "test_identifier", "clock_fixture_id", "clock_epoch", "garden_local_date", "garden_local_time", "timezone", "garden_phase",
    "captured_at", "system_timezone", "appearance",
  ], `${expected.device}/${expected.locale}/${expected.capture_id} source evidence`);
  const context = `${expected.device}/${expected.locale}/${expected.capture_id}`;
  if (
    value.device !== expected.device ||
    value.source_commit !== expected.source_commit ||
    value.build_proof_sha256 !== expected.build_proof_sha256 ||
    value.source_revision !== expected.source_revision ||
    value.source_manifest_path !== expected.source_manifest_path ||
    value.source_manifest_sha256 !== expected.source_manifest_sha256
  ) throw new Error(`${context}: capture source does not match the current source manifest/device`);
  if (typeof value.source_commit !== "string" || !/^[a-f0-9]{40}$/.test(value.source_commit)) {
    throw new Error(`${context}: capture source commit is invalid`);
  }
  sha256(value.build_proof_sha256, `${context} build proof hash`);
  const bundle = value.result_bundle;
  if (!isRecord(bundle)) throw new Error(`${context}: result bundle evidence is missing`);
  exactKeys(bundle, ["role", "name", "xcresult_tree_sha256"], `${context} result bundle evidence`);
  if (
    bundle.role !== expected.result_bundle.role ||
    bundle.name !== expected.result_bundle.name ||
    bundle.xcresult_tree_sha256 !== expected.result_bundle.xcresult_tree_sha256 ||
    typeof bundle.name !== "string" || !bundle.name.endsWith(".xcresult")
  ) throw new Error(`${context}: capture is bound to a different result bundle`);
  sha256(bundle.xcresult_tree_sha256, `${context} result bundle hash`);
  if (value.test_identifier !== expectedCaptureTestIdentifier(expected.locale, expected.capture_id)) {
    throw new Error(`${context}: capture test identifier mismatch`);
  }
  const fixture = marketingClockFixture(value.clock_fixture_id);
  assertCapturedAt(value.captured_at, `${context} source evidence`);
  assertIanaTimezone(value.system_timezone, `${context} source evidence`);
  if (
    value.clock_fixture_id !== expectedClockFixtureIDForCapture(expected.capture_id) ||
    value.clock_epoch !== String(fixture.epoch) ||
    value.garden_local_date !== fixture.local_date ||
    value.garden_local_time !== fixture.local_time ||
    value.timezone !== fixture.timezone ||
    value.garden_phase !== fixture.garden_phase
  ) throw new Error(`${context}: captured Garden clock does not match its source-bound fixture`);
  if (value.appearance !== expectedCaptureAppearance(expected.capture_id)) {
    throw new Error(`${context}: capture appearance does not match its selected test state`);
  }
  if (["garden-seed", "garden-hero"].includes(expected.capture_id) && fixture.garden_phase !== "dusk") {
    throw new Error(`${context}: dark Garden capture requires the dusk fixture`);
  }
  if (expected.capture_id === "garden-day" && fixture.garden_phase !== "day") {
    throw new Error(`${context}: Garden-day capture requires the day fixture`);
  }
  if (gardenPhaseAt(value.garden_local_time as string) !== fixture.garden_phase) {
    throw new Error(`${context}: shared fixture local time does not match its Garden phase`);
  }
  if (!DEVICES.includes(expected.device) || !LOCALES.includes(expected.locale)) {
    throw new Error(`${context}: unsupported device or locale`);
  }
}
