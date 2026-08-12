# SCN-008 local private Journal probe

Date: 2026-08-09
Status: Passed for local deterministic/adapted persistence and guarded iPhone-simulator flows; physical recording/transcription and CloudKit attachment proof remain separate
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## Outcome

The Journal stores generation-scoped, schema-versioned entries with platform file protection and atomic writes. Revision-checked edits reject stale writers instead of silently overwriting. Active entries require text or a real bounded audio attachment; tombstone deletion removes text, transcript, and attachment metadata. Search is entirely local across text, on-device transcript, and locally formatted date.

People can skip reflection, start one from the Journal, or create one linked to a completed practice. Text survives relaunch, editing, search, and a denied/unavailable recorder. Voice-only entries use a safe relative file identity, 24 kHz mono AAC at 64 kbps, a ten-minute cap, explicit microphone permission, and orphan cleanup. Transcription is a separate explicit action, requires Apple's on-device recognizer, and never sends journal content to a custom service. Save is blocked while transcription is in flight.

A deterministic per-entry ZIP contains user-readable Markdown, canonical JSON, a manifest, and optional hash-verified audio. Host verification opens the archive with the platform `unzip -t` reader. Export remains user initiated; the rendered share-sheet path and complete all-data export belong to later data-control coverage.

## Reproducible checks

| Check | Target | Result |
|---|---|---|
| `swift test --package-path Packages/ArriveWithinCore` | Host Swift package | 32 passed across 6 suites; 0 failed/skipped, including path/duration bounds, active-entry invariants, text/transcript/date search, revision conflict, private tombstone, and valid ZIP export |
| Guarded hosted app unit target | iPhone 17 Pro simulator, iOS 26.5 | 7 passed; fake recorder/transcriber proves a voice-only reflection and explicit transcript without network or physical-audio claims |
| `testPrivateTextReflectionSearchEditRelaunchAndDelete` | Guarded iPhone 17 Pro simulator, iOS 26.5 | Create, termination/relaunch, edit, local search, rendered inspection, delete, and empty restoration passed; result bundle `Test-ArriveWithin-2026.08.09_18-53-53-+0800.xcresult` |
| `testCompletedPracticeOffersAnOptionalLinkedReflection` | Guarded iPhone 17 Pro simulator, iOS 26.5 | Optional linked reflection and relaunch restoration passed |
| `testDeniedVoiceRecordingNeverLosesAnInProgressTextReflection` | Guarded iPhone 17 Pro simulator, iOS 26.5 | Unavailable recorder message, unchanged draft text, and subsequent save passed; result bundle `Test-ArriveWithin-2026.08.09_18-51-10-+0800.xcresult` |
| `plutil -lint` plus exact key comparison | App plist/privacy/EN-DE strings | Six files parse; 213 UI keys and 3 permission keys have exact EN/DE parity |

## Claim boundary

Simulator adapters prove state transitions and failure retention, not microphone sound, AAC perceptual quality, interruption recovery, route/lock behavior, speech-recognition accuracy, or permission behavior on hardware. Those require the exact signed candidate on authorized physical iPhone and iPad. Attachment synchronization, merge behavior, quota exhaustion without local loss, and cloud deletion remain part of SCN-009/010 and require an official CloudKit container for final fidelity. No journal content was transmitted, analyzed, scored, or used for recommendations.
