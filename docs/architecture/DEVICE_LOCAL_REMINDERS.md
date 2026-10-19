# Device-local weekly reminder contract

Status: Implemented and locally verified; physical notification delivery remains external

## Product boundary

Arrive Within reminders are optional, calm, repeating local notifications. They require no account, server, push token, CloudKit record, analytics, or background network work. A schedule is a stable schema-v1 identifier plus weekday, local hour/minute, enabled state, and modification date. Times intentionally follow the device's current calendar and time zone.

The app never requests notification permission at launch. It first persists the user's schedule, then asks contextually when the user saves or enables a reminder. Denial keeps the schedule visible and editable, explains that delivery is unavailable, and offers the system Settings route. Returning to the foreground re-reads authorization and reconciles delivery.

## Authority and reconciliation

`WeeklyReminderScheduleRepository` is the source of product intent. The shipping implementation writes a file-protected, atomically replaced `weekly-reminders-v1.json`; it rejects unsupported schemas, invalid local times, duplicate identifiers, and duplicate weekday/time pairs. Notification Center is only the delivery projection.

Every launch and foreground transition computes the desired enabled identifiers, removes stale app-owned requests, and upserts each desired repeating request. Identifiers use the bounded `arrive-within.weekly-reminder.` prefix, so reconciliation never touches another app's notifications. Disabling or deleting removes delivery without inventing a successful notification claim. Complete data deletion removes both pending requests and the local schedule file; garden reset intentionally preserves reminder preferences.

## Local proof

- Domain tests cover validation, edit identity, and stable ordering.
- Persistence tests cover protected round-trip, duplicate rejection, and deletion.
- Hosted app tests prove save-before-permission, idempotent reconciliation, edit/delete, denied retention, and foreground recovery.
- Guarded rendered UI proves create, scheduled state, relaunch restoration/reconciliation, edit entry, and delete on an iPhone 17 Pro simulator running iOS 26.5.

Passing result bundles are `.build/xcode-tests-reminders/Logs/Test/Test-ArriveWithin-2026.08.09_20-11-34-+0800.xcresult` (9/9 hosted app tests) and `.build/xcode-tests-reminders-ui/Logs/Test/Test-ArriveWithin-2026.08.09_20-14-13-+0800.xcresult` (the named reminder UI test). Result bundles and raw screenshots remain ignored local evidence.

## Remaining closure

Simulator scheduling proves request construction and reconciliation, not actual delivery. Final closure requires an authorized exact-candidate physical iPhone and iPad run covering permission grant/denial, notification delivery, daylight-saving/time-zone change, edit/disable/delete, relaunch, foreground reconciliation, and VoiceOver/Dynamic Type. Those gates do not block other local work.
