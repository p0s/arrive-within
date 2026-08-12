import { createHash } from "node:crypto";
import { readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = join(rendererRoot, "dist");
const indexPath = join(distDirectory, "index.html");
const shippingVisualPath = join(rendererRoot, "src", "shipping-visual.ts");

await build({
  root: rendererRoot,
  configFile: join(rendererRoot, "vite.config.ts"),
});

const html = await readFile(indexPath, "utf8");
const scriptTags = [...html.matchAll(/<script defer src="\.\/assets\/([^"]+\.js)"><\/script>/g)];
if (scriptTags.length !== 1) {
  throw new Error(`Expected one deterministic renderer entry script, found ${scriptTags.length}.`);
}

const [scriptTag, scriptFile] = scriptTags[0];
if (scriptTag === undefined || scriptFile === undefined) {
  throw new Error("The deterministic renderer entry script could not be resolved.");
}
const scriptPath = join(distDirectory, "assets", scriptFile);
if (resolve(scriptPath).startsWith(resolve(distDirectory) + "/") === false) {
  throw new Error("The renderer entry script escaped the build directory.");
}
const script = await readFile(scriptPath, "utf8");
const digest = createHash("sha256").update(script, "utf8").digest("hex");
const shippingVisualSource = await readFile(shippingVisualPath, "utf8");
const selectedDirection = requiredCapture(
  shippingVisualSource,
  /direction:\s*"(verdant-atelier|paper-sanctuary|twilight-refuge)"/,
  "shipping visual direction",
);
const visualSelectionState = requiredCapture(
  shippingVisualSource,
  /state:\s*"(safe-baseline-owner-selection-pending|owner-selected)"/,
  "shipping visual selection state",
);
const directionNames = {
  "verdant-atelier": "Verdant Atelier",
  "paper-sanctuary": "Paper Sanctuary",
  "twilight-refuge": "Twilight Refuge",
};
for (const [direction, name] of Object.entries(directionNames)) {
  if (direction === selectedDirection) continue;
  if (script.includes(name)) {
    throw new Error(`Unselected Garden direction entered the shipping renderer: ${direction}.`);
  }
}
const sourcePolicy = "script-src 'self' file:";
if (html.includes(sourcePolicy) === false) {
  throw new Error("The source renderer CSP marker is missing.");
}

const finalized = html
  .replace(sourcePolicy, "script-src 'none'")
  .replace(scriptTag, "");
if (
  finalized.includes("script-src 'none'") === false
  || finalized.includes("<script")
  || finalized.includes('type="module"')
  || finalized.includes(" crossorigin")
) {
  throw new Error("The finalized renderer did not satisfy its user-script CSP contract.");
}

await writeFile(indexPath, finalized, "utf8");
await writeFile(join(distDirectory, "renderer.js"), script, "utf8");
await writeFile(
  join(distDirectory, "renderer-manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      entry: "renderer.js",
      byteCount: Buffer.byteLength(script, "utf8"),
      sha256: digest,
      visualDirection: selectedDirection,
      visualSelectionState,
      unselectedDirectionModulesPresent: false,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
await unlink(scriptPath);
const remainingAssets = await readdir(join(distDirectory, "assets"));
if (remainingAssets.length === 0) {
  await rmdir(join(distDirectory, "assets"));
}

function requiredCapture(source, pattern, label) {
  const value = source.match(pattern)?.[1];
  if (value === undefined) throw new Error(`Could not resolve ${label}.`);
  return value;
}
