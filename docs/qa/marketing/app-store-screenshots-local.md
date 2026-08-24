# Local App Store screenshot matrix

Status: Build-17 local candidate set mechanically verified, visually approved, and intentionally not uploaded or attached. The existing build-16 version 1.0 listing remains `WAITING_FOR_REVIEW` with its previously approved live screenshots unchanged.

## Frozen output

- Six selected Garden/growth slides in the approved order for `en-US` and `de-DE`; daily-practice and private-depth remain non-shipping matrices with human review pending.
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

The capture-source revision is `aed3e83d30d6290cb99731be79675fcfbeb7941168ec960479e08148b1293925`. The selected test wave ingested exactly five safe actual-UI states per locale/device set (20 attachments total): Garden hero, Garden seed, Journey calendar, Journey milestones, and Journal. It binds the version 1.0 (17) local candidate surface, including the Garden-first full-canvas composition, the reduced Twilight fixed-fill lighting, the hardened local-only Journal/export behavior, and the current English/German labels. These screenshots make no guided-narration or CloudKit-convergence claim.

The capture validator binds the refreshed local images to capture-source revision `aed3e83d30d6290cb99731be79675fcfbeb7941168ec960479e08148b1293925` and export tree `93256827a2674dfb6eab66a278631f9472d93402e8a4a7380304bc9dc3d2df4d`. No App Store Connect screenshot mutation was performed. The existing build-16 version 1.0 listing and review submission remain untouched; the local build-17 screenshots are candidate evidence only and are not represented as distribution-archive frames.

## Deterministic export proof

Playwright blocks every non-local request by parsed exact-origin equality. Final PNGs use a dependency-free canonical RGB decoder/encoder that clears only the compositor-unstable least-significant RGB bit, applies one deterministic Paeth filter per row, and emits no metadata. Pinned Sharp 0.35.3 builds contact sheets and metadata-free JPEGs. Manifests omit wall-clock generation time; ZIP member dates are fixed.

`scripts/verify-reproducibility.ts` performed two complete, back-to-back four-set exports followed by full matrix validation. All 47 artifacts matched byte-for-byte; the reproducibility tree SHA-256 is `93256827a2674dfb6eab66a278631f9472d93402e8a4a7380304bc9dc3d2df4d`. The machine-readable record is `docs/qa/marketing/app-store-screenshots-reproducibility.json`. The final matrix-manifest SHA-256 is `b1b2c1e8ce43d09057d5ecf6092d1e7a015ce75ff8e58b9d2ab465d35e473a1e`; the JSON validation SHA-256 is `e7d8824c1d1dd2f6cc60458f32548a91dddd60116f5633b99d118e60e89bb9c8`.

Repeated hash diagnosis found that the rotated left comparison phone could vary by several antialiasing channel values under Chromium's Skia runtime optimizations. The exporter now disables GPU and Skia runtime optimizations, retaining the owner-approved tilted, overlapping phone composition while making the public generator byte-reproducible. This changes no app UI, slide claim, locale copy, or product scope.

The generator remains pinned to patched Sharp 0.35.3 with exact-origin and bounded attachment-path controls. The current-source guarded iPhone/iPad captures replaced the historical export only after both result bundles passed and ingestion re-bound their exact provenance.

The two non-shipping alternatives may reuse only Garden, Journey, and Journal captures whose visible pixels remain compatible with the local-only V1. They never use obsolete guided-library, Practice chooser, or iCloud screenshots. They were not regenerated in this build-17 refresh; their review state remains `pending` and upload authority remains `candidate-only-not-selected`.

## Claim boundary

The selected matrix uses Garden growth, Journey rhythm/milestones, and private reflection only. It makes no guided-narration or iCloud-convergence claim; narration remains a separate binary/runtime proof boundary.

All four current contact sheets and representative full-resolution images were inspected for clipping, English/German fit, actual-UI provenance, Garden prominence, and legibility. The second slide retains the owner-approved overlapping, tilted-device composition rather than presenting two bare screenshots. Every local per-set and matrix human-review field reads `approved`. These refreshed files remain local and unsubmitted; no claim is made that App Store Connect contains them.
