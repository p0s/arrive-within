import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = { ...process.env };
if (["deploy", "versions upload"].includes(environment.WRANGLER_COMMAND)) {
  environment.ARRIVE_WITHIN_PUBLIC_BASE_URL = "https://arrivewithin.com";
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpm, ["run", "verify:edge"], {
  cwd: websiteRoot,
  env: environment,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(`Could not run the Wrangler verification command: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
