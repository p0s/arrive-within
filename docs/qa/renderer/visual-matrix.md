# Renderer milestone and variant visual matrix

Date: 2026-08-13
Status: Passed for deterministic local rendering and objective artifact validation; owner art review and physical performance remain pending
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## Outcome

The tracked matrix sends 30 safe synthetic `GardenState` snapshots through the shipping typed bridge and bundled Three.js renderer: one A/B pair for each of the 15 authored milestones on its exact practice day 2, 4, …, 30. Each pair holds all earlier milestones at variant A and changes only the newly unlocked milestone, so it isolates all 30 authored selections without inventing a second rendering path.

Every frame is an opaque 1280×720 PNG. Playwright blocked external network access and observed zero external requests. The manifest binds the generator, explicit milestone plan, shared schema, complete embedded states, renderer source, frame hashes, and two contact sheets. Validation passes 257/257 checks; `release_ready` remains false and `human_review` remains pending.

## Reproducible checks

| Check | Result |
|---|---|
| `node Marketing/RendererVisualMatrix/scripts/generate-renderer-visual-matrix.mjs` | 15 milestone pairs / 30 frames generated through the shipping bridge; zero external requests |
| `node Marketing/RendererVisualMatrix/scripts/validate-renderer-visual-matrix.mjs --write-report` | 256 passed, 0 failed |
| Second independent generation pass | Under Node 26.7.0, Playwright 1.61.1, and Sharp 0.35.3, all 30 frame hashes, both contact-sheet hashes, and the complete manifest were byte-identical; artifact-vector SHA-256 `5673a3f1f2d700ae77beb9b1c0082914dc0877ddb9ad9e3a6091959a87aeb7da` |
| Objective A/B pixel comparison | Every pair differs; changed-pixel ratio ranges from 0.620660% to 10.176541% |
| Original-resolution contact-sheet inspection | All 15 stages progress coherently, both sheets are complete and unclipped, and no placeholder or third-party visual appears; this is agent inspection, not owner/human approval |

## Bound artifacts

- Plan SHA-256: `2e8c9800f845328fc1fd369e17ea0eeec9bd839cfb89cd4cceab1af9816d6122`
- Renderer source SHA-256: `9867787a40ba0220f23f90270b996bc60d62dd3ea2d791c6c58ed96b4c8b9f31`
- Manifest SHA-256: `d7d25321b34ab04a60773a0fea97ff2a375c6623851582e92a80ffb450961b8c`
- Variant-A contact sheet SHA-256: `f33220de71e51e7fb393d2512616fe98e0df2a67a6cb5c9051304d7fcaec5258`
- Variant-B contact sheet SHA-256: `188c080b9b1449baaefa7b4173a25748d0cdb1e3d985904db8402ee81dadcc1c`

This evidence proves local deterministic renderer coverage only. Owner-authored-art approval, actual motion review, accessibility of the native description/fallback, physical iPhone/iPad frame/memory/thermal performance, and signed-candidate repetition remain separate gates.
