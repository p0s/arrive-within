import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function parseDeploymentConfig(value, publicBinding, requestedProfile) {
  if (!value || Array.isArray(value) || typeof value !== "object"
    || Object.keys(value).sort().join(",") !== "accountId,customDomains,profile,schemaVersion,workerName"
    || value.schemaVersion !== 1
    || typeof value.profile !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value.profile)
    || typeof value.accountId !== "string" || !/^[a-f\d]{32}$/.test(value.accountId)
    || value.workerName !== publicBinding.workerName
    || JSON.stringify(value.customDomains) !== JSON.stringify(publicBinding.customDomains)) {
    throw new Error("Private deployment configuration is invalid or targets another project");
  }
  if (requestedProfile !== undefined && requestedProfile !== value.profile) {
    throw new Error("Requested profile does not match the private deployment binding");
  }
  return Object.freeze({ ...value, customDomains: Object.freeze([...value.customDomains]) });
}

export async function readDeploymentConfig({ repositoryRoot, publicBinding, requestedProfile,
  configPath = process.env.ARRIVE_WITHIN_DEPLOYMENT_CONFIG
    || path.join(os.homedir(), ".config", "arrive-within", "deployment.json") }) {
  let handle;
  try {
    if (!path.isAbsolute(configPath)) throw new Error();
    const resolved = await realpath(configPath);
    const root = await realpath(repositoryRoot);
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) throw new Error();
    handle = await open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > 4096 || (metadata.mode & 0o077) !== 0
      || (process.getuid && metadata.uid !== process.getuid())) throw new Error();
    const value = JSON.parse(await handle.readFile("utf8"));
    return parseDeploymentConfig(value, publicBinding, requestedProfile);
  } catch {
    // Filesystem and parser errors can contain private paths or values.
    throw new Error("Private deployment binding must be a valid owner-only file outside the repository");
  } finally {
    await handle?.close();
  }
}

export function deploymentEnvironment(binding, environment = process.env) {
  return { ...environment, CLOUDFLARE_ACCOUNT_ID: binding.accountId };
}

export function parsePublisherArguments(argumentsList) {
  let profile;
  let mode = "publish";
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--profile" && profile === undefined && argumentsList[index + 1]
      && !argumentsList[index + 1].startsWith("--")) profile = argumentsList[++index];
    else if (["--retry-indexnow", "--deploy-only", "--check-config"].includes(argument) && mode === "publish") {
      mode = argument.slice(2);
    } else throw new Error("Use an optional profile and one publisher mode");
  }
  return { profile, mode };
}
