import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { connectVerifiedBrowser } from "./lib/verified-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "browser-verifier-test-"));
const verifier = join(temporary, "verify.cjs");
writeFileSync(verifier, `#!${process.execPath}\nprocess.stdout.write(process.env.BROWSER_TEST_PROOF ?? "");\n`, { mode: 0o700 });
after(() => rmSync(temporary, { recursive: true }));
const valid = { guarded: true, version: "Chrome/156.0.8078.79", endpoint: "ws://127.0.0.1:30123/devtools/browser/example-id" };

async function exercise(proof, actual = "156.0.8078.79", command = verifier) {
  const previous = { guard: process.env.SCREENSHOT_BROWSER_GUARD, proof: process.env.BROWSER_TEST_PROOF };
  let connected = 0;
  let closed = 0;
  const browser = { version: () => actual, close: async () => { closed += 1; } };
  let returned;
  let error;
  try {
    if (command === null) delete process.env.SCREENSHOT_BROWSER_GUARD;
    else process.env.SCREENSHOT_BROWSER_GUARD = command;
    process.env.BROWSER_TEST_PROOF = typeof proof === "string" ? proof : JSON.stringify(proof);
    returned = await connectVerifiedBrowser({ connectOverCDP: async (endpoint, options) => {
      connected += 1;
      assert.equal(options.timeout, 15_000);
      assert.equal(new URL(endpoint).protocol, "ws:");
      return browser;
    } });
  } catch (caught) { error = caught; }
  finally {
    for (const [key, value] of [["SCREENSHOT_BROWSER_GUARD", previous.guard], ["BROWSER_TEST_PROOF", previous.proof]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return { connected, closed, returned, browser, error };
}

test("requires explicit local verification before connecting", async () => {
  for (const command of [null, "relative-verifier"]) {
    const result = await exercise(valid, undefined, command);
    assert.ok(result.error);
    assert.equal(result.connected, 0);
  }
});

test("rejects invalid proofs and endpoints without contacting a browser", async () => {
  const invalid = ["not-json", "null", {}, { ...valid, guarded: false }];
  for (const endpoint of [
    "https://127.0.0.1:30123/devtools/browser/example-id",
    "ws://example.invalid:30123/devtools/browser/example-id",
    "ws://user:password@127.0.0.1:30123/devtools/browser/example-id",
    `${valid.endpoint}?redirect=1`, `${valid.endpoint}#fragment`,
    "ws://127.0.0.1:30123/devtools/page/example-id",
  ]) invalid.push({ ...valid, endpoint });
  for (const version of ["156.0.8078.72", "155.9.9999.99", "156.0.8078.79-beta", "99999999999999999.0.0.0", "invalid"]) {
    invalid.push({ ...valid, version: `Chrome/${version}` });
  }
  invalid.push({ ...valid, version: "156.0.8078.79" });
  for (const proof of invalid) {
    const result = await exercise(proof);
    assert.ok(result.error);
    assert.equal(result.connected, 0);
  }
});

test("accepts current verified IPv4 and IPv6 connections", async () => {
  for (const version of ["156.0.8078.73", "156.0.8078.79", "157.0.0.0"]) {
    for (const host of ["127.0.0.1", "[::1]"]) {
      const result = await exercise({ ...valid, version: `Chrome/${version}`, endpoint: `ws://${host}:30123/devtools/browser/example-id` }, version);
      assert.equal(result.error, undefined);
      assert.equal(result.returned, result.browser);
      assert.equal(result.connected, 1);
      assert.equal(result.closed, 0);
    }
  }
});

test("closes a connection whose runtime changed or failed verification", async () => {
  for (const actual of ["156.0.8078.72", "156.0.8078.80", "invalid"]) {
    const result = await exercise(valid, actual);
    assert.ok(result.error);
    assert.equal(result.connected, 1);
    assert.equal(result.closed, 1);
  }
});

test("every maintained browser entry point uses the shared verifier", () => {
  const callers = [
    "Marketing/AppStoreScreenshots/scripts/connect-browser.ts",
    "Marketing/GardenDesignLab/scripts/generate-garden-design-lab.mjs",
    "Marketing/PublicMedia/scripts/generate-public-media.mjs",
    "Marketing/RendererVisualMatrix/scripts/generate-renderer-visual-matrix.mjs",
    "Renderer/scripts/capture_garden_previews.mjs",
    "Website/scripts/validate-browser.mjs",
    "scripts/prove_garden_rendering.mjs",
    "scripts/soak_selected_renderer.mjs",
  ];
  for (const caller of callers) {
    const source = readFileSync(join(root, caller), "utf8");
    assert.match(source, /connectVerifiedBrowser\(/, caller);
    assert.doesNotMatch(source, /chromium\.(?:launch|launchPersistentContext|connectOverCDP)\(/, caller);
  }
});
