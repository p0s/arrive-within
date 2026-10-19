# Local App Store screenshot matrix

Status: No submission-ready 24-image candidate is ready. The files on disk are historical and do not meet the current source-bound schema 6 contract. Their slide 2 seed is light appearance and does not prove the requested dark-seed/light-Garden composition. Fresh captures from four iPhone/iPad simulator xcresults are pending. Physical hardware, TestFlight, and release checks remain separate evidence. The corrected icon artwork is present; archive, Home Screen, TestFlight, and storefront icon readback are pending. App Store Connect has not been changed. Exact replacement images require owner visual review before screenshot upload.

## Current simulator capture protocol

Fresh marketing capture uses iPhone 17 Pro and iPad Pro 13-inch (M5) simulators on iOS 26.5. Each device has one selected-state/dusk xcresult and one Garden-day/day xcresult; each result contains exactly two passing tests, English and German. The selected-state run captures Garden hero, Garden seed, Journey calendar, Journey milestones, and Journal. The other run captures Garden-day.

The shared app clock fixture is independent of the simulator system clock and needs no real-time day/dusk wait:

| Fixture | UTC instant | Asia/Singapore | Garden phase | Use |
|---|---|---|---|---|
| `day-v1` | `2026-08-01T01:41:00Z` | `2026-08-01 09:41` | day | Garden-day |
| `dusk-v1` | `2026-08-01T09:41:00Z` | `2026-08-01 17:41` | dusk | Every selected-state capture, including Journey and Journal |

The simulator status bar is captured as rendered and receives no override. Source proof binds the shared fixture ID and epoch, Garden timezone/phase, fixture-derived local date/time, actual XCTest capture timestamp, and observed system timezone. The public evidence retains product model/platform/OS, safe bundle names, and hashes while omitting pool identifiers, custom pool device names, and private result paths.

Schema 6 accepts exactly four simulator result bundles for the current signed source revision. It does not accept physical-device screenshots as marketing inputs. Physical hardware and TestFlight tests continue under their separate release contracts.

## Historical output

- Six selected Garden/growth slides in the approved order for `en-US` and `de-DE`: light-mode Journey rhythm, Garden growth, Garden hero, milestones, reflection, and refuge; daily-practice and private-depth remain non-shipping matrices with human review pending.
- iPhone 6.9-inch portrait at `1320×2868` and iPad 13-inch portrait at `2064×2752`.
- Exactly 24 numbered opaque RGB PNGs across four locale/device sets.
- Each set includes six PNGs, SHA-256 values in `_manifest.json`, passing `_validation.txt` and `_validation.json`, `_contact-sheet.jpg`, and a deterministic ZIP.
- Matrix summary: `Marketing/AppStoreScreenshots/exports/_matrix-manifest.json`.
- Matrix validation: `Marketing/AppStoreScreenshots/exports/_matrix-validation.json` and `_matrix-validation.txt`.

## Actual rendered UI provenance

The prior inputs were attachments from guarded `ArriveWithinMarketingCaptureUITests` English and German runs, not a mock app surface. The records below describe historical results only and are not proof for the current candidate.

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

The generator is pinned to patched Sharp 0.35.3 with exact-origin and bounded attachment-path controls. At the time of the build-19 refresh, guarded iPhone/iPad result bundles passed and their captures replaced the then-current historical export. That historical provenance no longer binds the current working tree.

The two non-shipping alternatives may reuse only Garden, Journey, and Journal captures whose visible pixels remain compatible with the local-only V1. They never use obsolete guided-library, Practice chooser, or iCloud screenshots. They were not regenerated in this build-17 refresh; their review state remains `pending` and upload authority remains `candidate-only-not-selected`.

## Claim boundary

The selected matrix uses Garden growth, Journey rhythm/milestones, and private reflection only. It makes no guided-narration or iCloud-convergence claim; narration remains a separate binary/runtime proof boundary.

The prior four contact sheets and representative full-resolution slide 1 images were inspected for clipping, English/German fit, actual-UI provenance, Garden prominence, and legibility. Slide 1 is genuinely light mode in both locales and device families. That prior matrix was approved and remains historical evidence, not approval of the revised outputs.

## Superseded build 19 export

On 2026-09-25, a local matrix was exported against app version 1.0.2 (build 19), source revision `27192a1de32b40c6ee66494a45f81bc28b87e7cbc680f3d11b904f00baa2a810`. Its iPhone images are `1320×2868` and its iPad 11-inch images are `1488×2266`. These are historical outputs, not current candidate evidence: the source revision predates the current working tree, and the source captures do not prove the requested dark Garden seed. The prior iPad 13 captures remain pinned in `source-captures.json` as `stale-incomplete` and are missing `garden-day`.

The exact guarded pool result bundles contain four passed tests each, with no failures or skips:

| Route | Result bundle | Tree SHA-256 |
|---|---|---|
| iPhone 17 Pro, iOS 26.5 | `20260925T035715Z-634-bd122961c1.xcresult` | `5de862a6d413153569bca840ca06af614d92fc5909813f727364ff194b358601` |
| iPad Pro 11-inch (M5), iOS 26.5 | `20260925T044923Z-634-5cc5a56f7c.xcresult` | `bc1788e19626ca6430a1eebe18a6f2af48db094ccf32f696430000e773267f88` |

Both locale Garden-day captures use the unmodified Asia/Singapore simulator clock. Their visible status times are 12:37/12:37 on iPhone and 12:51/12:52 on iPad. The source manifest is `Marketing/AppStoreScreenshots/capture-source-manifest-v1.0.2-build-19.json`, SHA-256 `5dd09760f9d7b2961688e51b20af293b6be402be3780098779a203bafbbd84c4`. Each selected-state test records the runtime warning `Invalid frame dimension (negative or non-finite).`; both Garden-day methods have no runtime warnings. The warnings are preserved by test identifier in `source-captures.json` and each export manifest.

The candidate validator passed the historical export’s dimensions, opacity, hashes, normalization, contact sheets, ZIP contents, network checks, and geometry. That technical result does not make those files current-source evidence. The prior visual statement that slide 2 had a dark rear Garden seed was incorrect: the source file currently on disk is light, and the 16:31 status time does not prove the required night capture. Replace these exports only after fresh source-bound captures and complete matrix validation. Owner visual review and screenshot upload remain pending; upload authorization remains `candidate-only-human-review-pending-not-upload-authorized`, and no App Store Connect mutation was made.
