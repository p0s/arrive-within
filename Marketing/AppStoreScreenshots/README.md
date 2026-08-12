# Arrive Within App Store screenshot studio

This tracked, localhost-only Next.js studio composes the frozen six-slide narrative and three complete owner-selection alternatives from actual deterministic Arrive Within UI captures. It does not contain a mock application surface.

## Product sets

- `en-US` and `de-DE`
- iPhone 6.9-inch portrait at `1320×2868`
- iPad 13-inch portrait at `2064×2752`
- six slides per locale/device, 24 final PNGs total
- exactly one localized headline block per slide; no product-name eyebrow, subtitle, or supporting-copy layer
- the product screenshot begins close beneath the headline so the app remains the dominant proof surface
- Garden/growth is the selected six-slide shipping narrative; the other complete narratives remain non-shipping source references
- one freshly captured and validated 24-image matrix is eligible for App Store attachment

## Capture boundary

`screenshot-plan.json` defines the five selected Garden/growth product states for all four locale/device sets. A guarded XCUITest capture run must produce those opaque, safe-synthetic-data PNGs, then bind their source-tree revision and SHA-256 values in `source-captures.json`. The export refuses missing, transparent, wrong-size, unbound, or hash-mismatched captures. The two non-shipping alternatives reuse only retained Garden, Journey, and Journal captures whose pixels remain truthful for the zero-narration, local-only V1; obsolete guided-library and iCloud captures are excluded. Simulator captures prove only the marketing composition input; they do not substitute for physical-device or release-candidate evidence.

## Local export

1. Capture with the guarded project workflow on the exact selected iPhone and iPad targets, then run `pnpm ingest:captures -- --iphone-result <exact.xcresult> --ipad-result <exact.xcresult>`. Record the status bar actually visible in each source; use a fixed profile when the target supports it, but never claim a synthetic profile for a physical-device capture.
2. Run `pnpm validate:plan` and `pnpm validate:captures`.
3. Start the studio with `pnpm start` after `pnpm build`; it binds only to `127.0.0.1`.
4. Run the four `export:*` scripts serially, followed by `pnpm validate:exports`.
5. Inspect every `_contact-sheet.jpg`, then record human review without changing generated pixels or hashes.
6. After accepting a new capture source as the current local website input, run `node scripts/sync-website-ui.mjs`; the website validator rejects any source/copy/provenance drift.

## Narrative alternatives

The three source narratives are `garden-growth`, `daily-practice`, and `private-depth`. Preview one by adding `&narrative=<id>` to the localhost URL. Export one locale/device set with the generic command, for example:

```sh
pnpm export:narrative -- --narrative garden-growth --url 'http://127.0.0.1:3000/?device=iphone-6.9&locale=en-US&narrative=garden-growth' --width 1320 --height 2868 --locale en-US --device iphone-6.9 --theme forest-twilight --out exports/alternatives/garden-growth/en-US/iphone-6.9
```

The alternatives directories remain upload-ineligible source references and their generated human-review state starts as `pending`. The selected final six-slide plan is exported without a narrative query after recapture from the exact final source; never upload an alternatives directory.

Each set contains six zero-padded opaque PNGs, `_manifest.json`, `_validation.txt`, `_validation.json`, `_contact-sheet.jpg`, and a ZIP. To eliminate nondeterministic one-bit compositor rounding, the exporter decodes each screenshot, clears only the least-significant bit of every RGB channel, and emits a canonical Paeth-filtered PNG. Pinned Sharp 0.35.3 builds each contact sheet directly from the six final PNGs in numbered order and creates a metadata-free JPEG, avoiding browser text/compositor variance. The matrix validator proves that PNG normalization is byte-idempotent, writes deterministic `_matrix-manifest.json` and `_matrix-validation.*` summaries under `exports/`, checks every artifact and ZIP member by SHA-256, and preserves human visual review as a separate gate. Generated manifests intentionally omit wall-clock time so identical sources yield byte-identical metadata and ZIPs. The exporter blocks external network requests and records source-capture provenance and hashes.
