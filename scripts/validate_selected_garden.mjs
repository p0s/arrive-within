#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireSelected = process.argv.includes("--require-selected");
const selectionPath = join(projectRoot, "docs/product/garden-production-selection.json");
const authorityPath = join(projectRoot, "Renderer/src/shipping-visual.ts");
const mainPath = join(projectRoot, "Renderer/src/main.ts");
const selection = JSON.parse(readFileSync(selectionPath, "utf8"));
const authority = readFileSync(authorityPath, "utf8");
const main = readFileSync(mainPath, "utf8");

assert(selection.schema_version === 1, "unsupported Garden production-selection schema");
assert(
  selection.shipping_authority === "Renderer/src/shipping-visual.ts",
  "Garden selection must name the single shipping authority",
);
assert(
  main.includes('from "./shipping-visual"')
    && !main.includes("./visual-directions/"),
  "shipping entry must depend on the single authority, not a direction module",
);
assert(
  main.includes("shippingGardenVisualDirection"),
  "shipping entry does not consume its visual authority",
);

const reachable = reachableRelativeTypeScript(mainPath);
const reachableDirections = [...reachable]
  .map((path) => relative(projectRoot, path))
  .filter((path) => path.startsWith("Renderer/src/visual-directions/"))
  .sort();
const premiumDirections = selection.premium_material_profiles ?? [];
const expectedReachableDirections = [
  ...(selection.status === "owner-selected" ? premiumDirections : []),
  selection.status === "owner-selected" ? selection.selected_direction : selection.safe_baseline_direction,
].map((direction) => `Renderer/src/visual-directions/${direction}.ts`).sort();
assert(
  JSON.stringify(reachableDirections) === JSON.stringify(expectedReachableDirections),
  `shipping renderer direction set drifted: ${reachableDirections.join(", ")}`,
);
assert(
  [...reachable].every((path) => !relative(projectRoot, path).startsWith("Renderer/design-lab/")),
  "design-lab code is reachable from the shipping renderer",
);

const pending = selection.status === "owner-selection-pending";
if (pending) {
  assert(!requireSelected, "Garden owner selection is required for the final candidate gate");
  assert(selection.selected_direction === null, "pending selection must not name a winner");
  assert(selection.selected_modules === null, "pending selection must not imply a module mix");
  assert(selection.selection_date === null, "pending selection must not carry a selection date");
  assert(selection.release_exclusive === false, "pending selection is not release-exclusive proof");
  assert(
    authority.includes('state: "safe-baseline-owner-selection-pending"')
      && authority.includes(`direction: "${selection.safe_baseline_direction}"`),
    "shipping authority does not preserve the declared safe baseline",
  );
  assert(
    reachableDirections.includes(`Renderer/src/visual-directions/${selection.safe_baseline_direction}.ts`),
    "safe baseline direction is not the only reachable direction module",
  );
} else {
  assert(selection.status === "owner-selected", "unknown Garden selection state");
  assert(typeof selection.selected_direction === "string", "selected direction is missing");
  assert(typeof selection.selection_date === "string", "selection date is missing");
  assert(selection.release_exclusive === true, "selected Garden must be release-exclusive");
  assert(
    authority.includes('state: "owner-selected"')
      && authority.includes(`direction: "${selection.selected_direction}"`),
    "shipping authority and owner selection disagree",
  );
  assert(
    reachableDirections.includes(`Renderer/src/visual-directions/${selection.selected_direction}.ts`),
    "selected composition is not reachable from the shipping renderer",
  );

  const bundlePath = join(projectRoot, "Renderer/dist/renderer.js");
  const manifestPath = join(projectRoot, "Renderer/dist/renderer-manifest.json");
  assert(existsSync(bundlePath) && existsSync(manifestPath), "selected renderer bundle is missing");
  const bundle = readFileSync(bundlePath, "utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert(manifest.visualDirection === selection.selected_direction, "built visual direction drifted");
  assert(manifest.visualSelectionState === "owner-selected", "built selection state drifted");
  assert(manifest.unselectedDirectionModulesPresent === false, "built manifest admits alternate direction modules");
  assert(manifest.byteCount === statSync(bundlePath).size, "built renderer byte count drifted");
  assert(manifest.sha256 === sha256(bundlePath), "built renderer hash drifted");
  const directionNames = {
    "verdant-atelier": "Verdant Atelier",
    "paper-sanctuary": "Paper Sanctuary",
    "twilight-refuge": "Twilight Refuge",
  };
  for (const [direction, name] of Object.entries(directionNames)) {
    if (direction === selection.selected_direction) continue;
    assert(
      !bundle.includes(name),
      `unselected Garden identity entered the built renderer: ${direction}`,
    );
  }
}

process.stdout.write(
  `Selected Garden boundary passed: ${reachableDirections.join(", ")}; state=${selection.status}.\n`,
);

function reachableRelativeTypeScript(entryPath) {
  const visited = new Set();
  const pendingPaths = [entryPath];
  while (pendingPaths.length > 0) {
    const current = pendingPaths.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    const source = readFileSync(current, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*)["'](\.[^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const candidate = resolve(dirname(current), specifier);
      const resolved = [candidate, `${candidate}.ts`, join(candidate, "index.ts")]
        .find((path) => existsSync(path));
      if (resolved !== undefined && resolved.startsWith(join(projectRoot, "Renderer") + "/")) {
        pendingPaths.push(resolved);
      }
    }
  }
  return visited;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
