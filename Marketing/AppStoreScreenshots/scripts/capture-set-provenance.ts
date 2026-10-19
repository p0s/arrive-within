import type { CaptureSet, CurrentDeviceId } from "./contracts";

export const SELECTED_CAPTURE_IDS = [
  "garden-hero",
  "garden-day",
  "garden-seed",
  "journey-calendar",
  "journey-milestones",
  "journal",
] as const;

export type CurrentCaptureSourceBinding = {
  source_revision: string;
  source_manifest_path: string;
  source_manifest_sha256: string;
};

export function assertCaptureSetSourceBinding(
  set: Pick<CaptureSet, "device" | "capture_source">,
  current: CurrentCaptureSourceBinding,
): void {
  const source = set.capture_source;
  if (
    source.state !== "current" ||
    source.source_revision !== current.source_revision ||
    source.source_manifest_path !== current.source_manifest_path ||
    source.source_manifest_sha256 !== current.source_manifest_sha256 ||
    source.app_version !== "1.0.2" ||
    source.build_number !== "19" ||
    JSON.stringify(source.bound_capture_ids) !== JSON.stringify(SELECTED_CAPTURE_IDS) ||
    source.missing_capture_ids.length !== 0
  ) {
    throw new Error(`${set.device}: capture set is not bound to the current 1.0.2 (19) source manifest`);
  }
}

export function expectedCaptureSetState(_device: CurrentDeviceId): "current" {
  return "current";
}
