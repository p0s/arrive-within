import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The installed pool uses the standard temporary volume, independent of the user's home.
export const APPROVED_SIMULATOR_RESULTS_ROOT = path.join(
  path.sep, "tmp", "codex-ios-simulator-pool", "results",
);

// Durable originals: the installed pool allocates one exclusive container per run,
// <root>/<run token>/original.xcresult beside original.log, and writes an immutable
// producer completion receipt <receipts>/<run token>.completion.json. Both fixed
// roots come from the account database, so a changed HOME cannot redirect them.
const ACCOUNT_HOME = os.userInfo().homedir;
export const DURABLE_SIMULATOR_ORIGINALS_ROOT = path.join(
  ACCOUNT_HOME, "Library", "Developer", "CodexSimulatorPool", "originals",
);
export const SIMULATOR_PRODUCER_RECEIPTS_ROOT = path.join(
  ACCOUNT_HOME, ".codex", "state", "developer-storage-cache", "pool-completions",
);
const DURABLE_ORIGINAL_NAME = "original.xcresult";
const DURABLE_LOG_NAME = "original.log";
const DURABLE_RUN_TOKEN = /^\d{8}T\d{6}Z-\d+-[0-9a-f]{10}$/;
const PRODUCER_RECEIPT_LIMIT_BYTES = 4096;

export type SimulatorPoolRoots = {
  temporaryRoot: string;
  originalsRoot: string;
  receiptsRoot: string;
};

export const INSTALLED_SIMULATOR_POOL_ROOTS: SimulatorPoolRoots = {
  temporaryRoot: APPROVED_SIMULATOR_RESULTS_ROOT,
  originalsRoot: DURABLE_SIMULATOR_ORIGINALS_ROOT,
  receiptsRoot: SIMULATOR_PRODUCER_RECEIPTS_ROOT,
};

export type DurableProducerReceipt = {
  result: string;
  device: number;
  inode: number;
  producer: {
    container: string;
    container_device: number;
    container_inode: number;
    owner: string;
    head: string;
    udid: string;
    device_family: "iPhone" | "iPad";
  };
};

export type SimulatorPoolResult =
  | { layout: "temporary"; result: string }
  | { layout: "durable"; result: string; receipt: DurableProducerReceipt };

export function assertTrustedSimulatorResultsRoot(candidate: string, trusted: string): void {
  if (path.resolve(candidate) !== path.resolve(trusted)) {
    throw new Error("configured xcresult root is not the installed simulator-pool result directory");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

async function assertOwnedDirectory(directory: string, label: string): Promise<{ dev: number; ino: number; mode: number }> {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error(`${label} is not a user-owned directory`);
  }
  return stat;
}

/** The fixed root itself must be canonical: no symbolic link anywhere on its path. */
async function canonicalRoot(root: string, label: string): Promise<string | null> {
  let real: string;
  try {
    real = await realpath(root);
  } catch {
    return null;
  }
  if (real !== path.resolve(root)) throw new Error(`${label} must not be reached through a symbolic link`);
  return real;
}

function parseProducerReceipt(raw: string): DurableProducerReceipt {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("producer completion receipt is malformed");
  }
  if (!isRecord(value) || !isRecord(value.producer)) throw new Error("producer completion receipt is malformed");
  const producer = value.producer;
  if (
    value.schema_version !== 3 || value.durable !== true || value.deletion_authority !== false
    || value.status !== "passed" || value.exit_code !== 0 || value.result_present !== true
    || typeof value.result !== "string" || !isIdentity(value.device) || !isIdentity(value.inode)
    || typeof producer.container !== "string" || !isIdentity(producer.container_device) || !isIdentity(producer.container_inode)
    || typeof producer.owner !== "string" || typeof producer.head !== "string" || !/^[a-f0-9]{40}$/.test(producer.head)
    || typeof producer.udid !== "string" || !/^[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/.test(producer.udid)
    || (producer.device_family !== "iPhone" && producer.device_family !== "iPad")
  ) throw new Error("producer completion receipt is not a passed durable original");
  return value as unknown as DurableProducerReceipt;
}

async function readProducerReceipt(receiptsRoot: string, token: string): Promise<DurableProducerReceipt> {
  const root = await canonicalRoot(receiptsRoot, "simulator producer receipts root");
  if (!root) throw new Error("producer completion receipt is missing");
  await assertOwnedDirectory(root, "simulator producer receipts root");
  let handle;
  try {
    handle = await open(path.join(root, `${token}.completion.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    throw new Error("producer completion receipt is missing or not a regular file");
  }
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() || stat.size > PRODUCER_RECEIPT_LIMIT_BYTES || stat.nlink !== 1 || (stat.mode & 0o077) !== 0
      || (process.getuid && stat.uid !== process.getuid())
    ) throw new Error("producer completion receipt is not an exclusive private producer file");
    return parseProducerReceipt(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

async function durableOriginal(
  absolute: string,
  result: string,
  projectRoot: string,
  roots: SimulatorPoolRoots,
): Promise<SimulatorPoolResult | null> {
  const lexicalRoot = path.resolve(roots.originalsRoot);
  let root: string | null = null;
  try {
    root = await realpath(lexicalRoot);
  } catch {
    root = null;
  }
  const insideLexical = absolute.startsWith(`${lexicalRoot}${path.sep}`);
  const insideRoot = root !== null && result.startsWith(`${root}${path.sep}`);
  if (!insideLexical && !insideRoot) return null;
  if (root !== lexicalRoot) throw new Error("durable simulator originals root must not be reached through a symbolic link");
  if (absolute !== result) {
    throw new Error("durable simulator original must be addressed by its canonical path without symbolic links");
  }

  const parts = path.relative(root, result).split(path.sep);
  if (parts.length !== 2 || !DURABLE_RUN_TOKEN.test(parts[0]!) || parts[1] !== DURABLE_ORIGINAL_NAME) {
    throw new Error("durable simulator original must be <originals root>/<run token>/original.xcresult");
  }
  const token = parts[0]!;
  const container = path.join(root, token);
  await assertOwnedDirectory(root, "durable simulator originals root");
  const containerStat = await assertOwnedDirectory(container, "durable simulator original container");
  if ((containerStat.mode & 0o077) !== 0) throw new Error("durable simulator original container is not private to its producer");
  if (JSON.stringify((await readdir(container)).sort()) !== JSON.stringify([DURABLE_LOG_NAME, DURABLE_ORIGINAL_NAME])) {
    throw new Error("durable simulator original container must hold exactly the original bundle and its log");
  }
  const logStat = await lstat(path.join(container, DURABLE_LOG_NAME));
  if (!logStat.isFile() || logStat.isSymbolicLink()) throw new Error("durable simulator original log is not a regular file");
  const resultStat = await assertOwnedDirectory(result, "durable simulator original bundle");

  // Identity is the producer's device/inode binding. xcresulttool adds its own
  // database on first read, so content timestamps are not original identity.
  const receipt = await readProducerReceipt(roots.receiptsRoot, token);
  if (
    receipt.result !== result || receipt.device !== resultStat.dev || receipt.inode !== resultStat.ino
    || receipt.producer.container !== container
    || receipt.producer.container_device !== containerStat.dev || receipt.producer.container_inode !== containerStat.ino
  ) throw new Error("durable simulator original does not match its producer completion receipt");
  if (receipt.producer.owner !== await realpath(projectRoot)) {
    throw new Error("durable simulator original was produced by another checkout");
  }
  return { layout: "durable", result, receipt };
}

/**
 * Resolve one ingestion input to an original pool result: a durable original with
 * matching producer evidence, or a bundle under the older temporary results root.
 * The durable layout rejects copies, renamed bundles and symbolic links through
 * producer identity checks. The temporary layout retains its existing root checks.
 */
export async function resolveSimulatorPoolResult(
  input: string,
  projectRoot: string,
  roots: SimulatorPoolRoots = INSTALLED_SIMULATOR_POOL_ROOTS,
  configuredTemporaryRoot: string | undefined = process.env.ARRIVE_WITHIN_SIMULATOR_RESULTS_ROOT,
): Promise<SimulatorPoolResult> {
  if (configuredTemporaryRoot !== undefined) {
    assertTrustedSimulatorResultsRoot(await realpath(configuredTemporaryRoot), await realpath(roots.temporaryRoot));
  }
  const absolute = path.resolve(projectRoot, input);
  const inputStat = await lstat(absolute);
  if (!inputStat.isDirectory() || inputStat.isSymbolicLink()) throw new Error(`xcresult is not a regular directory: ${input}`);
  const result = await realpath(absolute);

  const durable = await durableOriginal(absolute, result, projectRoot, roots);
  if (durable) return durable;

  let temporaryRoot: string | null = null;
  try {
    temporaryRoot = await realpath(roots.temporaryRoot);
  } catch {
    temporaryRoot = null;
  }
  if (temporaryRoot && result.startsWith(`${temporaryRoot}${path.sep}`) && result.endsWith(".xcresult")) {
    const rootStat = await lstat(temporaryRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("simulator-pool result root is not a regular directory");
    return { layout: "temporary", result };
  }
  throw new Error(`xcresult must be an original under a supported simulator-pool root: ${input}`);
}

/** A durable original's producer must have used the result's own simulator and device family. */
export function assertDurableProducerDevice(
  receipt: DurableProducerReceipt,
  deviceFamily: "iPhone" | "iPad",
  deviceId: string,
): void {
  if (receipt.producer.device_family !== deviceFamily || receipt.producer.udid !== deviceId) {
    throw new Error("durable simulator original producer does not match the result's simulator");
  }
}
