import { lstat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function normalized(value) {
  return value.split(path.sep).join("/");
}

function forbiddenDefenseInDepth(relative) {
  const file = normalized(relative);
  const name = path.posix.basename(file);
  const segments = file.split("/");
  return file === "AGENTS.md"
    || file === "SPEC.md"
    || file === "GOAL.md"
    || name.startsWith("LOCAL_")
    || name.startsWith("PRIVATE_")
    || name === ".env"
    || name.startsWith(".env.")
    || name.endsWith(".entitlements.local")
    || name.endsWith(".tsbuildinfo")
    || /\.(?:p8|p12|mobileprovision|provisionprofile|cer|der|key|pem|pyc)$/.test(name)
    || /^(?:Local|Private|Signing|OfficialCloudKit)\.xcconfig$/.test(name)
    || segments.some((segment) => new Set([
      ".build", ".codex", ".evidence", ".git", ".next", ".pnpm-store",
      ".swiftpm", ".venv", ".vercel", "__pycache__", "DerivedData",
      "node_modules", "xcuserdata",
    ]).has(segment));
}

function gitCandidatePaths(root) {
  const workTree = spawnSync(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    { cwd: root, encoding: "utf8" }
  );
  if (workTree.status !== 0 || workTree.stdout.trim() !== "true") return null;

  const listed = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: null, maxBuffer: 100_000_000 }
  );
  if (listed.error || listed.status !== 0) {
    const detail = listed.error?.message ?? listed.stderr?.toString("utf8").trim();
    throw new Error(`could not enumerate the Git publication candidate: ${detail || `exit ${listed.status}`}`);
  }
  const paths = listed.stdout.toString("utf8").split("\0").filter(Boolean).map(normalized);
  const ignored = spawnSync(
    "git",
    ["check-ignore", "--no-index", "--stdin", "-z"],
    {
      cwd: root,
      encoding: null,
      input: Buffer.from(`${paths.join("\0")}\0`, "utf8"),
      maxBuffer: 100_000_000,
    }
  );
  if (![0, 1].includes(ignored.status) || ignored.error) {
    const detail = ignored.error?.message ?? ignored.stderr?.toString("utf8").trim();
    throw new Error(`could not verify the Git ignore boundary: ${detail || `exit ${ignored.status}`}`);
  }
  const ignoredPaths = ignored.stdout.toString("utf8").split("\0").filter(Boolean);
  if (ignoredPaths.length > 0) {
    throw new Error(`Git publication candidate contains ignored paths: ${ignoredPaths.join(", ")}`);
  }
  return paths;
}

/**
 * Enumerates the exact publication candidate from Git's index plus untracked,
 * nonignored files when Git exists, or from ripgrep's mature ignore parser
 * before initialization. `--no-require-git` keeps .gitignore active pre-Git.
 */
export async function listProspectivePublicFiles(root) {
  let candidates = gitCandidatePaths(root);
  if (candidates === null) {
    const result = spawnSync(
      "rg",
      ["--files", "--hidden", "--no-require-git", "--null", "--sort", "path"],
      { cwd: root, encoding: null, maxBuffer: 100_000_000 }
    );
    if (result.error || result.status !== 0) {
      const detail = result.error?.message ?? result.stderr?.toString("utf8").trim();
      throw new Error(
        `could not enumerate the prospective public tree with rg: ${detail || `exit ${result.status}`}`
      );
    }
    candidates = result.stdout.toString("utf8").split("\0").filter(Boolean).map(normalized);
  }
  candidates = candidates.sort((left, right) => left.localeCompare(right));

  const forbidden = candidates.filter(forbiddenDefenseInDepth);
  if (forbidden.length > 0) {
    throw new Error(`prospective public tree contains defense-in-depth private paths: ${forbidden.join(", ")}`);
  }

  const files = [];
  for (const relative of candidates) {
    const absolute = path.join(root, relative);
    const fileStat = await lstat(absolute);
    if (fileStat.isSymbolicLink()) {
      throw new Error(`prospective public tree contains a symbolic link: ${relative}`);
    }
    if (!fileStat.isFile()) {
      throw new Error(`prospective public tree contains a nonregular item: ${relative}`);
    }
    files.push({ relative, absolute, stat: fileStat });
  }
  return files;
}
