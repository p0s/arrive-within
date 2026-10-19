import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./lib.mjs";
import { assertPublishedMedia, loadMediaCandidate } from "./published-media.mjs";

const candidate = await loadMediaCandidate();
const pendingOriginal = await readFile(path.join(ROOT, "src", "assets", candidate.pending.assets[0].file));
const clone = () => ({ ...candidate, binding: { ...candidate.binding }, responsive: structuredClone(candidate.responsive), outputs: new Map(candidate.outputs), sources: new Map(candidate.sources) });

test("the website preserves the exact already-public media and bound derivatives", () => assert.doesNotThrow(() => assertPublishedMedia(candidate)));
test("a changed public source fails closed", () => {
  const altered = clone();
  altered.sources.set("garden-growth-v1.mp4", Buffer.from("changed"));
  assert.throws(() => assertPublishedMedia(altered), /published source drift/);
});
test("a changed film output fails closed", () => {
  const altered = clone();
  altered.outputs.set("garden-growth-v1.mp4", Buffer.from("changed"));
  assert.throws(() => assertPublishedMedia(altered), /preserve published media/);
});
test("a derivative from a pending source fails closed", () => {
  const altered = clone();
  altered.responsive.assets[0].source = "src/assets/garden-growth-poster.png";
  assert.throws(() => assertPublishedMedia(altered), /source must be published/);
});
test("an extra pending-review source in dist fails closed even when unused", () => {
  const altered = clone();
  altered.outputs.set("unused-pending.png", pendingOriginal);
  assert.throws(() => assertPublishedMedia(altered), /pending-review original must not be published/);
});
test("an undeclared media file in dist fails closed", () => {
  const altered = clone();
  altered.outputs.set("unexpected.webp", Buffer.from("undeclared"));
  assert.throws(() => assertPublishedMedia(altered), /undeclared media must not be published/);
});
