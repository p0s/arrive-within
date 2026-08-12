#!/usr/bin/env tsx
import { assertNarrativeAlternatives, loadNarrativeAlternatives } from "./contracts";

async function main(): Promise<void> {
  const document = await loadNarrativeAlternatives();
  assertNarrativeAlternatives(document);

  process.stdout.write(
    `Narrative sources passed: Garden/growth selected; all 3 narratives remain non-shipping source references.\n`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
