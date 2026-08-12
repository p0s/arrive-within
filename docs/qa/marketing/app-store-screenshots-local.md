# Local App Store screenshot matrix

Status: Current-source Garden/growth set mechanically verified, visually approved, attached to version 1.0, and checksum-read back from App Store Connect.

## Frozen output

- Six selected Garden/growth slides in the approved order for `en-US` and `de-DE`; daily-practice and private-depth remain non-shipping matrices with human review pending.
- iPhone 6.9-inch portrait at `1320×2868` and iPad 13-inch portrait at `2064×2752`.
- Exactly 24 numbered opaque RGB PNGs across four locale/device sets.
- Each set includes six PNGs, SHA-256 values in `_manifest.json`, passing `_validation.txt` and `_validation.json`, `_contact-sheet.jpg`, and a deterministic ZIP.
- Matrix summary: `Marketing/AppStoreScreenshots/exports/_matrix-manifest.json`.
- Matrix validation: `Marketing/AppStoreScreenshots/exports/_matrix-validation.json` and `_matrix-validation.txt`.

## Actual rendered UI provenance

The inputs are attachments from the guarded `ArriveWithinMarketingCaptureUITests` English and German tests, not a mock app surface. They preserve the actual visible status from each exact passed run; no synthetic status-bar overlay was claimed for the physical-device captures.

| Device | Result bundle | Test result | Tree SHA-256 |
|---|---|---|---|
| Pooled iPhone 17 Pro, iOS 26.5 simulator | `final-b6-current-source-720deeed-iphone.xcresult` | 2 passed, 0 failed, 0 skipped | `83b7403653c16a8fa43ca700fd5d5f0cedd7b7bc844c07a39d2e072af368878b` |
| Authorized physical iPad Pro 13-inch (M4), iOS 26.6 | `final-b6-current-source-720deeed-ipad.xcresult` | 2 passed, 0 failed, 0 skipped | `c02bf3fddf084174f47b1af92865e32442f0c5a31c4cffe20f837af6b06d16c7` |

The capture-source revision is `720deeed8719b680ebe4359e1f572565780cc1015ce4ab0d83cb530335bfb405`. The selected test wave ingested exactly five safe actual-UI states per locale/device set (20 attachments total): Garden hero, Garden seed, Journey calendar, Journey milestones, and Journal. It binds version 1.0 (6), the Garden-first full-canvas composition, the reduced Twilight fixed-fill lighting, the hardened local-only Journal/export behavior, and the zero-audio Practice behavior; it contains no guided-narration or CloudKit-convergence marketing state.

The current-source validator also binds the exact six-file post-capture delta. Three files advance nonvisual legal packaging/build metadata to build 7; the other three correct the renderer-to-Swift inventory-diagnostics event and rebuilt bundle manifest. The latter changes observability only—no rendering, layout, camera, lighting, animation, product state, localization, or captured pixel—so a narrow deterministic attestation preserves the approved captures without pretending they were recaptured after that diagnostic fix.

## Deterministic export proof

Playwright blocks every non-local request by parsed exact-origin equality. Final PNGs use a dependency-free canonical RGB decoder/encoder that clears only the compositor-unstable least-significant RGB bit, applies one deterministic Paeth filter per row, and emits no metadata. Pinned Sharp 0.35.3 builds contact sheets and metadata-free JPEGs. Manifests omit wall-clock generation time; ZIP member dates are fixed.

`scripts/verify-reproducibility.ts` performed two complete, back-to-back four-set exports followed by full matrix validation. All 47 artifacts matched byte-for-byte; the reproducibility tree SHA-256 is `dc1c5ffad75333d12aab2f0b520299d12ed7c078cd2bea82506c457634236c28`. The machine-readable record is `docs/qa/marketing/app-store-screenshots-reproducibility.json`. The final matrix-manifest SHA-256 is `8eb7bb0f6b96e43da373c1c97658714d68d25869fe69465ef44ca20de5cffdb2`; the JSON validation SHA-256 is `e7d8824c1d1dd2f6cc60458f32548a91dddd60116f5633b99d118e60e89bb9c8`.

Repeated hash diagnosis found that the rotated left comparison phone could vary by several antialiasing channel values under Chromium's Skia runtime optimizations. The exporter now disables GPU and Skia runtime optimizations, retaining the owner-approved tilted, overlapping phone composition while making the public generator byte-reproducible. This changes no app UI, slide claim, locale copy, or product scope.

The generator remains pinned to patched Sharp 0.35.3 with exact-origin and bounded attachment-path controls. The current-source guarded iPhone/iPad captures replaced the historical export only after both result bundles passed and ingestion re-bound their exact provenance.

The two non-shipping alternatives reuse only the retained Garden, Journey, and Journal captures whose visible pixels remain compatible with the zero-narration, local-only V1. They never use the retained obsolete guided-library, Practice chooser, or iCloud screenshots. Each alternative passes two complete 47-artifact export cycles across English/German phone/tablet: `daily-practice` reproduces tree SHA-256 `7912a627a3f04930b1982d1afadf42e6de7c506fec683a7a3a9366ac7b804755`; `private-depth` reproduces `6be35a576cfbdcf11b622c31998c8f4c2a3314e52d88a4befda36e23d4427345`. All eight alternative contact sheets were inspected for clipping and locale fit, but their generated review state deliberately remains `pending` and upload authority remains `candidate-only-not-selected`.

## Claim boundary

The selected matrix uses Garden growth, Journey rhythm/milestones, and private reflection only. It makes no guided-narration or iCloud-convergence claim for the zero-audio candidate.

All four current contact sheets and representative full-resolution images were inspected for clipping, English/German fit, actual-UI provenance, Garden prominence, and legibility. The second slide retains the owner-approved overlapping, tilted-device composition rather than presenting two bare screenshots. Every per-set and matrix human-review field reads `approved`. App Store Connect reads six `COMPLETE` assets in each of the four locale/device sets, and every live `sourceFileChecksum` matches its owner-approved numbered PNG. Exact build 7 is attached to the same submitted version 1.0 listing.
