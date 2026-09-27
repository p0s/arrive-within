import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { ROOT } from "./contracts";
import { computeCaptureSourceManifest, isIncidentalCaptureSourceEntry, loadCaptureSourceInputs } from "./source-provenance";

const projectRoot = path.resolve(ROOT, "../..");

async function main(): Promise<void> {
  const manifest = await computeCaptureSourceManifest();
  const inputs = await loadCaptureSourceInputs();
  const adapterPath = path.join(projectRoot, "scripts/app_store_physical_build_adapter.py");
  const pythonLoader = [
    "import importlib.util, json, sys",
    "spec = importlib.util.spec_from_file_location('physical_adapter', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "inputs = module.load_source_inputs()",
    "print(json.dumps({'inputs': inputs, 'paths': sorted(path for item in inputs for path in module.collect(item)), 'ignored': [module.is_incidental_capture_source_entry(name) for name in ['.DS_Store', '__pycache__', 'fixture.pyc', 'fixture.pyo', 'fixture.swift']]}))",
  ].join("; ");
  const adapter = JSON.parse(execFileSync("python3", ["-c", pythonLoader, adapterPath], {
    cwd: projectRoot,
    encoding: "utf8",
  })) as { inputs: string[]; paths: string[]; ignored: boolean[] };

  assert.deepEqual(manifest.inputs, inputs);
  assert.deepEqual(adapter.inputs, inputs, "the Python physical builder must consume the TypeScript manifest's canonical input list");
  assert.deepEqual(adapter.paths, manifest.files.map((file) => file.path), "TypeScript and Python must collect the same source files");
  const metadataNames = [".DS_Store", "__pycache__", "fixture.pyc", "fixture.pyo", "fixture.swift"];
  assert.deepEqual(metadataNames.map(isIncidentalCaptureSourceEntry), [true, true, true, true, false]);
  assert.deepEqual(adapter.ignored, [true, true, true, true, false]);
  assert.ok(!manifest.files.some((file) => file.path.split("/").some(isIncidentalCaptureSourceEntry)), "incidental metadata must not enter the source manifest");
  assert.ok(inputs.includes("Marketing/AppStoreScreenshots/capture-source-inputs.json"));
  assert.ok(inputs.includes("scripts/verify_marketing_capture_project.py"));
  assert.ok(inputs.includes("docs/qa/verification-profile.json"));
  assert.ok(!inputs.some((item) => item.startsWith("ArriveWithin.xcodeproj/")), "generated Xcode project outputs must not split the source contract");

  process.stdout.write(`Capture input parity passed across TypeScript and the physical build adapter (${manifest.files.length} files).\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
