# Arrive Within App Store screenshot studio

This tracked, localhost-only Next.js studio composes the frozen six-slide narrative and three complete owner-selection alternatives from actual Arrive Within UI captures. It does not contain a mock application surface.

## Product sets

- `en-US` and `de-DE`
- iPhone 6.9-inch portrait at `1320×2868`
- iPad 13-inch portrait at the required `2064×2752` size for apps that run on iPad
- Six slides per locale/device and 24 final PNGs
- One localized headline block per slide; no product-name eyebrow, subtitle, or supporting-copy layer
- Clean Editorial / Tonal Wash treatment with short left-aligned headlines, large straight device frames, and restrained app-palette washes
- Machine-enforced composition with a 4–7% headline-to-proof gap, proof at least 60% of canvas height, and proof lower edge at 94–104%
- The selected story opens with the light-mode Journey calendar, pairs a dark Garden seed behind a light Garden on slide 2, and introduces the dark Garden hero on slide 3
- Human visual review and release authorization remain separate gates

## Capture contract

Schema 6 uses four guarded XCUITest simulator result bundles: selected/dusk and Garden-day/day for iPhone 17 Pro and iPad Pro 13-inch (M5), iOS 26.5. Each bundle contains exactly the English and German test for that device and capture role. The selected-state test captures Garden hero, Garden seed, Journey calendar, Journey milestones, and Journal; the separate Garden-day test captures `garden-day`. The same role-specific fixture is used for both locales and both device families.

The shared `Apps/ArriveWithin/Resources/MarketingCaptureClockFixtures.json` supplies the injected Garden clock:

| Fixture | UTC instant | Asia/Singapore | Garden phase | Captures |
|---|---|---|---|---|
| `day-v1` | `2026-08-01T01:41:00Z` | `2026-08-01 09:41` | day | Garden-day |
| `dusk-v1` | `2026-08-01T09:41:00Z` | `2026-08-01 17:41` | dusk | all selected-state captures, including Journey and Journal |

The app clock is injected independently of the simulator system clock. The status bar is captured as the simulator rendered it; the capture run applies no status-bar override. Per-capture proof records the fixture ID, epoch, timezone, Garden phase, actual XCTest `captured_at`, and observed `system_timezone`. Fixture date/time comes from the shared JSON, not from manually entered evidence. The validator checks fixture identity and phase without waiting for a real day or dusk window.

Ingestion verifies the signed source commit and its exact capture-source manifest revision, four result-tree hashes, simulator product model/platform/OS, exact passing test names, warning lists, attachment paths and names, and each screenshot's paired proof from that same result bundle. Public provenance stores safe bundle names, device model/platform/OS, timestamps, clock fixtures, and hashes. It does not store pool UDIDs, custom pool host names, or private result paths. Simulator captures supply App Store composition input; separate physical hardware, TestFlight, and release checks retain their own contracts.

The selected six-slide story uses Garden growth, Journey rhythm/milestones, and private reflection. Non-shipping alternatives reuse only compatible Garden, Journey, and Journal captures. Obsolete guided-library and iCloud captures are excluded.

## Local capture and export

1. Freeze the app and capture-test inputs. Run `pnpm generate:capture-source-manifest`, include the manifest in a clean signed source commit, then rerun the generator and confirm it makes no change. Use that exact commit and manifest revision for every capture bundle. The app's processed build metadata and each XCTest proof bind to this source.

2. Run the two selected-state tests and two Garden-day tests on each simulator family through the installed simulator pool. Each invocation produces one result bundle with exactly two passing locale tests. The tests select `dusk-v1` or `day-v1` internally; capture time does not depend on the system clock.

   ```sh
   python3 scripts/verify_marketing_capture_project.py
   run_capture_bundle() {
     family="$1"
     english_test="$2"
     german_test="$3"
     "$IOS_TEST_POOL_COMMAND" run --device-family "$family" --job-timeout-seconds 1800 -- \
       xcodebuild -project ArriveWithin.xcodeproj -scheme ArriveWithinMarketingCaptures -configuration Debug \
       V2N_BUILD_SOURCE_COMMIT="$SOURCE_COMMIT" V2N_CAPTURE_SOURCE_REVISION="$SOURCE_REVISION" \
       "-only-testing:ArriveWithinMarketingCaptureUITests/ArriveWithinMarketingCaptureUITests/$english_test" \
       "-only-testing:ArriveWithinMarketingCaptureUITests/ArriveWithinMarketingCaptureUITests/$german_test" test
   }
   run_capture_bundle iPhone testCaptureAllRequiredMarketingStatesEnglish testCaptureAllRequiredMarketingStatesGerman
   run_capture_bundle iPhone testCaptureGardenDayEnglish testCaptureGardenDayGerman
   run_capture_bundle iPad testCaptureAllRequiredMarketingStatesEnglish testCaptureAllRequiredMarketingStatesGerman
   run_capture_bundle iPad testCaptureGardenDayEnglish testCaptureGardenDayGerman
   ```

   Set `IOS_TEST_POOL_COMMAND`, `SOURCE_COMMIT`, and `SOURCE_REVISION` from the local pool configuration and signed source manifest. Use the pool's result paths directly; do not boot/select a simulator manually, move result bundles into the checkout, or copy them to a different root for ingestion.

3. Ingest the four original pool bundles only after all four use the same signed source revision. Set `POOL_RESULTS_ROOT` to the installed pool results root. The ingester verifies that configured root against the approved pool location, and public provenance stores no input path or pool identity:

   ```sh
   ARRIVE_WITHIN_SIMULATOR_RESULTS_ROOT="$POOL_RESULTS_ROOT" pnpm ingest:current-captures -- \
     --iphone-selected-result "$POOL_RESULTS_ROOT/<iphone-selected-result>.xcresult" \
     --iphone-day-result "$POOL_RESULTS_ROOT/<iphone-day-result>.xcresult" \
     --ipad13-selected-result "$POOL_RESULTS_ROOT/<ipad13-selected-result>.xcresult" \
     --ipad13-day-result "$POOL_RESULTS_ROOT/<ipad13-day-result>.xcresult"
   ```

   The ingester reads all app-clock proof directly from each xcresult. There is no separate manual time-evidence file. It writes schema 6 source records and the original opaque RGB simulator screenshots; it does not produce final marketing canvases.

4. Validate the plan, simulator bundles, source evidence, and export contracts:

   ```sh
   pnpm validate:plan
   pnpm validate:captures
   pnpm test:capture-evidence
   pnpm test:simulator-capture-contract
   pnpm test:capture-set-provenance
   pnpm typecheck
   ```

5. Build through the developer-storage cache lease, start the studio with `pnpm start` on `127.0.0.1`, and run:

   ```sh
   pnpm export:candidate-matrix -- --url http://127.0.0.1:3000
   pnpm verify:reproducibility -- --url http://127.0.0.1:3000
   ```

6. Inspect every `_contact-sheet.jpg` and each slide-2 render. The final matrix validator checks the 24-image locale/device matrix, opaque RGB dimensions, pixel normalization, hashes, contact sheets, ZIP contents, and geometry. Human review must approve the exact refreshed matrix before any separately authorized upload.

Physical-device, TestFlight, App Review, and other final release checks remain separate. They do not supply or gate the four marketing simulator bundles.

## Narrative alternatives

The three source narratives are `garden-growth`, `daily-practice`, and `private-depth`. Preview one by adding `&narrative=<id>` to the localhost URL. Export one locale/device set with the generic command, for example:

```sh
pnpm export:narrative -- --narrative garden-growth --url 'http://127.0.0.1:3000/?device=iphone-6.9&locale=en-US&narrative=garden-growth' --width 1320 --height 2868 --locale en-US --device iphone-6.9 --theme forest-twilight --out exports/alternatives/garden-growth/en-US/iphone-6.9
```

Alternatives remain upload-ineligible source references and their generated human-review state starts as `pending`. The selected final six-slide plan is exported without a narrative query; never upload an alternatives directory.

Each set contains six zero-padded opaque PNGs, `_manifest.json`, `_validation.txt`, `_validation.json`, `_contact-sheet.jpg`, and a ZIP. The exporter canonicalizes screenshot RGB pixels, uses pinned Sharp 0.35.3 for contact sheets and metadata-free JPEGs, and blocks external network requests. Matrix manifests omit wall-clock generation time; ZIP member dates are fixed. The matrix validator checks every artifact and ZIP member by SHA-256 and preserves human visual review as a separate gate.
