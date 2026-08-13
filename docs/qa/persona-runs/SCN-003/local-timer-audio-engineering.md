# SCN-003 local timer and audio engineering

Date: 2026-08-09
Status: Passed for the named local engineering boundary; whole scenario remains in progress
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## 2026-08-13 physical correction

The owner-observed build-9 run on a physical iPhone supersedes the earlier simulator-only bell claim: both shipped bell masters peaked around -41 dBFS and were not perceptibly audible, and the app aborted while scheduling the closing bell after the engine had stopped or rebuilt. The selected synthesis direction remains unchanged. The replacement masters add deterministic output gain with limiter headroom and are now fail-closed by a bundled peak/RMS validator:

- `opening-bell-v1.wav`: `bb1b61b3c8ae54c53b9a9c2cb5e8bd30a4892b6dc7003ed352b8c0e3746cfe42`
- `closing-bell-v1.wav`: `cb736817872448631b88f4769c4698cfa044e1f81cb9218d7a76fc58f37eab5b`

The old hashes below remain as historical evidence for the original local run. Replacement physical audibility and lifecycle proof stays pending until bound to the next exact candidate.

The replacement source was then exercised on the authorized physical iPhone with the real native audio controller. The first run reproduced an immediate opening-buffer abort and localized the missing invariant: player nodes had been connected without the loaded media's explicit format. After explicit per-layer connections, an accelerated three-minute flow allowed the four-second opening bell to finish and stop the engine, then crossed automatic completion through the rebuilt one-shot closing path. The exact focused UI test passed 1/1 with no crash. This is physical source-level lifecycle proof; human audibility and exact TestFlight-candidate proof remain pending.

## Outcome

The timer now persists validated settings and session configuration, uses monotonic active time across preparation/pause/resume, clamps a suspended timer's completion to its exact target instead of over-crediting wake time, and completes idempotently. The rendered first-use path still completes a real 180-second model transition, restores deterministic growth after relaunch, and preserves it through native fallback.

The app has a layered native audio path for opening/interval/closing bells, optional ambience, guided narration, other-audio policy, interruption/route/reset handling, and user-controlled resumption. Guided mode fails closed while approved narration is absent. A contextual opt-in local notification can signal a timer end when no continuous audio keeps the app active; it is cancelled and rescheduled around pauses using remaining active time and is not claimed as guaranteed delivery.

## Reproducible checks

| Check | Target | Result |
|---|---|---|
| `swift test --package-path Packages/ArriveWithinCore` | Host Swift package | 20 passed across 5 suites; 0 failed |
| Generic `xcodebuild ... -destination 'generic/platform=iOS Simulator' ... build` | Universal simulator app | Build succeeded |
| Guarded hosted unit target using one explicit destination | iPhone 17 Pro simulator, iOS 26.5 | 5 passed, 0 failed/skipped; raw destination and result-bundle paths retained only in private local evidence |
| Guarded `testThreeMinutePracticeGrowsRendererRestoresAndFallsBack` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed/skipped; raw destination and result-bundle paths retained only in private local evidence |
| `./scripts/generate_original_audio_assets.sh` repeated | Local deterministic FFmpeg generation | Identical manifest hashes for all three assets |

## Exact media boundary

- `opening-bell-v1.wav`: `b94002d4a8fcbe8b916def7caede307bf846a8d2a7cb729237bd4d866f6baf44`
- `closing-bell-v1.wav`: `f193545d6f5feff8bbea1da58c8cf2575cc45dde75a23cf779ce145e4b2a1f2b`
- `still-air-v1.m4a`: `bf4d184f989f98b915c299a103a58360a9d1e6c400e599884d9f1c5f404e65d0`

The owner approved these exact three hashes as the shipping sound direction on 2026-08-13. No sound-lab alternative was promoted or bundled.

The iOS Simulator verifies those exact bundled files and hashes but intentionally does not start `AVAudioEngine`. The installed iOS 26.5 simulator runtime aborts while negotiating remote I/O, and simulator output could not prove physical playback anyway. Device-target code compiles, but listening quality, route/lock/interruption behavior, notification delivery, and energy remain exact-candidate physical gates.

No narration track is approved or counted complete. Voice rights, owner selection, English/German fluent listening, transcript alignment, and final package size remain separate gates.
