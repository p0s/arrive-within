# SCN-004 local stopwatch

Date: 2026-08-09
Status: Passed for the named local simulator boundary; final-tree, bilingual, iPad, assistive-technology, and physical closure remain
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## Outcome

Stopwatch is an open-ended meditation mode: it has no target duration and never auto-finishes. Monotonic active time excludes pauses, qualification begins exactly at three active minutes, and explicit finish inserts exactly one immutable qualifying event. A terminated session restores through a bounded wall-clock assessment; the user explicitly accepts the conservative or maximum plausible value before resuming or finishing. Backward wall-clock movement cannot produce an event whose end precedes its start.

The guarded rendered flow selects Stopwatch, crosses qualification under the test clock, pauses, terminates the app, relaunches, restores the qualified paused state, explicitly finishes, and observes garden growth. Mode, elapsed time, pause/resume, recovery, and finish controls expose localized labels/values and stable identifiers. A kept private screenshot was visually inspected after the garden backdrop and inherited accent became color-scheme aware; the dark-mode qualification message and both recovery controls are legible. Raw screenshots and result bundles remain ignored.

## Reproducible checks

| Check | Target | Result |
|---|---|---|
| `swift test --package-path Packages/ArriveWithinCore` | Host Swift package | 43 passed across 7 suites; 0 failed/skipped |
| Guarded hosted app unit suite | iPhone 17 Pro simulator, iOS 26.5 | 11 passed, 0 failed/skipped; result bundle `Test-ArriveWithin-2026.08.09_20-48-34-+0800.xcresult` |
| Guarded `testStopwatchQualifiesPersistsPausedStateAndFinishesAfterRelaunch` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed/skipped; result bundle `Test-ArriveWithin-2026.08.09_20-59-53-+0800.xcresult` |
| Localization parity and plist parse | EN/DE resources | 299 UI keys and 3 permission keys per locale; all parse |

## Claim boundary

This proves deterministic model truth, hosted integration, and one real rendered iPhone-simulator recovery path. It does not prove final-tree regression closure, German layout, Dynamic Type, VoiceOver, iPad adaptation, physical lock/interruption/route behavior, notification delivery, or signed-candidate behavior. Those remain separately named gates; none is substituted by simulator evidence.
