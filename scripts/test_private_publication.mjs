import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { containsPrivateIdentifier } from "./check_private_publication.mjs";

const sentinel = ["synthetic", "private", "binding"].join("-");
test("private identifier scanning covers bytes and common textual encodings", () => {
  for (const data of [Buffer.from(sentinel), Buffer.from(sentinel.toUpperCase()), Buffer.from(sentinel, "utf16le"), Buffer.from(sentinel.toUpperCase(), "utf16le"),
    Buffer.from(Buffer.from(sentinel).toString("base64")), Buffer.from([...sentinel].map((c) => `%${c.charCodeAt(0).toString(16)}`).join("")),
    Buffer.from([...sentinel].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""))]) {
    assert.equal(containsPrivateIdentifier(data, [sentinel]), true);
  }
  assert.equal(containsPrivateIdentifier(Buffer.from("public placeholder"), [sentinel]), false);
});

test("publication scans actual index, historical commits and external text without echoing values", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "publication-test-"));
  const script = fileURLToPath(new URL("./check_private_publication.mjs", import.meta.url));
  try {
    const root = path.join(temp, "repo");
    await mkdir(root);
    const policy = path.join(temp, "identifiers.txt");
    await writeFile(policy, sentinel, { mode: 0o600 });
    const git = (args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git(["init", "-b", "main"]);
    const check = (args, expected) => {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ARRIVE_WITHIN_PRIVATE_IDENTIFIERS: policy } });
      assert.equal(result.status, expected, result.stderr);
      assert.ok(!(result.stdout + result.stderr).includes(sentinel));
    };
    await writeFile(path.join(root, "example.txt"), sentinel);
    git(["add", "example.txt"]);
    await writeFile(path.join(root, "example.txt"), "clean working tree, unsafe index");
    check(["--staged"], 1);
    git(["add", "example.txt"]);
    check(["--staged"], 0);
    git(["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", "commit", "-m", sentinel]);
    check(["--history"], 1);
    const message = path.join(temp, "message.txt");
    await writeFile(message, sentinel);
    check(["--text", message], 1);
    await writeFile(message, "safe publication text");
    check(["--text", message], 0);
    const output = path.join(temp, "output");
    await mkdir(output);
    await writeFile(path.join(output, "manifest.json"), sentinel);
    check(["--directory", output], 1);
    await writeFile(path.join(output, "manifest.json"), "safe manifest");
    check(["--directory", output], 0);
    await rm(policy);
    check(["--staged"], 1);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
