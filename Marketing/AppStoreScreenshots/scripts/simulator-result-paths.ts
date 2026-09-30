import path from "node:path";

// The installed pool uses the standard temporary volume, independent of the user's home.
export const APPROVED_SIMULATOR_RESULTS_ROOT = path.join(
  path.sep, "tmp", "codex-ios-simulator-pool", "results",
);

export function assertTrustedSimulatorResultsRoot(candidate: string, trusted: string): void {
  if (path.resolve(candidate) !== path.resolve(trusted)) {
    throw new Error("configured xcresult root is not the installed simulator-pool result directory");
  }
}
