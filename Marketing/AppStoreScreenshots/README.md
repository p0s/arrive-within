# Arrive Within App Store screenshot studio

This tracked, localhost-only Next.js studio composes the frozen six-slide narrative and three complete owner-selection alternatives from actual deterministic Arrive Within UI captures. It does not contain a mock application surface.

## Product sets

- `en-US` and `de-DE`
- iPhone 6.9-inch portrait at `1320×2868`
- iPad 13-inch portrait at the required `2064×2752` size for apps that run on iPad
- six slides per locale/device, 24 final PNGs total
- exactly one localized headline block per slide; no product-name eyebrow, subtitle, or supporting-copy layer
- Clean Editorial / Tonal Wash treatment: short left-aligned headlines, large straight device frames, and restrained app-palette gradient washes with a continuous light falloff
- machine-enforced composition on every rendered slide: one tight `data-headline`, one tight `data-product-proof`, a 4–7% canvas-height gap, proof at least 60% of canvas height, and proof lower edge at 94–104%
- the product screenshot begins close beneath the headline so the app remains the dominant proof surface
- the selected six-slide story opens with the validated light-mode Journey calendar, moves through Garden growth, then introduces the Garden hero on slide 3; the other complete narratives remain non-shipping source references
- one freshly captured 24-image candidate matrix; human review and explicit release authorization are separate gates

## Capture boundary

`screenshot-plan.json` defines the six selected Garden/growth product states for all four locale/device sets. Slide 2 pairs a seed Garden captured in dark appearance at real local dusk/night with a mature Garden captured in light appearance during the real local Day phase. Swift derives Garden phase from the unmodified local clock: dusk is 17:00–19:59, night 20:00–04:59, and day 08:00–16:59 SGT. The iPhone selected-state and Garden-day tests run in separate simulator result bundles; the 13-inch iPad set is captured by signed app fixtures on physical hardware. The dark-appearance `garden-hero` remains in use on slides 3 and 6. Slide 1 deliberately uses the light-mode Journey calendar capture. Every capture is bound to its source manifest, device, visible status time, local date, Garden phase, and appearance. The export refuses missing, transparent, wrong-size, unbound, wrong-phase, or hash-mismatched captures. The two non-shipping alternatives reuse only retained Garden, Journey, and Journal captures whose pixels remain truthful for the zero-narration, local-only V1; obsolete guided-library and iCloud captures are excluded. Simulator captures prove only the marketing composition input; they do not substitute for physical-device or release-candidate evidence.

The iPhone selected-state bundle runs `testCaptureAllRequiredMarketingStatesEnglish` and `testCaptureAllRequiredMarketingStatesGerman` at a real local dusk/night time. Its Garden seed and dark Garden hero must show a status-bar time in 17:00–04:59 SGT. The separate iPhone Garden-day bundle runs `testCaptureGardenDayEnglish` and `testCaptureGardenDayGerman` between local 08:00 and 16:59; those tests assert the window and launch without `-ui-test-wall-clock-epoch`. Record the visible status time and local date for every capture. Physical iPad fixtures capture all 12 iPad source states in the same actual clock windows and at the required 2064×2752 resolution. The iPad fixture reports, signed build receipt, runner output, and original screenshot hashes are joined in a separate physical evidence manifest.

The previous 24-image matrix used an 11-inch iPad output and is superseded. The current candidate requires fresh iPhone simulator and physical 13-inch iPad source captures bound to app version 1.0.2 (build 19). Human visual review remains pending until the exact refreshed matrix is inspected; local asset exports do not update App Store Connect.

The previous simulator source revision recorded `Invalid frame dimension (negative or non-finite).` warnings in its selected-state tests. The new current-source bundles retain any runtime warnings by exact test identifier; Garden-day tests must pass without a wall-clock override. See `source-captures.json` and `physical-capture-evidence-v1.json` for simulator and physical-device provenance.

## Local export

1. Freeze every app and capture-fixture input, run `pnpm generate:capture-source-manifest`, and include the generated manifest in the clean, signed source commit. The manifest does not hash itself. After signing, rerun the generator and confirm it makes no change; use that commit and the manifest's exact source revision and SHA for every capture run. The physical build requires the whole checkout to be clean, so the manifest must be committed before device capture. The app's processed Info.plist receives the commit and source revision as build settings; each XCTest screenshot has a paired JSON attachment read back from the same result bundle. Ingestion compares those immutable values to the current signed source before copying any pixels.

2. During 17:00–04:59 SGT, run the English and German selected-state tests as one serial iPhone simulator-pool job. During 08:00–16:59 SGT, run both Garden-day tests as a separate job. The pool chooses its own iPhone destination, creates the result bundle, and returns its path; do not pass a simulator override or manually boot a device.

   ```sh
   python3 scripts/verify_marketing_capture_project.py
   "$IOS_TEST_POOL_COMMAND" run --device-family iPhone --job-timeout-seconds 1800 -- \
     xcodebuild -project ArriveWithin.xcodeproj -scheme ArriveWithinMarketingCaptures -configuration Debug \
     V2N_BUILD_SOURCE_COMMIT="$SOURCE_COMMIT" V2N_CAPTURE_SOURCE_REVISION="$SOURCE_REVISION" \
     -only-testing:ArriveWithinMarketingCaptureUITests/ArriveWithinMarketingCaptureUITests/testCaptureAllRequiredMarketingStatesEnglish \
     -only-testing:ArriveWithinMarketingCaptureUITests/ArriveWithinMarketingCaptureUITests/testCaptureAllRequiredMarketingStatesGerman test
   python3 scripts/verify_marketing_capture_project.py
   "$IOS_TEST_POOL_COMMAND" run --device-family iPhone --job-timeout-seconds 1800 -- \
     xcodebuild -project ArriveWithin.xcodeproj -scheme ArriveWithinMarketingCaptures -configuration Debug \
     V2N_BUILD_SOURCE_COMMIT="$SOURCE_COMMIT" V2N_CAPTURE_SOURCE_REVISION="$SOURCE_REVISION" \
     -only-testing:ArriveWithinMarketingCaptureUITests/ArriveWithinMarketingCaptureUITests/testCaptureGardenDayEnglish \
     -only-testing:ArriveWithinMarketingCaptureUITests/ArriveWithinMarketingCaptureUITests/testCaptureGardenDayGerman test
   ```

   Before these commands, set `IOS_TEST_POOL_COMMAND` to the locally configured simulator-pool executable, `CAPTURE_RESULTS_DIR` to a private temporary directory, `SOURCE_COMMIT` to the signed source commit, and `SOURCE_REVISION` to the revision in the generated manifest. Each selected bundle must contain exactly two passing tests, ten PNG attachments, and ten source-proof attachments; the day bundle must contain two passing tests, two PNG attachments, and two source-proof attachments. Keep result bundles outside the repository.

3. Prepare a private local JSON evidence file using this shape. Record the same current source binding for the selected/day bundle and each attached capture's exact visible status time and local date. The parser accepts only iPhone simulator evidence here; it rejects any source binding that differs from the current app manifest and derives phase from visible time. Keep this file and both result bundles outside the repository. Do not ingest the iPhone bundles yet: the physical build and captures must use the same clean signed source commit.

   ```json
   {
     "source_bindings": {
       "iphone-6.9": {
         "selected": { "source_revision": "<sha256>", "source_manifest_path": "capture-source-manifest-v1.0.2-build-19.json", "source_manifest_sha256": "<sha256>" },
         "garden-day": { "source_revision": "<sha256>", "source_manifest_path": "capture-source-manifest-v1.0.2-build-19.json", "source_manifest_sha256": "<sha256>" }
       }
     },
     "captures": {
       "iphone-6.9": {
         "en-US": {
           "garden-hero": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" },
           "garden-day": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" },
           "garden-seed": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" },
           "journey-calendar": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" },
           "journey-milestones": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" },
           "journal": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" }
         },
         "de-DE": {
           "garden-hero": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" },
           "garden-day": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" },
           "garden-seed": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" },
           "journey-calendar": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" },
           "journey-milestones": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" },
           "journal": { "capture_local_date": "YYYY-MM-DD", "visible_status_time": "HH:MM", "timezone": "Asia/Singapore" }
         }
       }
     }
   }
   ```

   `captures` must include all six capture IDs for both locales.

4. Without editing or ingesting anything in the checkout, capture the 13-inch iPad states against the same signed source commit. The physical build adapter verifies the generated project from `project.yml` with pinned XcodeGen 2.46.0 before compiling. Because the shared verifier requires an exact build-receipt schema, the project digest is written to a separate hash-bound sidecar beside the receipt in the private run directory. The verifier records the sidecar path and hash in its build-adapter step; the ingester checks the source, manifest, receipt, and current generated-project digests before publishing their hashes in the physical evidence manifest. Configure `DEVELOPER_STORAGE_CACHE_COMMAND` in the local environment, then run the night and day fixture groups in their actual SGT windows. The verifier uses the app-owned build adapter, report validators, and profile; it signs no artifact and stores raw reports/screenshots in the host temporary directory. Complete both device capture windows before either ingester writes to the repository.

   ```sh
   ./scripts/verify --strict --lane physical --scenario SCN-019 --output "$CAPTURE_RESULTS_DIR/scn-019.json"
   ./scripts/verify --strict --lane physical --scenario SCN-020 --output "$CAPTURE_RESULTS_DIR/scn-020.json"
   ```

   Each run must report a clean signed source and every required check passed. The physical ingester replaces the stale iPad placeholders only after validating all 12 physical screenshots, fixture reports, source bindings, receipt hashes, phases, appearance, and dimensions.

5. Once both device capture windows are complete, ingest the iPhone bundles first so the schema-4 phone provenance exists for the physical importer. Then ingest the physical evidence. The latter changes only screenshot and evidence files; it does not alter the signed capture inputs, so the signed source-commit binding remains verifiable.

   ```sh
   ARRIVE_WITHIN_SIMULATOR_RESULTS_ROOT="$CAPTURE_RESULTS_DIR" pnpm ingest:current-captures -- --iphone-selected-result "$CAPTURE_RESULTS_DIR/<iphone-dusk.xcresult>" --iphone-day-result "$CAPTURE_RESULTS_DIR/<iphone-day.xcresult>" --capture-evidence-json <local-evidence.json>
   pnpm ingest:physical-captures -- --night-result "$CAPTURE_RESULTS_DIR/scn-019.json" --day-result "$CAPTURE_RESULTS_DIR/scn-020.json"
   ```

6. Run `pnpm validate:plan`, `pnpm validate:captures`, `pnpm test:capture-evidence`, `pnpm test:capture-set-provenance`, `pnpm test:physical-capture-contract`, `pnpm test:drift-policy`, and `pnpm typecheck`.
7. Build through the developer-storage cache lease, then start the studio with `pnpm start`; it binds only to `127.0.0.1`.
8. Run `pnpm export:candidate-matrix -- --url http://127.0.0.1:3000`, followed by `pnpm verify:reproducibility -- --url http://127.0.0.1:3000`. The reproducibility script requires Node v26.7.0 and performs two full candidate exports.
9. Inspect every `_contact-sheet.jpg` and each slide-2 render. Human visual review and upload authorization remain separate gates.
10. After accepting the exact new images, run `node scripts/sync-website-ui.mjs`; the website validator rejects any source/copy/provenance drift.

## Narrative alternatives

The three source narratives are `garden-growth`, `daily-practice`, and `private-depth`. Preview one by adding `&narrative=<id>` to the localhost URL. Export one locale/device set with the generic command, for example:

```sh
pnpm export:narrative -- --narrative garden-growth --url 'http://127.0.0.1:3000/?device=iphone-6.9&locale=en-US&narrative=garden-growth' --width 1320 --height 2868 --locale en-US --device iphone-6.9 --theme forest-twilight --out exports/alternatives/garden-growth/en-US/iphone-6.9
```

The alternatives directories remain upload-ineligible source references and their generated human-review state starts as `pending`. The selected final six-slide plan is exported without a narrative query after recapture from the exact final source; never upload an alternatives directory.

Each set contains six zero-padded opaque PNGs, `_manifest.json`, `_validation.txt`, `_validation.json`, `_contact-sheet.jpg`, and a ZIP. To eliminate nondeterministic one-bit compositor rounding, the exporter decodes each screenshot, clears only the least-significant bit of every RGB channel, and emits a canonical Paeth-filtered PNG. Pinned Sharp 0.35.3 builds each contact sheet directly from the six final PNGs in numbered order and creates a metadata-free JPEG, avoiding browser text/compositor variance. The matrix validator proves that PNG normalization is byte-idempotent, writes deterministic `_matrix-manifest.json` and `_matrix-validation.*` summaries under `exports/`, checks every artifact and ZIP member by SHA-256, and preserves human visual review as a separate gate. Generated manifests intentionally omit wall-clock time so identical sources yield byte-identical metadata and ZIPs. The exporter blocks external network requests and records source-capture provenance and hashes.
