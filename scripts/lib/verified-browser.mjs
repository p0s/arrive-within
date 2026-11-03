import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const minimumVersion = [156, 0, 8078, 73];

function isPatched(version) {
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+\.\d+$/.test(version)) return false;
  const parts = version.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) return false;
  for (let i = 0; i < minimumVersion.length; i += 1) {
    if (parts[i] !== minimumVersion[i]) return parts[i] > minimumVersion[i];
  }
  return true;
}

/** Connect only after a trusted local verifier approves the browser. */
export async function connectVerifiedBrowser(chromium) {
  const verifier = process.env.SCREENSHOT_BROWSER_GUARD;
  if (!verifier || !isAbsolute(verifier)) {
    throw new Error("Configure an absolute path to a trusted local browser verifier before exporting.");
  }
  const { stdout } = await run(verifier, [], { timeout: 30_000, maxBuffer: 16_384 });
  const proof = JSON.parse(stdout);
  const endpoint = new URL(proof.endpoint);
  const version = typeof proof.version === "string" ? proof.version.replace(/^Chrome\//, "") : "";
  if (proof.guarded !== true || proof.version !== `Chrome/${version}` || !isPatched(version) ||
      endpoint.protocol !== "ws:" || !["127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(endpoint.pathname)) {
    throw new Error("The browser verifier did not return an approved local Chrome endpoint and version.");
  }
  const browser = await chromium.connectOverCDP(endpoint.href, { timeout: 15_000 });
  if (!isPatched(browser.version()) || proof.version !== `Chrome/${browser.version()}`) {
    await browser.close();
    throw new Error("Chrome changed or is below the verified version. Update and retry.");
  }
  // New contexts belong to this connection; existing tabs remain untouched.
  return browser;
}
