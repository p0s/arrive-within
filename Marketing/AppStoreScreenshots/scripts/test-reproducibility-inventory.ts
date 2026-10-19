import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadPlan } from "./contracts";
import { collectCurrentExportFiles } from "./export-inventory";

const setArtifacts = [
  "01-slide.png", "02-slide.png", "03-slide.png", "04-slide.png", "05-slide.png", "06-slide.png",
  "_contact-sheet.jpg", "_manifest.json", "_validation.json", "_validation.txt", "candidate.zip",
];
const matrixArtifacts = ["_matrix-manifest.json", "_matrix-validation.json", "_matrix-validation.txt"];

async function main(): Promise<void> {
  const plan = await loadPlan();
  const root = await mkdtemp(path.join(os.tmpdir(), "arrive-within-export-inventory-"));
  try {
    for (const locale of plan.locales) {
      for (const device of plan.devices) {
        const directory = path.join(root, locale, device.id);
        await mkdir(directory, { recursive: true });
        for (const artifact of setArtifacts) await writeFile(path.join(directory, artifact), "fixture\n");
      }
    }
    for (const artifact of matrixArtifacts) await writeFile(path.join(root, artifact), "fixture\n");

    const historical = path.join(root, "en-US", "ipad-11");
    await mkdir(historical, { recursive: true });
    await writeFile(path.join(historical, "obsolete-export.png"), "historical\n");

    const files = await collectCurrentExportFiles(root, plan);
    const expected = plan.expected_final_images + plan.locales.length * plan.devices.length * 5 + matrixArtifacts.length;
    assert.equal(files.length, expected);
    assert.equal(files.some((file) => file.includes("ipad-11")), false);
    assert.equal(files.some((file) => file.includes("obsolete-export")), false);
    process.stdout.write(`Reproducibility inventory passed: ${files.length} current artifacts; retained historical iPad-11 exports are excluded.\n`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
