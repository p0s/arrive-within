import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { INDEXNOW_KEY } from "../src/indexnow-key.mjs";
import { readProductionWranglerConfig } from "./cloudflare-config.mjs";
import { hashWebsiteSource } from "./lib.mjs";
import { assertDeploymentReadback, parseWranglerDeployEvents } from "./deployment-proof.mjs";
import {
  afterSuccessfulDeployment,
  fetchPublicSiteSnapshot,
  loadPublisherState,
  prepareIndexNowChanges,
  PUBLIC_ORIGIN,
  publishIndexNowChanges,
  readPublicTreeSnapshot,
  savePublisherState,
  submitIndexNow,
  verifyDeletedPublicURL,
  verifyIndexNowKey,
  WORKER_NAME,
} from "./indexnow.mjs";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(websiteRoot, "..");
const publisherStateDirectory = path.join(websiteRoot, ".indexnow-state");
const SAVED_PROFILE = "Tightness_mannish146";

function parseArguments(argumentsList) {
  const retryOnly = argumentsList.includes("--retry-indexnow");
  const remaining = argumentsList.filter((argument) => argument !== "--retry-indexnow");
  if (remaining.length !== 2 || remaining[0] !== "--profile" || remaining[1] !== SAVED_PROFILE) {
    throw new Error(`usage: node scripts/publish-edge.mjs --profile ${SAVED_PROFILE} [--retry-indexnow]`);
  }
  return { profile: remaining[1], retryOnly };
}

function requireCleanCommit() {
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repositoryRoot, encoding: "utf8" });
  if (status.trim()) throw new Error("publish-edge requires a clean committed worktree");
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

async function requireExactConfiguredTarget() {
  const binding = await readProductionWranglerConfig({
    configPath: path.join(websiteRoot, "edge/wrangler.toml"),
    workerName: WORKER_NAME,
    customDomains: ["arrivewithin.com", "www.arrivewithin.com"],
  });
  return binding.accountId;
}

function runChecked(command, args, options) {
  const result = spawnSync(command, args, options);
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
  return result;
}

async function deployAndReadBack(profile, sourceSha) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "arrive-within-wrangler-output-"));
  const outputFile = path.join(temporaryDirectory, "wrangler-output.ndjson");
  try {
    runChecked("wrangler", [
      "deploy",
      "--config",
      "edge/wrangler.toml",
      "--profile",
      profile,
      "--message",
      `Arrive Within website source ${sourceSha}`,
    ], {
      cwd: websiteRoot,
      env: { ...process.env, ARRIVE_WITHIN_PUBLIC_BASE_URL: PUBLIC_ORIGIN, WRANGLER_OUTPUT_FILE_PATH: outputFile },
      shell: false,
      stdio: "inherit",
    });
    const deployment = parseWranglerDeployEvents(await readFile(outputFile, "utf8"));
    const readback = runChecked("wrangler", [
      "deployments",
      "status",
      "--config",
      "edge/wrangler.toml",
      "--profile",
      profile,
      "--name",
      WORKER_NAME,
      "--json",
    ], {
      cwd: websiteRoot,
      env: process.env,
      shell: false,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    return assertDeploymentReadback(deployment, readback.stdout);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function buildLocalCandidate(sourceHash) {
  execFileSync("pnpm", ["build"], {
    cwd: websiteRoot,
    env: { ...process.env, ARRIVE_WITHIN_PUBLIC_BASE_URL: PUBLIC_ORIGIN },
    stdio: "inherit",
  });
  const candidate = await readPublicTreeSnapshot(path.join(websiteRoot, "dist"));
  if (candidate.manifest.source_sha256 !== sourceHash) throw new Error("built candidate does not match the current website source tree");
  return candidate;
}

async function main() {
  const { profile, retryOnly } = parseArguments(process.argv.slice(2));
  const sourceSha = requireCleanCommit();
  const accountId = await requireExactConfiguredTarget();
  const previousState = await loadPublisherState(publisherStateDirectory);
  let candidate = retryOnly
    ? await buildLocalCandidate((await hashWebsiteSource()).sha256)
    : null;

  let deploymentIdentity = null;
  let publication;
  let keyURL = null;
  if (retryOnly) {
    const live = await fetchPublicSiteSnapshot();
    publication = await publishIndexNowChanges({
      beforePages: live.pages,
      candidatePages: candidate.pages,
      previousState,
      retryOnly: true,
      saveState: (state) => savePublisherState(publisherStateDirectory, state),
      readLiveSnapshot: fetchPublicSiteSnapshot,
      verifyDeleted: verifyDeletedPublicURL,
      submit: async (urls) => {
        if (!keyURL) keyURL = await verifyIndexNowKey(INDEXNOW_KEY);
        return submitIndexNow(urls, INDEXNOW_KEY, { keyVerified: true });
      },
    });
  } else {
    candidate = await buildLocalCandidate((await hashWebsiteSource()).sha256);
    const before = await fetchPublicSiteSnapshot();
    const preparedState = await prepareIndexNowChanges({
      beforePages: before.pages,
      candidatePages: candidate.pages,
      previousState,
      saveState: (state) => savePublisherState(publisherStateDirectory, state),
    });
    const publicationResult = await afterSuccessfulDeployment(
      async () => { deploymentIdentity = await deployAndReadBack(profile, sourceSha); },
      async () => {
        const builtCandidate = await readPublicTreeSnapshot(path.join(websiteRoot, "dist"));
        const currentSourceHash = await hashWebsiteSource();
        if (builtCandidate.manifest.source_sha256 !== currentSourceHash.sha256
          || builtCandidate.manifest.content_sha256 !== candidate.manifest.content_sha256) {
          throw new Error("post-deploy build manifest does not match the current website source tree");
        }
        candidate = builtCandidate;
        return publishIndexNowChanges({
          beforePages: before.pages,
          candidatePages: builtCandidate.pages,
          previousState: preparedState,
          saveState: (state) => savePublisherState(publisherStateDirectory, state),
          readLiveSnapshot: fetchPublicSiteSnapshot,
          verifyDeleted: verifyDeletedPublicURL,
          submit: async (urls) => {
            if (!keyURL) keyURL = await verifyIndexNowKey(INDEXNOW_KEY);
            return submitIndexNow(urls, INDEXNOW_KEY, { keyVerified: true });
          },
        });
      },
    );
    publication = publicationResult;
  }

  process.stdout.write(`${JSON.stringify({
    source_sha: sourceSha,
    public_origin: PUBLIC_ORIGIN,
    worker: WORKER_NAME,
    account_id: accountId,
    profile,
    mode: retryOnly ? "verify-only-retry" : "deploy-and-publish",
    deployment_identity: deploymentIdentity,
    sitemap_pages: candidate?.urls.length ?? null,
    key_url: keyURL,
    changed_new_or_deleted_urls: publication.count,
    indexnow_http_status: publication.status,
    indexnow_batches: publication.batches,
    live_propagation_attempts: publication.propagationAttempts,
    pending_urls: publication.pendingCount,
    pending_statuses: publication.statuses,
    held_reason: publication.failure,
  })}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
