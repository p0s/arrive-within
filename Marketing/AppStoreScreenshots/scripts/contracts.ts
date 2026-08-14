import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export type DeviceId = "iphone-6.9" | "ipad-13";
export type LocaleId = "en-US" | "de-DE";

export type ScreenshotPlan = {
  schema_version: number;
  status: string;
  copy_state: string;
  source_policy: string;
  locales: LocaleId[];
  devices: Array<{ id: DeviceId; orientation: string; width: number; height: number }>;
  slides: Array<{
    index: number;
    id: string;
    idea: string;
    headline: Record<LocaleId, string[]>;
    runtime_surface: string;
  }>;
  expected_final_images: number;
  expected_slides_per_set: number;
  required_capture_ids: string[];
  renderer: string;
  network_policy: string;
  font_policy: string;
  required_set_artifacts: string[];
  upload_authorization: string;
};

export type NarrativeSlide = {
  index: number;
  id: string;
  idea: string;
  headline: Record<LocaleId, string[]>;
  supporting_copy: Record<LocaleId, string>;
  runtime_surface: string;
  composition: string;
  capture_ids: string[];
};

export type NarrativeAlternatives = {
  schema_version: number;
  status: string;
  owner_selection: string | null;
  source_policy: string;
  locales: LocaleId[];
  devices: DeviceId[];
  slides_per_set: number;
  images_per_narrative: number;
  alternative_image_total: number;
  narratives: Array<{ id: string; title: string; slides: NarrativeSlide[] }>;
  required_capture_ids: string[];
  selection_policy: string;
  claim_boundary: string;
};

export type CaptureRecord = { path: string; sha256: string | null };

export type CaptureSet = {
  locale: LocaleId;
  device: DeviceId;
  model: string;
  os: string;
  width: number;
  height: number;
  result_bundle: {
    name: string;
    xcresult_tree_sha256: string;
    test_identifier: string;
  } | null;
  captures: Record<string, CaptureRecord>;
};

export type SourceCaptures = {
  schema_version: number;
  state: string;
  capture_method: string;
  capture_test: string;
  status_bar_profile: string;
  source_revision: string | null;
  source_revision_kind: string;
  source_manifest_path: string | null;
  human_visual_review?: {
    state: "approved";
    reviewer: string;
    reviewed_on: string;
    notes: string;
  };
  post_capture_change?: import("./capture-drift-policy").SubmittedBuildCaptureFreeze;
  result_bundles: Array<{
    device: DeviceId;
    name: string;
    xcresult_tree_sha256: string;
    passed_tests: number;
    failed_tests: number;
    skipped_tests: number;
  }>;
  safe_synthetic_data: boolean;
  sets: CaptureSet[];
};

async function loadJson<T>(filename: string): Promise<T> {
  return JSON.parse(await readFile(path.join(ROOT, filename), "utf8")) as T;
}

export async function loadPlan(): Promise<ScreenshotPlan> {
  return loadJson<ScreenshotPlan>("screenshot-plan.json");
}

export async function loadNarrativeAlternatives(): Promise<NarrativeAlternatives> {
  return loadJson<NarrativeAlternatives>("narrative-alternatives.json");
}

export async function loadSourceCaptures(): Promise<SourceCaptures> {
  return loadJson<SourceCaptures>("source-captures.json");
}

export function isAllowedCaptureRequest(requestURL: string, targetOrigin: string): boolean {
  try {
    const candidate = new URL(requestURL);
    return candidate.protocol === "data:"
      || candidate.protocol === "blob:"
      || candidate.origin === targetOrigin;
  } catch {
    return false;
  }
}

export function resolveBoundedChildPath(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error("bounded path must be relative");
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("bounded path escapes its root");
  }
  return resolved;
}

export function assertPlan(plan: ScreenshotPlan): void {
  const expectedLocales = ["en-US", "de-DE"];
  const expectedDevices = [
    { id: "iphone-6.9", width: 1320, height: 2868 },
    { id: "ipad-13", width: 2064, height: 2752 },
  ];
  const expectedSlideIds = [
    "growth-arrive",
    "growth-take-root",
    "growth-rhythm",
    "growth-stays",
    "growth-reflect",
    "growth-refuge",
  ];
  const expectedCaptureIds = [
    "garden-hero",
    "garden-seed",
    "journey-calendar",
    "journey-milestones",
    "journal",
  ];

  if (plan.schema_version !== 1 || plan.status !== "implemented") {
    throw new Error("screenshot-plan.json must be schema 1 and implemented");
  }
  if (JSON.stringify(plan.locales) !== JSON.stringify(expectedLocales)) {
    throw new Error("screenshot-plan.json must declare en-US then de-DE");
  }
  if (plan.devices.length !== expectedDevices.length) throw new Error("exactly two output devices are required");
  expectedDevices.forEach((expected, index) => {
    const actual = plan.devices[index];
    if (
      actual.id !== expected.id ||
      actual.width !== expected.width ||
      actual.height !== expected.height ||
      actual.orientation !== "portrait"
    ) {
      throw new Error(`invalid output device at index ${index}`);
    }
  });
  if (plan.expected_slides_per_set !== 6 || plan.expected_final_images !== 24) {
    throw new Error("the matrix must remain six slides per set and 24 final images");
  }
  if (plan.slides.length !== 6 || plan.slides.some((slide, index) => slide.index !== index + 1)) {
    throw new Error("slides must have exact indices 1 through 6");
  }
  if (JSON.stringify(plan.slides.map((slide) => slide.id)) !== JSON.stringify(expectedSlideIds)) {
    throw new Error("slide order does not match the frozen narrative");
  }
  if (JSON.stringify(plan.required_capture_ids) !== JSON.stringify(expectedCaptureIds)) {
    throw new Error("required capture IDs do not match the real-UI source contract");
  }
  for (const slide of plan.slides) {
    if (!slide.idea.trim() || !slide.runtime_surface.trim()) throw new Error(`${slide.id}: missing idea or runtime surface`);
    for (const locale of expectedLocales as LocaleId[]) {
      const lines = slide.headline[locale];
      if (!Array.isArray(lines) || lines.length < 1 || lines.length > 3 || lines.some((line) => !line.trim())) {
        throw new Error(`${slide.id}/${locale}: headline must contain one to three nonempty fit lines`);
      }
    }
  }
  if (!plan.renderer.includes("Playwright") || !plan.network_policy.includes("Block all external")) {
    throw new Error("the renderer and external-network contracts must remain explicit");
  }
  const requiredArtifacts = [
    "numbered opaque RGB PNG files",
    "SHA-256 hashes",
    "_manifest.json",
    "_validation.txt",
    "_validation.json",
    "_contact-sheet.jpg",
    "ZIP archive",
    "human visual review state",
  ];
  for (const artifact of requiredArtifacts) {
    if (!plan.required_set_artifacts.includes(artifact)) throw new Error(`missing required artifact: ${artifact}`);
  }
  if (plan.upload_authorization !== "authorized-for-app-store-version-1.0-after-current-source-validation") {
    throw new Error("upload authorization boundary changed");
  }
}

export function assertNarrativeAlternatives(document: NarrativeAlternatives): void {
  const expectedLocales: LocaleId[] = ["en-US", "de-DE"];
  const expectedDevices: DeviceId[] = ["iphone-6.9", "ipad-13"];
  if (
    document.schema_version !== 1
    || document.status !== "source-reference-non-shipping"
    || document.owner_selection !== "garden-growth"
  ) {
    throw new Error("narrative alternatives must remain non-shipping source references with Garden/growth selected");
  }
  if (
    JSON.stringify(document.locales) !== JSON.stringify(expectedLocales)
    || JSON.stringify(document.devices) !== JSON.stringify(expectedDevices)
  ) {
    throw new Error("narrative locale/device matrix mismatch");
  }
  if (
    document.slides_per_set !== 6
    || document.images_per_narrative !== 24
    || document.alternative_image_total !== 72
    || document.narratives.length !== 3
  ) {
    throw new Error("three complete 24-image narrative matrices are required");
  }
  const narrativeIDs = new Set<string>();
  const slideIDs = new Set<string>();
  const usedCaptures = new Set<string>();
  const captureIDsByComposition: Record<string, string[]> = {
    "garden-single": ["garden-hero"],
    "garden-seed-single": ["garden-seed"],
    "garden-growth": ["garden-seed", "garden-hero"],
    "journey-calendar": ["journey-calendar"],
    "journey-milestones": ["journey-milestones"],
    journal: ["journal"],
  };
  for (const narrative of document.narratives) {
    if (!narrative.id.trim() || narrativeIDs.has(narrative.id) || !narrative.title.trim()) {
      throw new Error("narrative IDs and titles must be unique and nonempty");
    }
    narrativeIDs.add(narrative.id);
    if (narrative.slides.length !== document.slides_per_set) {
      throw new Error(`${narrative.id}: incomplete narrative`);
    }
    narrative.slides.forEach((slide, offset) => {
      if (slide.index !== offset + 1 || !slide.id.trim() || slideIDs.has(slide.id)) {
        throw new Error(`${narrative.id}: slide order or global ID uniqueness failed`);
      }
      slideIDs.add(slide.id);
      if (
        !slide.idea.trim()
        || !slide.runtime_surface.trim()
        || !slide.composition.trim()
        || slide.capture_ids.length < 1
      ) {
        throw new Error(`${slide.id}: incomplete product or capture contract`);
      }
      slide.capture_ids.forEach((captureID) => {
        if (!captureID.trim()) throw new Error(`${slide.id}: empty capture ID`);
        usedCaptures.add(captureID);
      });
      const expectedCaptureIDs = captureIDsByComposition[slide.composition];
      if (!expectedCaptureIDs || JSON.stringify(slide.capture_ids) !== JSON.stringify(expectedCaptureIDs)) {
        throw new Error(`${slide.id}: composition does not match its source-faithful capture contract`);
      }
      for (const locale of expectedLocales) {
        const lines = slide.headline[locale];
        if (
          !Array.isArray(lines)
          || lines.length < 1
          || lines.length > 3
          || lines.some((line) => !line.trim() || line.length > 28)
          || !slide.supporting_copy[locale]?.trim()
        ) {
          throw new Error(`${slide.id}/${locale}: localized copy contract failed`);
        }
      }
    });
  }
  if (JSON.stringify([...usedCaptures].sort()) !== JSON.stringify([...document.required_capture_ids].sort())) {
    throw new Error("declared capture union does not match narrative use");
  }
  if (
    JSON.stringify([...document.required_capture_ids].sort())
    !== JSON.stringify(["garden-hero", "garden-seed", "journal", "journey-calendar", "journey-milestones"])
  ) {
    throw new Error("narrative alternatives must use only the retained zero-narration/local-only capture allowlist");
  }
  if (!document.selection_policy.includes("only one") || !document.claim_boundary.includes("Final images require")) {
    throw new Error("narrative selection and evidence boundaries must remain explicit");
  }
  const serialized = JSON.stringify(document);
  for (const forbiddenClaim of [
    "42 practices",
    "42 Meditationen",
    "guided-library",
    "active-captions",
    "Private iCloud",
    "Privat über iCloud",
    "data-sync",
  ]) {
    if (serialized.includes(forbiddenClaim)) {
      throw new Error(`narrative alternatives contain obsolete V1 claim: ${forbiddenClaim}`);
    }
  }
}

export function findCaptureSet(captures: SourceCaptures, locale: LocaleId, device: DeviceId): CaptureSet {
  const result = captures.sets.find((item) => item.locale === locale && item.device === device);
  if (!result) throw new Error(`missing capture set ${locale}/${device}`);
  return result;
}
