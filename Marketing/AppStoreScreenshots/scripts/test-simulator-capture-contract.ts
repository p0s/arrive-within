import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertSimulatorBundleContract } from "./validate-captures";
import type { CaptureResultBundle, DeviceId } from "./contracts";
import { expectedClockFixtureID, marketingClockFixture } from "./marketing-clock-fixtures";
import { expectedCaptureTestIdentifier } from "./capture-evidence";
import { assertTrustedSimulatorResultsRoot } from "./simulator-result-paths";

const current = {
  source_commit: "4".repeat(40),
  source_revision: "1".repeat(64),
  source_manifest_path: "capture-source-manifest-v1.0.2-build-19.json",
  source_manifest_sha256: "2".repeat(64),
};

function bundle(device: DeviceId, role: "selected" | "garden-day", hash: string): CaptureResultBundle {
  const tests = [
    expectedCaptureTestIdentifier("en-US", role === "garden-day" ? "garden-day" : "garden-seed"),
    expectedCaptureTestIdentifier("de-DE", role === "garden-day" ? "garden-day" : "garden-seed"),
  ].sort();
  const fixture = marketingClockFixture(expectedClockFixtureID(role));
  return {
    device,
    capture_role: role,
    name: `${device}-${role}-${hash.slice(0, 16)}.xcresult`,
    xcresult_tree_sha256: hash,
    passed_tests: 2,
    failed_tests: 0,
    skipped_tests: 0,
    source_commit: current.source_commit,
    source_revision: current.source_revision,
    source_manifest_path: current.source_manifest_path,
    source_manifest_sha256: current.source_manifest_sha256,
    test_identifiers: tests,
    runtime_warnings_by_test: Object.fromEntries(tests.map((test) => [test, []])),
    simulator: {
      model_name: device === "iphone-6.9" ? "iPhone 17 Pro" : "iPad Pro 13-inch (M5)",
      os_version: "26.5",
      platform: "iOS Simulator",
    },
    clock_fixture_id: fixture.id,
    clock_epoch: String(fixture.epoch),
    timezone: fixture.timezone,
    garden_phase: fixture.garden_phase,
  };
}

function validBundles(): CaptureResultBundle[] {
  return [
    bundle("iphone-6.9", "selected", "a".repeat(64)),
    bundle("iphone-6.9", "garden-day", "b".repeat(64)),
    bundle("ipad-13", "selected", "c".repeat(64)),
    bundle("ipad-13", "garden-day", "d".repeat(64)),
  ];
}

assert.doesNotThrow(() => assertSimulatorBundleContract(validBundles(), current));
assert.doesNotThrow(() => assertTrustedSimulatorResultsRoot("/pool/results", "/pool/results"));
assert.throws(() => assertTrustedSimulatorResultsRoot("/other/archive/results", "/pool/results"), /installed simulator-pool result directory/);

// Import in a fresh process so a relative TMPDIR cannot change the trusted root.
const relativeTemporaryDirectoryControl = spawnSync(process.execPath, [
  "--import", "tsx", "--input-type=module", "-e",
  `import assert from "node:assert/strict";
   import path from "node:path";
   import { APPROVED_SIMULATOR_RESULTS_ROOT, assertTrustedSimulatorResultsRoot }
     from ${JSON.stringify(new URL("./simulator-result-paths.ts", import.meta.url).href)};
   assert.equal(APPROVED_SIMULATOR_RESULTS_ROOT,
     path.join(path.sep, "tmp", "codex-ios-simulator-pool", "results"));
   assert.throws(() => assertTrustedSimulatorResultsRoot(
     path.resolve(process.env.TMPDIR, "codex-ios-simulator-pool", "results"),
     APPROVED_SIMULATOR_RESULTS_ROOT), /installed simulator-pool result directory/);`,
], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, TMPDIR: "relative", TSX_DISABLE_CACHE: "1" },
  encoding: "utf8",
});
assert.equal(relativeTemporaryDirectoryControl.status, 0,
  relativeTemporaryDirectoryControl.error?.message || relativeTemporaryDirectoryControl.stderr);

function rejects(change: (bundles: CaptureResultBundle[]) => void, pattern: RegExp): void {
  const bundles = structuredClone(validBundles());
  change(bundles);
  assert.throws(() => assertSimulatorBundleContract(bundles, current), pattern);
}

rejects((bundles) => { bundles.splice(3, 1); }, /exactly selected\/day simulator bundles/);
rejects((bundles) => { bundles.push(bundle("iphone-6.9", "selected", "e".repeat(64))); }, /exactly selected\/day simulator bundles/);
rejects((bundles) => { (bundles[2] as { device: string }).device = "ipad-11"; }, /exactly selected\/day simulator bundles/);
rejects((bundles) => { bundles[0]!.simulator!.model_name = "iPhone 16 Pro"; }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.simulator!.os_version = "26.4"; }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.simulator!.platform = "iOS"; }, /source, simulator, clock fixture/);
rejects((bundles) => { (bundles[0]!.simulator as unknown as Record<string, unknown>).udid = "ABCDEF-PRIVATE"; }, /simulator metadata: expected exactly keys/);
rejects((bundles) => { (bundles[0]!.simulator as unknown as Record<string, unknown>).device_name = "Pool Slot Alias"; }, /simulator metadata: expected exactly keys/);
rejects((bundles) => { bundles[0]!.source_commit = "0".repeat(40); }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.source_revision = "0".repeat(64); }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.source_manifest_path = "old-source.json"; }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.source_manifest_sha256 = "0".repeat(64); }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.passed_tests = 3; }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.failed_tests = 1; }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.skipped_tests = 1; }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.test_identifiers = ["unexpected-test()"] as never; }, /source, simulator, clock fixture/);
rejects((bundles) => { delete bundles[0]!.runtime_warnings_by_test![expectedCaptureTestIdentifier("en-US", "garden-seed")]; }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.runtime_warnings_by_test![expectedCaptureTestIdentifier("en-US", "garden-seed")] = [1] as never; }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.clock_fixture_id = "day-v1"; }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.clock_epoch = "1785548460"; }, /source, simulator, clock fixture/);
rejects((bundles) => { (bundles[0] as { timezone?: string }).timezone = "UTC"; }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[0]!.garden_phase = "day"; }, /source, simulator, clock fixture/);
rejects((bundles) => { bundles[1]!.name = bundles[0]!.name; }, /distinct result bundles/);
rejects((bundles) => { bundles[1]!.xcresult_tree_sha256 = bundles[0]!.xcresult_tree_sha256; }, /distinct result bundles/);

process.stdout.write("Simulator bundle contract passed: four exact source-bound iPhone/iPad selected/day xcresults and negative provenance controls.\n");
