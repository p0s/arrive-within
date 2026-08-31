# Local App Store screenshot matrix

Status: Clean Editorial / Tonal Wash pilot mechanically verified and visually approved on 2026-08-30. The public version 1.0 listing remains untouched with its previously approved live screenshots unchanged.

## Frozen output

- Six selected Garden/growth slides in the approved order for `en-US` and `de-DE`: light-mode Journey rhythm, Garden growth, Garden hero, milestones, reflection, and refuge; daily-practice and private-depth remain non-shipping matrices with human review pending.
- iPhone 6.9-inch portrait at `1320×2868` and iPad 13-inch portrait at `2064×2752`.
- Exactly 24 numbered opaque RGB PNGs across four locale/device sets.
- Each set includes six PNGs, SHA-256 values in `_manifest.json`, passing `_validation.txt` and `_validation.json`, `_contact-sheet.jpg`, and a deterministic ZIP.
- Matrix summary: `Marketing/AppStoreScreenshots/exports/_matrix-manifest.json`.
- Matrix validation: `Marketing/AppStoreScreenshots/exports/_matrix-validation.json` and `_matrix-validation.txt`.

## Actual rendered UI provenance

The inputs are attachments from the guarded `ArriveWithinMarketingCaptureUITests` English and German tests, not a mock app surface. They preserve the actual visible simulator status from each exact passed run; no synthetic status-bar overlay is claimed.

| Device | Result bundle | Test result | Tree SHA-256 |
|---|---|---|---|
| Pooled iPhone 17 Pro, iOS 26.5 simulator | `arrive-within-b17-iphone.xcresult` | 2 passed, 0 failed, 0 skipped | `f4cbde73d587e1ed53679ee8389afa51e9def2cfbd40005fdbf04d1a5fc48603` |
| Pooled iPad Pro 13-inch (M5), iOS 26.5 simulator | `arrive-within-b17-ipad13.xcresult` | 2 passed, 0 failed, 0 skipped | `b6aa3ad729f0ba0f2a08ab45bb726a6ee227bdd31722a19079f3f55324bc2a37` |

The capture-source revision is `aed3e83d30d6290cb99731be79675fcfbeb7941168ec960479e08148b1293925`. The selected test wave ingested exactly five safe actual-UI states per locale/device set (20 attachments total): Garden hero, Garden seed, Journey calendar, Journey milestones, and Journal. It binds the version 1.0 (17) local candidate surface, including the Garden-first full-canvas composition, the reduced Twilight fixed-fill lighting, the hardened local-only Journal/export behavior, and the current English/German labels. Slide 1 intentionally reuses the validated light-mode Journey calendar capture; no new capture was required. These screenshots make no guided-narration or CloudKit-convergence claim.

The capture validator binds the refreshed local images to capture-source revision `aed3e83d30d6290cb99731be79675fcfbeb7941168ec960479e08148b1293925` and export tree `c1a000c9ad07e47b1ada03f49c3d557b86e3880b9d3dfb4e299ea4f36dbd30a6`. No App Store Connect screenshot mutation was performed. The existing build-16 version 1.0 listing and review submission remain untouched; this Tonal Wash pilot is candidate evidence only and is not represented as distribution-archive frames.

The later iPhone Live Activity implementation and build-18 version metadata are bound as an exact nonvisual capture delta at source revision `ddee3520ef906537530f88c9a68f296dfdf6a62cfd208cddb3f31972162bae09`. Its ten changed capture-source paths add the system activity, append two localization keys per language, connect read-only session synchronization, and select build 18; they do not change the required Garden, Journey, or Journal capture IDs or their pixels. The prior review therefore remains evidence only for the retained 24 images. Exact physical build 18 now proves the compact Dynamic Island core lifecycle; Lock Screen, expanded presentation, authorization-disabled, assistive-technology, and energy rows remain pending and are not inferred from this retention boundary.

## Deterministic export proof

Playwright blocks every non-local request by parsed exact-origin equality. Final PNGs use a dependency-free canonical RGB decoder/encoder that clears only the compositor-unstable least-significant RGB bit, applies one deterministic Paeth filter per row, and emits no metadata. Pinned Sharp 0.35.3 builds contact sheets and metadata-free JPEGs. Manifests omit wall-clock generation time; ZIP member dates are fixed.

`scripts/verify-reproducibility.ts` performed two complete, back-to-back four-set exports followed by full matrix validation. All 47 artifacts matched byte-for-byte; the reproducibility tree SHA-256 is `c1a000c9ad07e47b1ada03f49c3d557b86e3880b9d3dfb4e299ea4f36dbd30a6`. The machine-readable record is `docs/qa/marketing/app-store-screenshots-reproducibility.json`. The final matrix-manifest SHA-256 is `a671a387b8d900d5e096cd87d817a56c778df92adef4481b48c45f522a68eeeb`; the JSON validation SHA-256 is `e7d8824c1d1dd2f6cc60458f32548a91dddd60116f5633b99d118e60e89bb9c8`.

The Tonal Wash exporter uses an explicit integer-sized full-page clip because fractional document offsets could otherwise produce a one-pixel localized output drift. It still disables GPU and Skia runtime optimizations, and the final device treatment is straight, unrotated, and free of decorative connector geometry. This changes no app UI, source capture, or product claim.

The generator remains pinned to patched Sharp 0.35.3 with exact-origin and bounded attachment-path controls. The current-source guarded iPhone/iPad captures replaced the historical export only after both result bundles passed and ingestion re-bound their exact provenance.

The two non-shipping alternatives may reuse only Garden, Journey, and Journal captures whose visible pixels remain compatible with the local-only V1. They never use obsolete guided-library, Practice chooser, or iCloud screenshots. They were not regenerated in this build-17 refresh; their review state remains `pending` and upload authority remains `candidate-only-not-selected`.

## Claim boundary

The selected matrix uses Garden growth, Journey rhythm/milestones, and private reflection only. It makes no guided-narration or iCloud-convergence claim; narration remains a separate binary/runtime proof boundary.

All four current contact sheets and representative full-resolution slide 1 images were inspected for clipping, English/German fit, actual-UI provenance, Garden prominence, and legibility. Slide 1 is genuinely light mode in both locales and device families; slide 2 presents the truthful Garden before/after state in straight frames without a growth connector. Every local per-set and matrix human-review field reads `approved`. These files remain local and unsubmitted; no claim is made that App Store Connect contains them.
