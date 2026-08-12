# SCN-007 local Journey, statistics, customization, and calendar-edge probe

Date: 2026-08-10
Status: Passed for deterministic projection and guarded rendered iPhone/iPad flows; physical and exact-candidate closure remain
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## Outcome

The Journey presents permanent progress, a named next transformation, current and best streaks, practice days, all sessions, total/average/median active time, and guided/timer/stopwatch counts. It shows the three most recent sessions and a complete newest-first history with date, mode, active duration, and qualifying-growth truth. It lists all 15 transformations with deterministic completion dates. Every unlocked milestone exposes only its two authored variants; changing Earth I to Root fan persists across termination and relaunch without changing progress.

Stored practice-day identity remains truthful across local midnight, the 23-hour Los Angeles spring DST day, the 25-hour fall DST day, and travel to Tokyo. The rendered iPad fixture shows three qualifying days/sessions, best streak 3, current streak 0 for intentionally historical data, Earth I completed Mar 8, 2026, and all three heterogeneous history rows.

## Reproducible checks

| Check | Target | Result |
|---|---|---|
| `swift test --package-path Packages/ArriveWithinCore` | Host Swift package | 44 passed across 7 suites; 0 failed/skipped, including stored midnight, travel, spring/fall DST, JSON round-trip, and exact milestone boundaries |
| `testJourneyExplainsStatisticsAndPersistsAChangeableVariant` | iPhone 17 Pro simulator, iOS 26.5 | Full history, Stopwatch row, complete milestones, variant change, termination, and relaunch passed; result bundle `Test-ArriveWithin-2026.08.09_19-00-50-+0800.xcresult` |
| `testTravelMidnightAndDSTJourneyRemainsTruthfulWhenRendered` | iPad Pro 13-inch (M5) simulator, iOS 26.5, exact destination retained privately | 1 passed, 0 failed/skipped; raw result-bundle path retained only in private local evidence |
| Original-resolution attachment review | Same iPad run | Regular-width composition, day/streak/session values, milestone date, and Guided/Timer/Stopwatch history were legible and unclipped; no placeholder/scaffold UI was present |

All current XCTest invocations used `scripts/run_guarded_xcode_tests.sh`, one destination, one invocation, one worker, and no parallel testing. Unexpected skips: none.

## Retained failure and repair history

The first iPad calendar-edge run failed after opening full history because the test searched only `otherElements`; the stable accessibility identifiers were correctly attached to heterogeneous descendants. The query was corrected to `descendants(matching: .any)` without weakening the required identifiers or count. The unchanged seeded product flow then passed. Raw failed and passing result-bundle paths remain only in private local evidence.

## Claim boundary

This evidence proves deterministic stored-day projection and actual rendered simulator behavior. It does not prove real travel/system-time changes, official CloudKit reconciliation, physical-device accessibility/performance, or signed-candidate behavior. Those remain distinct external or authorization-gated checks.
