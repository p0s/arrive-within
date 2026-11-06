import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmod, cp, link, lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertSimulatorBundleContract } from "./validate-captures";
import type { CaptureResultBundle, DeviceId } from "./contracts";
import { expectedClockFixtureID, marketingClockFixture } from "./marketing-clock-fixtures";
import { expectedCaptureTestIdentifier } from "./capture-evidence";
import {
  assertDurableProducerDevice,
  assertTrustedSimulatorResultsRoot,
  resolveSimulatorPoolResult,
  type SimulatorPoolRoots,
} from "./simulator-result-paths";

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

// Durable originals: synthetic pool roots with the installed producer layout.
async function durableOriginalControls(): Promise<number> {
  const base = await realpath(await mkdtemp(path.join(os.tmpdir(), "arrive-within-durable-originals-")));
  const roots: SimulatorPoolRoots = {
    temporaryRoot: path.join(base, "temporary-results"),
    originalsRoot: path.join(base, "originals"),
    receiptsRoot: path.join(base, "receipts"),
  };
  const project = path.join(base, "project");
  const simulatorID = randomUUID().toUpperCase();
  let controls = 0;
  const token = () => `20261106T094449Z-${1000 + controls}-${randomBytes(5).toString("hex")}`;

  async function receipt(id: string, changes: (body: Record<string, any>) => void = () => {}): Promise<string> {
    const container = path.join(roots.originalsRoot, id);
    const result = path.join(container, "original.xcresult");
    const [containerStat, resultStat] = [await lstat(container), await lstat(result)];
    const body: Record<string, any> = {
      schema_version: 3, completed_at: 1, durable: true, deletion_authority: false,
      result, result_present: true, device: resultStat.dev, inode: resultStat.ino, ctime_ns: 0,
      published_result: null, status: "passed", exit_code: 0,
      registration: { status: "registered", eligible: true, holds: [], reason: null },
      inventory_sha256: "0".repeat(64),
      producer: {
        container, container_device: containerStat.dev, container_inode: containerStat.ino,
        owner: project, head: "4".repeat(40), tool_sha256: "1".repeat(64), config_sha256: "2".repeat(64),
        command_sha256: "3".repeat(64), xctestrun_sha256: null, udid: simulatorID, device_family: "iPhone",
      },
    };
    changes(body);
    const file = path.join(roots.receiptsRoot, `${id}.completion.json`);
    await writeFile(file, `${JSON.stringify(body)}\n`, { mode: 0o600 });
    return file;
  }

  async function original(options: { id?: string; receiptChanges?: (body: Record<string, any>) => void; withReceipt?: boolean } = {}) {
    const id = options.id ?? token();
    const container = path.join(roots.originalsRoot, id);
    await mkdir(path.join(container, "original.xcresult"), { recursive: true, mode: 0o700 });
    await chmod(container, 0o700);
    await writeFile(path.join(container, "original.log"), "log\n");
    const file = options.withReceipt === false ? null : await receipt(id, options.receiptChanges);
    return { id, container, result: path.join(container, "original.xcresult"), receipt: file };
  }

  async function rejects(input: string, pattern: RegExp, overrides: Partial<SimulatorPoolRoots> = {}, configured?: string) {
    controls += 1;
    await assert.rejects(resolveSimulatorPoolResult(input, project, { ...roots, ...overrides }, configured), pattern);
  }

  try {
    for (const directory of [roots.temporaryRoot, roots.originalsRoot, roots.receiptsRoot, project]) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
    }

    const valid = await original();
    const resolved = await resolveSimulatorPoolResult(valid.result, project, roots, undefined);
    assert.equal(resolved.layout, "durable");
    assert.equal(resolved.result, valid.result);
    assert.equal(resolved.layout === "durable" && resolved.receipt.producer.head, "4".repeat(40));
    assert.equal((await resolveSimulatorPoolResult(path.relative(project, valid.result), project, roots, undefined)).layout, "durable");
    if (resolved.layout !== "durable") throw new Error("durable original was not resolved");
    const validReceipt = resolved.receipt;
    assert.doesNotThrow(() => assertDurableProducerDevice(validReceipt, "iPhone", simulatorID));
    assert.throws(() => assertDurableProducerDevice(validReceipt, "iPad", simulatorID), /producer does not match/);
    assert.throws(() => assertDurableProducerDevice(validReceipt, "iPhone", randomUUID().toUpperCase()), /producer does not match/);
    controls += 2;

    // The older temporary layout and its explicit root confirmation still work.
    const temporary = path.join(roots.temporaryRoot, `${token()}.xcresult`);
    await mkdir(temporary);
    assert.equal((await resolveSimulatorPoolResult(temporary, project, roots, roots.temporaryRoot)).layout, "temporary");
    await rejects(temporary, /installed simulator-pool result directory/, {}, roots.originalsRoot);

    // Arbitrary, outside and lookalike roots.
    for (const outside of ["elsewhere", "originals-copy", "temporary-results-archive"]) {
      const result = path.join(base, outside, token(), "original.xcresult");
      await mkdir(result, { recursive: true });
      await rejects(result, /supported simulator-pool root/);
    }
    await rejects(roots.originalsRoot, /supported simulator-pool root/);

    // Only the exact producer layout is an original.
    for (const relative of [["not-a-run-token", "original.xcresult"], [token(), "nested", "original.xcresult"], [token(), "copy.xcresult"]]) {
      const result = path.join(roots.originalsRoot, ...relative);
      await mkdir(result, { recursive: true, mode: 0o700 });
      await rejects(result, /<run token>\/original\.xcresult/);
    }
    const extra = await original();
    await writeFile(path.join(extra.container, "marker.json"), "{}\n");
    await rejects(extra.result, /exactly the original bundle and its log/);
    const missingLog = await original();
    await rm(path.join(missingLog.container, "original.log"));
    await rejects(missingLog.result, /exactly the original bundle and its log/);
    const shared = await original();
    await chmod(shared.container, 0o755);
    await rejects(shared.result, /not private to its producer/);

    // Symbolic links and escapes.
    const linkedBundle = await original();
    await rm(linkedBundle.result, { recursive: true });
    await symlink(valid.result, linkedBundle.result);
    await rejects(linkedBundle.result, /not a regular directory/);
    const linkedContainer = path.join(roots.originalsRoot, token());
    await symlink(valid.container, linkedContainer);
    await rejects(path.join(linkedContainer, "original.xcresult"), /canonical path without symbolic links/);
    const outsideLink = path.join(base, "outside-link");
    await symlink(valid.container, outsideLink);
    await rejects(path.join(outsideLink, "original.xcresult"), /canonical path without symbolic links/);
    const linkedRoot = path.join(base, "originals-link");
    await symlink(roots.originalsRoot, linkedRoot);
    await rejects(path.join(linkedRoot, valid.id, "original.xcresult"), /must not be reached through a symbolic link/, { originalsRoot: linkedRoot });
    const linkedReceipts = path.join(base, "receipts-link");
    await symlink(roots.receiptsRoot, linkedReceipts);
    await rejects(valid.result, /must not be reached through a symbolic link/, { receiptsRoot: linkedReceipts });

    // Original producer evidence: a missing, unsafe or mismatching receipt is not a pool original.
    await rejects((await original({ withReceipt: false })).result, /receipt is missing/);
    const linkedReceipt = await original();
    await rm(linkedReceipt.receipt!);
    await symlink(valid.receipt!, linkedReceipt.receipt!);
    await rejects(linkedReceipt.result, /missing or not a regular file/);
    const readable = await original();
    await chmod(readable.receipt!, 0o644);
    await rejects(readable.result, /exclusive private producer file/);
    const hardLinked = await original();
    await link(hardLinked.receipt!, path.join(base, "receipt-hard-link.json"));
    await rejects(hardLinked.result, /exclusive private producer file/);
    await rejects((await original({ receiptChanges: (body) => { body.padding = "x".repeat(4096); } })).result, /exclusive private producer file/);
    const malformed = await original();
    await writeFile(malformed.receipt!, "{", { mode: 0o600 });
    await rejects(malformed.result, /receipt is malformed/);
    for (const change of [
      (body: Record<string, any>) => { body.status = "failed"; },
      (body: Record<string, any>) => { body.exit_code = 65; },
      (body: Record<string, any>) => { body.schema_version = 2; },
      (body: Record<string, any>) => { body.durable = false; },
      (body: Record<string, any>) => { body.result_present = false; },
      (body: Record<string, any>) => { body.deletion_authority = true; },
      (body: Record<string, any>) => { body.producer.head = "HEAD"; },
      (body: Record<string, any>) => { body.producer.device_family = "Mac"; },
      (body: Record<string, any>) => { body.producer.udid = "slot-alias"; },
    ]) await rejects((await original({ receiptChanges: change })).result, /not a passed durable original/);
    for (const change of [
      (body: Record<string, any>) => { body.result = valid.result; },
      (body: Record<string, any>) => { body.inode += 1; },
      (body: Record<string, any>) => { body.producer.container = valid.container; },
      (body: Record<string, any>) => { body.producer.container_inode += 1; },
    ]) await rejects((await original({ receiptChanges: change })).result, /does not match its producer completion receipt/);
    await rejects((await original({ receiptChanges: (body) => { body.producer.owner = base; } })).result, /produced by another checkout/);

    // A copied bundle cannot borrow an original's producer evidence.
    const copied = await original({ withReceipt: false });
    await rm(copied.result, { recursive: true });
    await cp(valid.result, copied.result, { recursive: true });
    await receipt(copied.id, (body) => {
      body.inode = validReceipt.inode;
      body.device = validReceipt.device;
    });
    await rejects(copied.result, /does not match its producer completion receipt/);
    return controls;
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

durableOriginalControls().then((controls) => {
  process.stdout.write(`Simulator bundle contract passed: four exact source-bound iPhone/iPad selected/day xcresults, negative provenance controls, and ${controls} durable-original controls.\n`);
}).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
