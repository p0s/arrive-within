#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import path from "node:path";

import { ROOT, assertPlan, loadPlan } from "./contracts";

function option(flag: string): string {
  const index = process.argv.indexOf(flag);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${flag}`);
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const baseURL = new URL(option("--url"));
  if (
    baseURL.protocol !== "http:"
    || baseURL.hostname !== "127.0.0.1"
    || baseURL.username !== ""
    || baseURL.password !== ""
  ) throw new Error("candidate export requires the unauthenticated local screenshot server on 127.0.0.1");

  const plan = await loadPlan();
  assertPlan(plan);
  for (const locale of plan.locales) {
    for (const device of plan.devices) {
      const url = new URL(baseURL);
      url.searchParams.set("device", device.id);
      url.searchParams.set("locale", locale);
      const args = [
        "--import", "tsx", path.join(ROOT, "scripts/export-playwright.ts"),
        "--url", url.href,
        "--width", String(device.width),
        "--height", String(device.height),
        "--locale", locale,
        "--device", device.id,
        "--theme", "forest-twilight",
        "--out", path.join(ROOT, "exports", locale, device.id),
      ];
      process.stdout.write(`Exporting ${locale}/${device.id}…\n`);
      execFileSync(process.execPath, args, {
        cwd: ROOT,
        encoding: "utf8",
        stdio: "inherit",
        maxBuffer: 16 * 1024 * 1024,
      });
    }
  }
  execFileSync(process.execPath, [
    "--import", "tsx", path.join(ROOT, "scripts/validate-export-matrix.ts"), "--candidate-only",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
    maxBuffer: 16 * 1024 * 1024,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
