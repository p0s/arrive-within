#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const board = path.join(root, "docs", "brand", "provenance", "2026-08-10", "concept-board");
const provenancePath = path.join(board, "provenance.json");
const expectedCandidates = new Map([
  ["A", { name: "Living Rings", prompt: "direction-a-prompt.txt", output: "direction-a.png", review: "rejected-by-owner-after-concept-review" }],
  ["B", { name: "Quiet Threshold", prompt: "direction-b-prompt.txt", output: "direction-b.png", review: "selected-by-owner" }],
  ["C", { name: "Rooted Light", prompt: "direction-c-revision-2-prompt.txt", output: "direction-c.png", review: "rejected-by-owner-after-concept-review" }],
]);
const expectedPngs = [
  "direction-a.png",
  "direction-b.png",
  "direction-c-rejected-v1.png",
  "direction-c-rejected-v2.png",
  "direction-c.png",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function regularFile(relative) {
  if (path.basename(relative) !== relative) throw new Error(`concept board paths must be plain filenames: ${relative}`);
  const absolute = path.join(board, relative);
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`expected regular file: ${relative}`);
  return { absolute, bytes: await readFile(absolute), size: stat.size };
}

function validateRgbPng(name, bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!bytes.subarray(0, 8).equals(signature)) throw new Error(`${name}: not a PNG`);
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error(`${name}: malformed IHDR`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  if (width !== 1254 || height !== 1254 || bitDepth !== 8 || colorType !== 2) {
    throw new Error(`${name}: expected 1254x1254 8-bit opaque RGB PNG; found ${width}x${height}, depth ${bitDepth}, color type ${colorType}`);
  }
}

function rejectPrivateStrings(value, location = "provenance") {
  if (typeof value === "string") {
    const personalHomePrefix = ["", "Users", ""].join("/");
    for (const forbidden of [personalHomePrefix, ".codex", "generated_images", "exec-"]) {
      if (value.includes(forbidden)) throw new Error(`${location}: private/local generator path leaked`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectPrivateStrings(item, `${location}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => rejectPrivateStrings(item, `${location}.${key}`));
  }
}

async function validateRecord(record, expected, label) {
  if (record.name !== expected.name || record.prompt !== expected.prompt || record.output !== expected.output) {
    throw new Error(`${label}: identity/path mismatch`);
  }
  if (!/^[a-f0-9]{64}$/.test(record.prompt_sha256) || !/^[a-f0-9]{64}$/.test(record.sha256)) {
    throw new Error(`${label}: missing SHA-256`);
  }
  const prompt = await regularFile(record.prompt);
  const output = await regularFile(record.output);
  if (sha256(prompt.bytes) !== record.prompt_sha256) throw new Error(`${label}: prompt hash mismatch`);
  if (sha256(output.bytes) !== record.sha256 || output.size !== record.bytes) throw new Error(`${label}: output hash/size mismatch`);
  validateRgbPng(record.output, output.bytes);
  const promptText = prompt.bytes.toString("utf8");
  for (const phrase of ["style reference only", "full-square opaque field", "at 40 px", "no text", "no watermark"]) {
    if (!promptText.includes(phrase)) throw new Error(`${label}: prompt missing constraint: ${phrase}`);
  }
}

async function main() {
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  rejectPrivateStrings(provenance);
  if (
    provenance.schema_version !== 1 ||
    provenance.status !== "owner-selected" ||
    provenance.generator.mode !== "OpenAI built-in image_gen" ||
    provenance.generator.model_identifier !== "not-exposed-by-built-in-tool" ||
    provenance.generator.alpha !== false ||
    provenance.style_reference.role !== "style-reference-only" ||
    provenance.style_reference.copied_geometry_allowed !== false ||
    provenance.selection.state !== "selected-by-owner" ||
    provenance.selection.selected_direction !== "B" ||
    provenance.selection.selected_at !== "2026-08-10"
  ) {
    throw new Error("icon concept provenance/selection boundary mismatch");
  }
  if (provenance.directions.length !== 3 || provenance.rejected_attempts.length !== 2) {
    throw new Error("expected exactly three candidates and two preserved rejected attempts");
  }

  const ids = provenance.directions.map((record) => record.id);
  if (JSON.stringify(ids) !== JSON.stringify(["A", "B", "C"])) throw new Error("candidate order must be A, B, C");
  for (const record of provenance.directions) {
    const expected = expectedCandidates.get(record.id);
    if (!expected) throw new Error(`unexpected direction ${record.id}`);
    await validateRecord(record, expected, `direction ${record.id}`);
    if (record.review !== expected.review) throw new Error(`direction ${record.id}: incorrect review state`);
  }

  for (const [index, record] of provenance.rejected_attempts.entries()) {
    if (record.direction !== "C" || record.iteration !== index + 1 || !record.reason.startsWith("Rejected before owner presentation:")) {
      throw new Error(`rejected attempt ${index + 1}: incomplete disposition`);
    }
    const prompt = await regularFile(record.prompt);
    const output = await regularFile(record.output);
    if (sha256(prompt.bytes) !== record.prompt_sha256) throw new Error(`rejected attempt ${index + 1}: prompt hash mismatch`);
    if (sha256(output.bytes) !== record.sha256 || output.size !== record.bytes) throw new Error(`rejected attempt ${index + 1}: output hash/size mismatch`);
    validateRgbPng(record.output, output.bytes);
  }

  const pngs = (await readdir(board)).filter((name) => name.endsWith(".png")).sort();
  if (JSON.stringify(pngs) !== JSON.stringify([...expectedPngs].sort())) throw new Error("unexpected or missing concept PNG");
  const selection = await readFile(path.join(board, "selection.md"), "utf8");
  for (const marker of ["## A — Living Rings", "## B — Quiet Threshold", "## C — Rooted Light", "Selected direction: **B — Quiet Threshold**", "Selection date: **2026-08-10**"]) {
    if (!selection.includes(marker)) throw new Error(`selection sheet missing: ${marker}`);
  }

  process.stdout.write("Icon concept validation passed: 3 distinct owner candidates, 2 preserved rejected attempts, exact hashes and opaque RGB PNGs; B selected on 2026-08-10.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
