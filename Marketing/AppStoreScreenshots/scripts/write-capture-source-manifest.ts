import { writeFile } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "./contracts";
import { computeCaptureSourceManifest } from "./source-provenance";

async function main(): Promise<void> {
  const manifest = await computeCaptureSourceManifest();
  const output = path.join(ROOT, "capture-source-manifest-v1.0.2-build-19.json");
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `Wrote ${path.relative(ROOT, output)} for source revision ${manifest.source_revision}.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
