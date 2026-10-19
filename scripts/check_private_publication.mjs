import { spawn, execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function containsPrivateIdentifier(buffer, identifiers) {
  const source = buffer.toString("utf8");
  const decoded = source.replace(/\\u([a-f\d]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\x([a-f\d]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%([a-f\d]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const utf16 = buffer.toString("utf16le").toLowerCase();
  return identifiers.some((value) => decoded.toLowerCase().includes(value.toLowerCase())
    || utf16.includes(value.toLowerCase())
    || source.includes(Buffer.from(value).toString("base64")));
}

async function readPolicy(root) {
  const filename = process.env.ARRIVE_WITHIN_PRIVATE_IDENTIFIERS
    || path.join(os.homedir(), ".config", "arrive-within", "private-identifiers.txt");
  let handle;
  try {
    if (!path.isAbsolute(filename)) throw new Error();
    const resolved = await realpath(filename);
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) throw new Error();
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077)
      || (process.getuid && stat.uid !== process.getuid())) throw new Error();
    const identifiers = (await handle.readFile("utf8")).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!identifiers.length || identifiers.some((value) => value.length < 8)) throw new Error();
    return identifiers;
  } finally { await handle?.close(); }
}

async function scanObjects(root, ids, identifiers) {
  const child = spawn("git", ["cat-file", "--batch"], { cwd: root, stdio: ["pipe", "pipe", "ignore"] });
  const completion = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error("Object read failed")));
  });
  // Observe failures immediately even while stdout is being consumed.
  completion.catch(() => {});
  child.stdin.on("error", () => {});
  child.stdin.end([...ids].join("\n") + "\n");
  let pending = Buffer.alloc(0);
  let expected = null;
  let count = 0;
  let detected = false;
  for await (const chunk of child.stdout) {
    pending = Buffer.concat([pending, chunk]);
    while (true) {
      if (expected === null) {
        const newline = pending.indexOf(10);
        if (newline < 0) break;
        const header = pending.subarray(0, newline).toString("ascii").match(/^[a-f\d]+ (?:blob|commit|tree|tag) (\d+)$/);
        if (!header || Number(header[1]) > 256 * 1024 * 1024) { child.kill(); throw new Error("Invalid or oversized object"); }
        expected = Number(header[1]);
        pending = pending.subarray(newline + 1);
      }
      if (pending.length < expected + 1) break;
      if (pending[expected] !== 10) { child.kill(); throw new Error("Invalid object frame"); }
      detected ||= containsPrivateIdentifier(pending.subarray(0, expected), identifiers);
      pending = pending.subarray(expected + 1);
      expected = null;
      count += 1;
    }
  }
  await completion;
  if (count !== ids.size || pending.length || expected !== null) throw new Error("Incomplete object scan");
  if (detected) throw new Error("Private identifier detected");
  return count;
}

export async function checkPublication(args, cwd = process.cwd()) {
  const git = (argumentsList) => execFileSync("git", argumentsList, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const root = await realpath(git(["rev-parse", "--show-toplevel"]).trim());
  const identifiers = await readPolicy(root);
  if (args.length === 2 && args[0] === "--directory") {
    let files = 0;
    async function scanDirectory(directory) {
      const metadata = await lstat(directory);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("Invalid publication directory");
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (containsPrivateIdentifier(Buffer.from(entry.name), identifiers)) throw new Error("Private identifier detected");
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await scanDirectory(filename);
        else if (entry.isFile()) {
          if (containsPrivateIdentifier(await readFile(filename), identifiers)) throw new Error("Private identifier detected");
          files += 1;
        } else throw new Error("Unsupported publication entry");
      }
    }
    await scanDirectory(args[1]);
    return { checked: "publication-directory", files };
  }
  if (args.length === 2 && args[0] === "--text") {
    if (containsPrivateIdentifier(await readFile(args[1]), identifiers)) throw new Error("Private identifier detected");
    return { checked: "publication-text" };
  }
  if (args.length !== 1 || !["--staged", "--history"].includes(args[0])) throw new Error("Invalid mode");
  let inventory;
  let ids;
  if (args[0] === "--staged") {
    inventory = git(["ls-files", "--stage", "-z"]);
    const entries = inventory.split("\0").filter(Boolean).map((entry) => entry.match(/^\d+ ([a-f\d]+) 0\t/s));
    if (entries.some((entry) => !entry)) throw new Error("Unmerged index");
    ids = new Set(entries.map((entry) => entry[1]));
  } else {
    inventory = git(["-c", "core.quotePath=false", "rev-list", "--objects", "--all"]);
    ids = new Set(inventory.split("\n").filter(Boolean).map((line) => line.split(" ")[0]));
  }
  if (containsPrivateIdentifier(Buffer.from(inventory), identifiers)) throw new Error("Private identifier detected");
  return { checked: args[0].slice(2), objects: ids.size ? await scanObjects(root, ids, identifiers) : 0 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  checkPublication(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify({ private_publication_check: "passed", ...result })}\n`);
  }).catch(() => {
    console.error("Publication blocked: private identifier detected, private policy unavailable, or scan incomplete. No private value is printed.");
    process.exitCode = 1;
  });
}
