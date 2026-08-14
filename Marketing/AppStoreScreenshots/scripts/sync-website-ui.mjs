import { copyFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STUDIO_ROOT = path.resolve(SCRIPT_DIR, "..");
const PROJECT_ROOT = path.resolve(STUDIO_ROOT, "..", "..");
const WEBSITE_ASSET_ROOT = path.join(PROJECT_ROOT, "Website", "src", "assets");
const PROVENANCE_PATH = path.join(WEBSITE_ASSET_ROOT, "provenance.json");

const mappings = [
  ["garden-en-iphone.png", "en-US", "iphone-6.9", "garden-hero"],
  ["garden-de-iphone.png", "de-DE", "iphone-6.9", "garden-hero"],
  ["journey-en-iphone.png", "en-US", "iphone-6.9", "journey-calendar"],
  ["journey-de-iphone.png", "de-DE", "iphone-6.9", "journey-calendar"],
  ["journal-en-ipad.png", "en-US", "ipad-13", "journal"],
  ["journal-de-ipad.png", "de-DE", "ipad-13", "journal"],
  ["garden-en-ipad.png", "en-US", "ipad-13", "garden-hero"],
  ["garden-de-ipad.png", "de-DE", "ipad-13", "garden-hero"],
];

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

async function main() {
  const captures = JSON.parse(await readFile(path.join(STUDIO_ROOT, "source-captures.json"), "utf8"));
  const provenance = JSON.parse(await readFile(PROVENANCE_PATH, "utf8"));
  if (captures.schema_version !== 2 || !["candidate-ready", "human-reviewed"].includes(captures.state)) {
    throw new Error("website UI sync requires candidate-ready or human-reviewed schema-2 source captures");
  }
  if (captures.state === "human-reviewed" && captures.human_visual_review?.state !== "approved") {
    throw new Error("website UI sync requires an approved human visual review for human-reviewed captures");
  }
  if (provenance.schema_version !== 1 || provenance.assets.length !== 11) {
    throw new Error("website provenance must contain eight UI assets and three public-media assets");
  }

  for (const [file, locale, device, captureID] of mappings) {
    const set = captures.sets.find((item) => item.locale === locale && item.device === device);
    const capture = set?.captures?.[captureID];
    if (!capture) throw new Error(`missing capture ${locale}/${device}/${captureID}`);
    const source = path.join(STUDIO_ROOT, capture.path);
    const destination = path.join(WEBSITE_ASSET_ROOT, file);
    const data = await readFile(source);
    const digest = sha256(data);
    if (digest !== capture.sha256) throw new Error(`${capture.path}: source hash mismatch`);
    await copyFile(source, destination);

    const record = provenance.assets.find((item) => item.file === file);
    if (!record) throw new Error(`${file}: missing website provenance record`);
    record.source = path.relative(PROJECT_ROOT, source);
    record.sha256 = digest;
  }

  provenance.source_revision = captures.source_revision;
  await writeFile(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`);
  process.stdout.write(`Synchronized ${mappings.length} website UI assets at source revision ${captures.source_revision}.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
