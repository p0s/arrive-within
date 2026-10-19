# SCN-011 local weekly-reminder probe

Date: 2026-08-09
Status: Passed for deterministic and guarded simulator behavior; physical delivery remains external
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## Outcome

The bilingual native Reminders surface creates, edits, enables, disables, restores, and deletes weekly device-local schedules. Schedule intent is persisted before contextual permission is requested. Permission denial never discards user intent; a later foreground reconciliation can schedule it after authorization changes. Launch does not prompt. Reconciliation removes stale app-owned requests, upserts every enabled schedule, and leaves unrelated notifications untouched.

The shipping adapter uses repeating `UNCalendarNotificationTrigger` requests with weekday/hour/minute date components and localized calm copy. The product truth remains local: no push service, account, CloudKit record, tracking, or remote notification entitlement is involved.

## Reproducible evidence

| Check | Target | Result |
|---|---|---|
| `swift test --package-path Packages/ArriveWithinCore` | Host Swift package | 41 tests across 7 suites passed; 0 failed/skipped |
| Hosted ArriveWithin tests | iPhone 17 Pro simulator, iOS 26.5 | 9 passed; result bundle `Test-ArriveWithin-2026.08.09_20-11-34-+0800.xcresult` |
| Guarded `testWeeklyReminderCreatesPersistsReconcilesAndDeletesWithoutSystemPrompt` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed; result bundle `Test-ArriveWithin-2026.08.09_20-14-13-+0800.xcresult` |
| Generic iOS Simulator build | Current app/product modules | Succeeded in `.build/xcode-reminders` |
| EN/DE string parity | Current UI resources | 298/298 UI keys and 3/3 permission keys per locale; plist parsing passed |

## Retained failure history

The first rendered run reached the correct deleted state but queried `ContentUnavailableView` using the wrong XCTest element type. The assertion was corrected to the stable visible state rather than weakening product behavior; the passing rerun is the evidence above.

## Claim boundary

This report proves model, persistence, scheduling projection, denial recovery, relaunch restoration, and actual rendered interaction on one simulator. It does not prove that iOS displayed a notification at wall-clock time. Exact-candidate notification delivery, time-zone/DST behavior, physical VoiceOver/Dynamic Type, and iPhone/iPad notification presentation remain external hardware evidence gates.
