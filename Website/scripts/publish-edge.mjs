import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { INDEXNOW_KEY } from "../src/indexnow-key.mjs";
import {
  diffPublicURLs,
  fetchPublicSiteSnapshot,
  PUBLIC_ORIGIN,
  submitIndexNow,
  verifyIndexNowKey,
} from "./indexnow.mjs";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(websiteRoot, "..");

function parseProfile(argumentsList) {
  if (argumentsList.length !== 2 || argumentsList[0] !== "--profile" || !/^[A-Za-z0-9_-]+$/.test(argumentsList[1])) {
    throw new Error("usage: node scripts/publish-edge.mjs --profile <saved-wrangler-profile>");
  }
  return argumentsList[1];
}

function requireCleanCommit() {
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repositoryRoot, encoding: "utf8" });
  if (status.trim()) throw new Error("publish-edge requires a clean committed worktree");
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

async function main() {
  const profile = parseProfile(process.argv.slice(2));
  const sourceSha = requireCleanCommit();
  const before = await fetchPublicSiteSnapshot();
  const result = spawnSync("wrangler", [
    "deploy",
    "--config",
    "edge/wrangler.toml",
    "--profile",
    profile,
    "--message",
    `Arrive Within website source ${sourceSha}`,
  ], {
    cwd: websiteRoot,
    env: { ...process.env, ARRIVE_WITHIN_PUBLIC_BASE_URL: PUBLIC_ORIGIN },
    shell: false,
    stdio: "inherit",
  });
  if (result.error) throw new Error(`Could not run Wrangler: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Wrangler deploy exited with status ${result.status ?? "unknown"}`);

  const after = await fetchPublicSiteSnapshot();
  const keyURL = await verifyIndexNowKey(INDEXNOW_KEY);
  const changed = diffPublicURLs(before.pages, after.pages);
  const submission = changed.length
    ? await submitIndexNow(changed, INDEXNOW_KEY, { keyVerified: true })
    : { submitted: false, count: 0, status: null };

  process.stdout.write(`${JSON.stringify({
    source_sha: sourceSha,
    public_origin: PUBLIC_ORIGIN,
    sitemap_pages: after.urls.length,
    key_url: keyURL,
    changed_new_or_deleted_urls: changed.length,
    indexnow_http_status: submission.status,
  })}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
