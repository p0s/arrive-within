import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { scanZipArchive } from "./validate_public_repository.mjs";

async function fixtureWithNestedArchive({
  nestedName = "inner.zip",
  prefixBytes = false,
  privateContent = false,
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "arrive-within-archive-fixture-"));
  const source = path.join(root, "source");
  await mkdir(source);
  const content = privateContent
    ? ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ")
    : "bounded public fixture\n";
  await writeFile(path.join(source, "payload.txt"), content, { mode: 0o600 });

  const innerZip = path.join(root, "inner.zip");
  runZip(source, innerZip, ["payload.txt"]);
  const nestedPath = path.join(root, nestedName);
  if (nestedPath !== innerZip) await rename(innerZip, nestedPath);
  if (prefixBytes) {
    const archive = await readFile(nestedPath);
    await writeFile(nestedPath, Buffer.concat([Buffer.from("bounded-stub\n"), archive]));
  }

  const outerZip = path.join(root, "outer.zip");
  runZip(root, outerZip, [nestedName]);
  return { root, outerZip };
}

function runZip(cwd, output, entries) {
  const result = spawnSync("/usr/bin/zip", ["-q", output, ...entries], {
    cwd,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr || "zip fixture creation failed");
}

test("nested ZIP private content is scanned with its full evidence path", async () => {
  const fixture = await fixtureWithNestedArchive({ privateContent: true });
  try {
    const hits = [];
    scanZipArchive(fixture.outerZip, "outer.zip", hits);
    assert.ok(
      hits.some(
        (hit) => hit.pattern === "private-key"
          && hit.file === "outer.zip!inner.zip!payload.txt",
      ),
      JSON.stringify(hits),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("ZIP magic triggers recursion even when the nested extension is misleading", async () => {
  const fixture = await fixtureWithNestedArchive({
    nestedName: "payload.bin",
    privateContent: true,
  });
  try {
    const hits = [];
    scanZipArchive(fixture.outerZip, "outer.zip", hits);
    assert.ok(
      hits.some(
        (hit) => hit.pattern === "private-key"
          && hit.file === "outer.zip!payload.bin!payload.txt",
      ),
      JSON.stringify(hits),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a prefixed ZIP with a misleading extension fails closed", async () => {
  const fixture = await fixtureWithNestedArchive({
    nestedName: "payload.bin",
    prefixBytes: true,
    privateContent: true,
  });
  try {
    const hits = [];
    scanZipArchive(fixture.outerZip, "outer.zip", hits);
    assert.ok(
      hits.some(
        (hit) => hit.file.startsWith("outer.zip!payload.bin")
          && ["private-key", "unreadable-archive"].includes(hit.pattern),
      ),
      JSON.stringify(hits),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("bounded benign nested ZIP content passes", async () => {
  const fixture = await fixtureWithNestedArchive();
  try {
    const hits = [];
    const scannedEntries = scanZipArchive(fixture.outerZip, "outer.zip", hits);
    assert.equal(scannedEntries, 2);
    assert.deepEqual(hits, []);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("archive depth and aggregate entry limits fail closed", async () => {
  const fixture = await fixtureWithNestedArchive();
  try {
    const depthHits = [];
    scanZipArchive(fixture.outerZip, "outer.zip", depthHits, { maxDepth: 0 });
    assert.ok(depthHits.some((hit) => hit.pattern === "archive-depth-limit-exceeded"));

    const entryHits = [];
    scanZipArchive(fixture.outerZip, "outer.zip", entryHits, { maxEntries: 0 });
    assert.ok(entryHits.some((hit) => hit.pattern === "archive-entry-limit-exceeded"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
