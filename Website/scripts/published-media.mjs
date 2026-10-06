import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DIST, ROOT, listFiles, sha256 } from "./lib.mjs";

export async function loadMediaCandidate() {
  const publishedBytes = await readFile(path.join(ROOT, "published-media", "provenance.json"));
  const published = JSON.parse(publishedBytes);
  const pending = JSON.parse(await readFile(path.join(ROOT, "src", "assets", "provenance.json"), "utf8"));
  const sources = new Map(await Promise.all(published.assets.map(async (asset) => [asset.file, await readFile(path.join(ROOT, "published-media", asset.file))])));
  const outputs = new Map(await Promise.all((await listFiles(path.join(DIST, "assets"))).map(async (file) => [file, await readFile(path.join(DIST, "assets", file))])));
  return { publishedBytes, published, pending, sources, outputs, binding: JSON.parse(await readFile(path.join(ROOT, "published-media", "binding.json"), "utf8")), responsive: JSON.parse(await readFile(path.join(ROOT, "src", "assets", "responsive-provenance.json"), "utf8")) };
}

export function assertPublishedMedia(candidate) {
  const { binding, publishedBytes, published, pending, sources, outputs, responsive } = candidate;
  assert.equal(binding.schema_version, 1);
  assert.equal(binding.selection, "previously-public-reviewed-media");
  assert.equal(binding.canonical_origin, "https://arrivewithin.com");
  assert.equal(binding.provenance_sha256, sha256(publishedBytes), "published provenance drift");
  assert.equal(published.public_media_source_state, "current-source-renderer-media-regenerated-and-reviewed-locally");
  assert.equal(published.assets.length, 11);
  assert.equal(binding.asset_count, published.assets.length);
  const names = published.assets.map((asset) => asset.file);
  assert.equal(new Set(names).size, 11);
  for (const asset of published.assets) {
    assert.match(asset.file, /^[a-z0-9-]+\.(png|mp4)$/);
    assert.equal(sha256(sources.get(asset.file)), asset.sha256, `${asset.file}: published source drift`);
    assert.equal(sha256(outputs.get(asset.file)), asset.sha256, `${asset.file}: output must preserve published media`);
  }
  assert.equal(sha256(outputs.get("provenance.json")), binding.provenance_sha256, "output must retain published provenance");
  assert.equal(responsive.schema_version, 1);
  assert.equal(responsive.source_selection, binding.selection);
  assert.equal(responsive.assets.length, 31);
  const allowed = new Set([...names, "brand-icon-40.png", "brand-icon-180.png", "provenance.json", "brand-provenance.json", "responsive-provenance.json", "site.css"]);
  for (const derivative of responsive.assets) {
    assert.match(derivative.file, /^responsive\/[a-z0-9-]+-\d+\.webp$/);
    const source = published.assets.find((asset) => `published-media/${asset.file}` === derivative.source);
    assert(source, `${derivative.file}: derivative source must be published`);
    assert.equal(derivative.source_sha256, source.sha256, `${derivative.file}: derivative source drift`);
    assert.equal(sha256(outputs.get(derivative.file)), derivative.sha256, `${derivative.file}: derivative output drift`);
    assert(!allowed.has(derivative.file), "duplicate derivative");
    allowed.add(derivative.file);
  }
  const pendingHashes = new Set(pending.assets.map((asset) => asset.sha256));
  for (const [file, bytes] of outputs) {
    assert(!pendingHashes.has(sha256(bytes)), `${file}: pending-review original must not be published`);
    assert(allowed.has(file), `${file}: undeclared media must not be published`);
  }
}
