import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DIST = path.join(ROOT, "dist");
export const UNBOUND_PUBLIC_BASE_URL = "https://arrive-within.local.invalid";

export function resolvePublicBaseURL(rawValue = process.env.ARRIVE_WITHIN_PUBLIC_BASE_URL) {
  const raw = rawValue?.trim() || UNBOUND_PUBLIC_BASE_URL;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ARRIVE_WITHIN_PUBLIC_BASE_URL must be an absolute HTTPS origin");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("ARRIVE_WITHIN_PUBLIC_BASE_URL must be a credential-free HTTPS origin without a path, query, or fragment");
  }
  return parsed.origin;
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export async function listFiles(root, excludedTopLevel = new Set()) {
  const files = [];
  async function visit(directory, relativeDirectory = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (!relativeDirectory && excludedTopLevel.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symbolic links are forbidden in website artifacts: ${relative}`);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`unsupported website filesystem entry: ${relative}`);
    }
  }
  await visit(root);
  return files;
}

export async function hashTree(root, excludedTopLevel = new Set()) {
  const files = await listFiles(root, excludedTopLevel);
  const digest = createHash("sha256");
  const records = [];
  for (const relative of files) {
    const data = await readFile(path.join(root, relative));
    const fileSha256 = sha256(data);
    records.push({ path: relative, bytes: data.byteLength, sha256: fileSha256 });
    digest.update(relative);
    digest.update("\0");
    digest.update(fileSha256);
    digest.update("\n");
  }
  return { algorithm: "SHA-256 over sorted UTF-8 relative-path, NUL, file-SHA-256, LF records", sha256: digest.digest("hex"), files: records };
}

export async function hashWebsiteSource() {
  const excluded = new Set(["dist", "node_modules", ".vercel"]);
  for (const entry of await readdir(ROOT, { withFileTypes: true })) {
    if (entry.name === ".env" || entry.name.startsWith(".env.")) excluded.add(entry.name);
  }
  return hashTree(ROOT, excluded);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function assertRegularFile(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`expected a regular file: ${file}`);
}

export function assertToolchain() {
  if (process.versions.node !== "26.7.0") {
    throw new Error(`Website build requires Node 26.7.0; found ${process.versions.node}`);
  }
}
