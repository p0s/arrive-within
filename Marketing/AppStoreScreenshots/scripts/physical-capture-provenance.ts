export const CAPTURE_STATUS_BAR_PROFILE =
  "Actual visible system status from every exact simulator attachment and physical screenshot; Garden-day time matches the unmodified SGT clock; no synthetic status-bar overlay.";

export function assertCaptureStatusBarProfile(value: unknown): asserts value is typeof CAPTURE_STATUS_BAR_PROFILE {
  if (value !== CAPTURE_STATUS_BAR_PROFILE) {
    throw new Error("truthful status-bar capture provenance is missing or inconsistent");
  }
}
