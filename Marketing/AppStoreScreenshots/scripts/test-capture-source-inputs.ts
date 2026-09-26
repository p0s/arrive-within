import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { ROOT } from "./contracts";
import { computeCaptureSourceManifest, loadCaptureSourceInputs } from "./source-provenance";

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
    "print(json.dumps(module.load_source_inputs()))",
  ].join("; ");
  const adapterInputs = JSON.parse(execFileSync("python3", ["-c", pythonLoader, adapterPath], {
    cwd: projectRoot,
    encoding: "utf8",
  })) as string[];

  assert.deepEqual(manifest.inputs, inputs);
  assert.deepEqual(adapterInputs, inputs, "the Python physical builder must consume the TypeScript manifest's canonical input list");
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
