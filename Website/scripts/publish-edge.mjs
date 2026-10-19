import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPublication } from "../../scripts/check_private_publication.mjs";

import { INDEXNOW_KEY } from "../src/indexnow-key.mjs";
import { readProductionWranglerConfig } from "./cloudflare-config.mjs";
import { deploymentEnvironment, parsePublisherArguments, readDeploymentConfig } from "./deployment-config.mjs";
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

function requireCleanCommit() {
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: repositoryRoot, encoding: "utf8" });
  if (status.trim()) throw new Error("publish-edge requires a clean committed worktree");
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

async function requireExactConfiguredTarget(requestedProfile) {
  const publicBinding = await readProductionWranglerConfig({
    configPath: path.join(websiteRoot, "edge/wrangler.toml"),
    workerName: WORKER_NAME,
    customDomains: ["arrivewithin.com", "www.arrivewithin.com"],
  });
  return readDeploymentConfig({ repositoryRoot, publicBinding, requestedProfile });
}

function runChecked(command, args, options) {
  const result = spawnSync(command, args, options);
  if (result.error) throw new Error(`Could not run ${command}`);
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? "unknown"}`);
  return result;
}

async function deployAndReadBack(binding, sourceSha) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "arrive-within-wrangler-output-"));
  const outputFile = path.join(temporaryDirectory, "wrangler-output.ndjson");
  try {
    runChecked("wrangler", [
      "deploy",
      "--config",
      "edge/wrangler.toml",
      "--profile",
      binding.profile,
      "--message",
      `Arrive Within website source ${sourceSha}`,
    ], {
      cwd: websiteRoot,
      env: { ...deploymentEnvironment(binding), ARRIVE_WITHIN_PUBLIC_BASE_URL: PUBLIC_ORIGIN, WRANGLER_OUTPUT_FILE_PATH: outputFile },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
    });
    const deployment = parseWranglerDeployEvents(await readFile(outputFile, "utf8"));
    const readback = runChecked("wrangler", [
      "deployments",
      "status",
      "--config",
      "edge/wrangler.toml",
      "--profile",
      binding.profile,
      "--name",
      WORKER_NAME,
      "--json",
    ], {
      cwd: websiteRoot,
      env: deploymentEnvironment(binding),
      shell: false,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
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
  await checkPublication(["--directory", path.join(websiteRoot, "dist")], repositoryRoot);
  if (candidate.manifest.source_sha256 !== sourceHash) throw new Error("built candidate does not match the current website source tree");
  return candidate;
}

async function main() {
  const { profile, mode } = parsePublisherArguments(process.argv.slice(2));
  const binding = await requireExactConfiguredTarget(profile);
  if (mode === "check-config") {
    process.stdout.write(`${JSON.stringify({ private_binding_verified: true })}\n`);
    return;
  }
  const retryOnly = mode === "retry-indexnow";
  const sourceSha = requireCleanCommit();
  await checkPublication(["--history"], repositoryRoot);
  if (mode === "deploy-only") {
    const candidate = await buildLocalCandidate((await hashWebsiteSource()).sha256);
    await deployAndReadBack(binding, sourceSha);
    const live = await fetchPublicSiteSnapshot();
    if (live.manifest.source_sha256 !== candidate.manifest.source_sha256
      || live.manifest.content_sha256 !== candidate.manifest.content_sha256) {
      throw new Error("Live deployment does not match the sanitized candidate");
    }
    process.stdout.write(`${JSON.stringify({ source_sha: sourceSha, deployment_verified: true, indexnow_submitted: false })}\n`);
    return;
  }
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
      async () => { deploymentIdentity = await deployAndReadBack(binding, sourceSha); },
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
    private_binding_verified: true,
    mode: retryOnly ? "verify-only-retry" : "deploy-and-publish",
    deployment_verified: deploymentIdentity !== null,
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

main().catch(() => {
  console.error("Publisher failed a configuration, build, deployment, or readback check; no complete result is claimed.");
  process.exitCode = 1;
});
