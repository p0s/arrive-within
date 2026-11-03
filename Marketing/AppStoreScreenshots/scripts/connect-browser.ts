import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute } from "node:path";
import { chromium, type Browser } from "playwright";

const run = promisify(execFile);
const minimumVersion = [156, 0, 8078, 73];

function isPatched(version: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) return false;
  const parts = version.split(".").map(Number);
  for (let i = 0; i < minimumVersion.length; i += 1) {
    if (parts[i] !== minimumVersion[i]) return parts[i] > minimumVersion[i];
  }
  return true;
}

/** Attach only after the host guard verifies its approved, sandboxed Chrome. */
export async function connectScreenshotBrowser(): Promise<Browser> {
  const verifier = process.env.SCREENSHOT_BROWSER_GUARD;
  if (!verifier || !isAbsolute(verifier)) {
    throw new Error("Configure an absolute path to a trusted local browser verifier before exporting.");
  }
  const { stdout } = await run(verifier, [], {
    timeout: 30_000, maxBuffer: 16_384,
  });
  const proof = JSON.parse(stdout);
  const endpoint = new URL(proof.endpoint);
  if (proof.guarded !== true || endpoint.protocol !== "ws:" ||
      !["127.0.0.1", "[::1]"].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(endpoint.pathname)) {
    throw new Error("The browser guard did not return a verified local Chrome endpoint.");
  }
  const browser = await chromium.connectOverCDP(endpoint.href, { timeout: 15_000 });
  if (!isPatched(browser.version()) || proof.version !== `Chrome/${browser.version()}`) {
    await browser.close();
    throw new Error("Chrome changed or is below the verified security floor. Update and retry.");
  }
  // Playwright creates only temporary contexts; closing this connection leaves
  // pre-existing Chrome tabs and the browser process running.
  return browser;
}
