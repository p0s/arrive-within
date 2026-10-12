import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = path.join(websiteRoot, "edge", "wrangler.toml");

function assignmentsIn(lines, key) {
  const matches = [];
  let section = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^\[\[?[A-Za-z0-9_.-]+\]?\]$/.test(trimmed)) {
      section = trimmed;
      continue;
    }
    const assignment = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*(?:#.*)?$/.exec(trimmed);
    if (assignment?.[1] === key) matches.push({ section, value: assignment[2] });
  }
  return matches;
}

export function parseWranglerProjectConfig(text) {
  if (typeof text !== "string") throw new Error("Wrangler configuration must be text");
  const lines = text.split(/\r?\n/);
  const accountEntries = assignmentsIn(lines, "account_id");
  const nameEntries = assignmentsIn(lines, "name");
  if (accountEntries.length !== 1 || accountEntries[0].section !== "") {
    throw new Error("Wrangler configuration must contain one top-level account_id");
  }
  const accountMatch = /^"([a-f\d]{32})"$/.exec(accountEntries[0].value);
  if (!accountMatch) throw new Error("Wrangler account_id must be a quoted 32-character hexadecimal value");
  if (nameEntries.length !== 1 || nameEntries[0].section !== "") {
    throw new Error("Wrangler configuration must contain one top-level Worker name");
  }
  const nameMatch = /^"([A-Za-z0-9_-]+)"$/.exec(nameEntries[0].value);
  if (!nameMatch) throw new Error("Wrangler Worker name must be a quoted identifier");

  const routeBlocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== "[[routes]]") continue;
    const block = [];
    for (let cursor = index + 1; cursor < lines.length && !/^\s*\[/.test(lines[cursor]); cursor += 1) {
      block.push(lines[cursor].trim());
    }
    const patterns = assignmentsIn(block, "pattern");
    const customDomains = assignmentsIn(block, "custom_domain");
    if (patterns.length !== 1 || patterns[0].section !== "" || customDomains.length !== 1
      || customDomains[0].section !== "" || customDomains[0].value !== "true") {
      throw new Error("Wrangler route must define one pattern with custom_domain = true");
    }
    const pattern = /^"([^"\r\n]+)"$/.exec(patterns[0].value);
    if (!pattern) throw new Error("Wrangler custom domain pattern must be a quoted hostname");
    routeBlocks.push(pattern[1]);
  }
  if (routeBlocks.length !== 2 || new Set(routeBlocks).size !== routeBlocks.length) {
    throw new Error("Wrangler configuration must contain exactly two distinct custom-domain routes");
  }
  return { accountId: accountMatch[1], workerName: nameMatch[1], customDomains: routeBlocks };
}

export function assertProductionWranglerConfig(text, { workerName, customDomains }) {
  const binding = parseWranglerProjectConfig(text);
  if (binding.workerName !== workerName) throw new Error("Wrangler configuration does not match the fixed Arrive Within Worker");
  if (JSON.stringify(binding.customDomains) !== JSON.stringify(customDomains)) {
    throw new Error("Wrangler configuration does not match the fixed Arrive Within custom domains");
  }
  return binding;
}

export async function readProductionWranglerConfig({
  configPath = defaultConfigPath,
  workerName,
  customDomains,
}) {
  return assertProductionWranglerConfig(await readFile(configPath, "utf8"), { workerName, customDomains });
}
