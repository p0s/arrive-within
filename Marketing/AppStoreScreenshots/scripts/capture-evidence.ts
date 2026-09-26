import type {
  CaptureAppearance,
  CaptureRole,
  CurrentDeviceId,
  GardenPhase,
  LocaleId,
} from "./contracts";

export const CAPTURE_IDS = [
  "garden-hero",
  "garden-day",
  "garden-seed",
  "journey-calendar",
  "journey-milestones",
  "journal",
] as const;

export type CaptureId = typeof CAPTURE_IDS[number];
export type CaptureTimeInput = {
  capture_local_date: string;
  visible_status_time: string;
  timezone: "Asia/Singapore";
};

export type CaptureEvidenceInput = {
  source_bindings: Record<"iphone-6.9", Record<CaptureRole, {
    source_revision: string;
    source_manifest_path: string;
    source_manifest_sha256: string;
  }>>;
  captures: Record<"iphone-6.9", Record<LocaleId, Record<CaptureId, CaptureTimeInput>>>;
};

export type CaptureSourceEvidence = {
  device: CurrentDeviceId;
  source_commit: string;
  build_proof_sha256: string;
  source_revision: string;
  source_manifest_path: string;
  source_manifest_sha256: string;
  result_bundle: { role: CaptureRole; name: string; xcresult_tree_sha256: string };
  test_identifier: string;
  capture_local_date: string;
  visible_status_time: string;
  timezone: "Asia/Singapore";
  garden_phase: GardenPhase;
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
  schema: "arrive-within-capture-build-proof/v1";
  capture_id: CaptureId;
  locale: LocaleId;
  bundle_id: "com.philipps.arrivewithin.ios";
  marketing_version: "1.0.2";
  build_number: "19";
  appearance: CaptureAppearance;
  source_commit: string;
  source_revision: string;
};

const DEVICES = ["iphone-6.9"] as const;
const LOCALES: LocaleId[] = ["en-US", "de-DE"];
const ROLES: CaptureRole[] = ["selected", "garden-day"];

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

function validDate(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${context}: expected local date YYYY-MM-DD`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== value) throw new Error(`${context}: invalid local date`);
}

export function parseCaptureBuildProof(
  value: unknown,
  expected: { capture_id: CaptureId; locale: LocaleId; source_commit: string; source_revision: string },
): CaptureBuildProof {
  if (!isRecord(value)) throw new Error("capture build proof must be a JSON object");
  exactKeys(value, [
    "schema", "capture_id", "locale", "bundle_id", "marketing_version", "build_number", "appearance", "source_commit", "source_revision",
  ], "capture build proof");
  if (
    value.schema !== "arrive-within-capture-build-proof/v1" ||
    value.capture_id !== expected.capture_id || value.locale !== expected.locale ||
    value.bundle_id !== "com.philipps.arrivewithin.ios" ||
    value.marketing_version !== "1.0.2" || value.build_number !== "19" ||
    value.appearance !== expectedCaptureAppearance(expected.capture_id) ||
    value.source_commit !== expected.source_commit || value.source_revision !== expected.source_revision ||
    typeof value.source_commit !== "string" || !/^[a-f0-9]{40}$/.test(value.source_commit) ||
    typeof value.source_revision !== "string" || !/^[a-f0-9]{64}$/.test(value.source_revision)
  ) throw new Error("capture build proof does not match the current signed build and source");
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

function assertTimeInput(value: unknown, captureID: CaptureId, context: string): CaptureTimeInput {
  if (!isRecord(value)) throw new Error(`${context}: missing per-capture time evidence`);
  exactKeys(value, ["capture_local_date", "visible_status_time", "timezone"], context);
  validDate(value.capture_local_date, context);
  parseVisibleStatusTime(value.visible_status_time, context);
  if (value.timezone !== "Asia/Singapore") throw new Error(`${context}: timezone must be Asia/Singapore`);
  const phase = gardenPhaseAt(value.visible_status_time as string);
  if (["garden-seed", "garden-hero"].includes(captureID) && !["dusk", "night"].includes(phase)) {
    throw new Error(`${context}: dark Garden capture requires a dusk/night local status time`);
  }
  if (captureID === "garden-day" && phase !== "day") {
    throw new Error(`${context}: light Garden-day capture requires a Day-phase local status time (08:00–16:59)`);
  }
  return value as CaptureTimeInput;
}

export function parseCaptureEvidenceInput(
  value: unknown,
  currentSource: { source_revision: string; source_manifest_path: string; source_manifest_sha256: string },
): CaptureEvidenceInput {
  if (!isRecord(value)) throw new Error("capture evidence input must be an object");
  exactKeys(value, ["source_bindings", "captures"], "capture evidence input");
  if (!isRecord(value.source_bindings) || !isRecord(value.captures)) {
    throw new Error("capture evidence input must contain source_bindings and captures maps");
  }
  exactKeys(value.source_bindings, [...DEVICES], "source_bindings");
  exactKeys(value.captures, [...DEVICES], "captures");

  const sourceBindings = {} as CaptureEvidenceInput["source_bindings"];
  const captures = {} as CaptureEvidenceInput["captures"];
  for (const device of DEVICES) {
    const deviceBindings = value.source_bindings[device];
    if (!isRecord(deviceBindings)) throw new Error(`${device}: source bindings must be an object`);
    exactKeys(deviceBindings, ROLES, `${device} source bindings`);
    const roles = {} as CaptureEvidenceInput["source_bindings"][typeof device];
    for (const role of ROLES) {
      const binding = deviceBindings[role];
      if (!isRecord(binding)) throw new Error(`${device}/${role}: source binding must be an object`);
      exactKeys(binding, ["source_revision", "source_manifest_path", "source_manifest_sha256"], `${device}/${role} source binding`);
      sha256(binding.source_revision, `${device}/${role} source revision`);
      sha256(binding.source_manifest_sha256, `${device}/${role} source manifest`);
      if (typeof binding.source_manifest_path !== "string" || !binding.source_manifest_path) {
        throw new Error(`${device}/${role}: source manifest path must be a non-empty string`);
      }
      if (
        binding.source_revision !== currentSource.source_revision ||
        binding.source_manifest_path !== currentSource.source_manifest_path ||
        binding.source_manifest_sha256 !== currentSource.source_manifest_sha256
      ) throw new Error(`${device}/${role}: result bundle was captured from a different source manifest`);
      roles[role] = {
        source_revision: binding.source_revision,
        source_manifest_path: binding.source_manifest_path,
        source_manifest_sha256: binding.source_manifest_sha256,
      };
    }
    sourceBindings[device] = roles;

    const deviceCaptures = value.captures[device];
    if (!isRecord(deviceCaptures)) throw new Error(`${device}: capture time map must be an object`);
    exactKeys(deviceCaptures, LOCALES, `${device} capture time map`);
    const localeCaptures = {} as CaptureEvidenceInput["captures"][typeof device];
    for (const locale of LOCALES) {
      const captureTimes = deviceCaptures[locale];
      if (!isRecord(captureTimes)) throw new Error(`${device}/${locale}: capture time map must be an object`);
      exactKeys(captureTimes, [...CAPTURE_IDS], `${device}/${locale} capture time map`);
      const parsedTimes = {} as CaptureEvidenceInput["captures"][typeof device][typeof locale];
      for (const captureID of CAPTURE_IDS) {
        parsedTimes[captureID] = assertTimeInput(captureTimes[captureID], captureID, `${device}/${locale}/${captureID}`);
      }
      localeCaptures[locale] = parsedTimes;
    }
    captures[device] = localeCaptures;
  }
  return { source_bindings: sourceBindings, captures };
}

export function makeCaptureSourceEvidence(
  expected: CaptureEvidenceExpectation,
  time: CaptureTimeInput,
): CaptureSourceEvidence {
  const evidence: CaptureSourceEvidence = {
    device: expected.device,
    source_commit: expected.source_commit,
    build_proof_sha256: expected.build_proof_sha256,
    source_revision: expected.source_revision,
    source_manifest_path: expected.source_manifest_path,
    source_manifest_sha256: expected.source_manifest_sha256,
    result_bundle: { ...expected.result_bundle },
    test_identifier: expectedCaptureTestIdentifier(expected.locale, expected.capture_id),
    capture_local_date: time.capture_local_date,
    visible_status_time: time.visible_status_time,
    timezone: time.timezone,
    garden_phase: gardenPhaseAt(time.visible_status_time),
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
    "test_identifier", "capture_local_date", "visible_status_time", "timezone", "garden_phase", "appearance",
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
  const testIdentifier = expectedCaptureTestIdentifier(expected.locale, expected.capture_id);
  if (value.test_identifier !== testIdentifier) throw new Error(`${context}: capture test identifier mismatch`);
  if (value.timezone !== "Asia/Singapore") throw new Error(`${context}: capture timezone mismatch`);
  validDate(value.capture_local_date, context);
  const phase = gardenPhaseAt(value.visible_status_time as string);
  if (value.garden_phase !== phase) throw new Error(`${context}: recorded Garden phase does not match visible local time`);
  if (value.appearance !== expectedCaptureAppearance(expected.capture_id)) {
    throw new Error(`${context}: capture appearance does not match its selected test state`);
  }
  if (["garden-seed", "garden-hero"].includes(expected.capture_id) && !["dusk", "night"].includes(phase)) {
    throw new Error(`${context}: dark Garden capture is outside the dusk/night phase`);
  }
  if (expected.capture_id === "garden-day" && phase !== "day") {
    throw new Error(`${context}: Garden-day capture is outside the 08:00–16:59 Day phase`);
  }
  parseVisibleStatusTime(value.visible_status_time, context);
}
