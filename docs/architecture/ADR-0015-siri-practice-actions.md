# ADR 0015: Offer three practice actions to Siri and Shortcuts

Status: accepted by the owner on 2026-11-04; source implemented; hosted adapter tests and Release and beta-SDK metadata checks pass locally; iOS 27 system tests and physical evidence pending

## Context

People often begin or pause a meditation without looking at the screen: eyes closed, the phone across the room, or one press of the Action button. iOS can run app actions from Siri, Shortcuts, Spotlight, and the Action button through App Intents. Arrive Within already owns one persisted session state machine and one completion pipeline, and ADR-0007 projects a running practice into a read-only Live Activity.

A system action must not become a second timer, a second way to complete a practice, or a voice path to private reflections and history. Ending a practice early is a deliberate in-app choice because it affects history and growth. A process that the system launches only to run an action must not load a practice that ended with the process and continue it as if nothing happened.

The iOS 27.3 beta SDK adds a marker protocol that lets Siri AI call app intents as tools. Apple has not yet released that SDK, so default builds must not depend on it.

## Decision

The main app target, and no extension, offers exactly three App Intents:

| Action | Type | Behavior |
| --- | --- | --- |
| Start Silent Practice | `StartSilentPracticeIntent` | Optional length of 1–180 minutes. A length starts the timer with the remembered timer settings and does not change the saved settings. No length starts an open-ended stopwatch. Practices under three minutes start as in the app, and the reply says that they do not grow the garden. |
| Start Guided Practice | `StartGuidedPracticeIntent` | One of the 42 bundled practices, chosen through an enumerable entity whose title, purpose, and length are public catalog text. Narration is English or German and defaults to the app language. When the selected narration is not packaged, the action fails with a recovery hint instead of starting something else. |
| Pause or Resume Practice | `SetPracticePausedIntent` | Pauses or resumes the practice that is already running in the app process. Repeating a request changes nothing and reports the current state. "Stop" maps to pause; finishing stays in the app. |

- Both start actions open the app, wait for the app to finish loading its saved state, and then call the same model entry points as the Meditate tab. The model's existing one-session guard is the only duplicate guard. When any practice exists (preparing, running, paused, finishing, or waiting for the restart recovery choice), nothing new starts and the reply reports the current state. A first-ever start creates the local profile exactly as the first-use button does.
- Pause and resume run without opening the app and are limited to the main app process on iOS 27. They act only on a practice already loaded in that process. A process launched only for the action reports that no practice is in progress; it never loads, recovers, resumes, or completes a saved session. A practice that waits for the recovery choice, or is still in its preparation countdown, is reported and left unchanged.
- Results contain only the practice mode, its state, and its planned length. Replies say only what actually happened. No action finishes, completes, or abandons a practice, makes the recovery choice, or exposes history, statistics, streaks, the garden, the journey, reflections, favorites, reminders, the purchase, or data export, restore, reset, or deletion.
- No new entitlement, permission, network access, analytics, background mode, or stored data is added.
- App Shortcut phrases ship in English and German for classic Siri, Spotlight, Shortcuts, and the Action button. The documentation makes no claim about German support in Siri AI.
- A separate `SiriPreview` build configuration, built only with a beta SDK, adds `ToolIntent` conformance (iOS 27.3) to exactly these three actions. The conformance file is excluded from Debug and Release and also sits behind the explicit `ARRIVE_WITHIN_SIRI_TOOLS_PREVIEW` compilation condition. Default builds therefore contain zero tools and zero compiled skills, need only the release SDK, and offer no runtime switch. This slice adds no skill bundle: the entity's purpose and length plus the parameter descriptions carry the mapping from a request such as "something for sleep" to a practice. A separate `ArriveWithinSiriPreview` scheme builds this configuration together with `ArriveWithinSiriEvaluations`, an iOS 27.3 test bundle of Siri AI scenarios that sits behind the same condition. The scenarios expect the right action for each request and no action for a request about reflections. The default scheme never builds them.
- The Xcode pin moves to 27.2 (Swift 6.4.2), because the iOS 27 execution-target API and the AppIntentsTesting framework need the iOS 27 SDK. The deployment target stays iOS 18.0.

## Verification

- Hosted adapter tests cover the one-session guard and repeated requests, a remembered configuration that stays unchanged, invalid lengths, a first-ever start, a busy data action, unknown and unpackaged guided practices, pause accounting, idempotent pause and resume, a practice that waits for recovery, a saved session that a cold process must not touch, a profile that a start before loading must not replace, and an unchanged practice ledger.
- System tests use AppIntentsTesting in a UI-test bundle on iOS 27 simulators through the shared serialized pool. Each test launches the app in an isolated DEBUG namespace. A DEBUG-only, hidden, read-only inspection intent reads the session identifier, timing, guided identity, and ledger count; Release builds do not compile it.
- Negative control: removing the `activeSession == nil` condition from the model's start guard must make the duplicate-start tests fail.
- The beta preview build is checked with Apple's Siri metadata analyzer in English and German. It must list exactly the three actions above and no other tool. The 27.2 Release build of the same tree must list none.
- The Siri AI scenario evaluations must compile for a generic iOS device with the beta SDK. They are not run until Siri AI on iOS 27.3 hardware is available.
- `scripts/validate_siri_boundary.mjs` statically rejects a fourth shipping action, a tool conformance outside the preview file or configuration, a finishing or private-data entry point in the Siri sources, extra result fields, an inspection intent outside DEBUG, and beta evaluations in the default scheme.

## Consequences

Voice and shortcut users can begin and steer a practice hands-free without a second timer or completion path. Finishing, reflection, and data management stay deliberate in-app actions. Physical evidence remains separate and pending: a Siri start on a locked iPhone with real audio, a pause while the Live Activity runs, Siri's own audio interruption (guided narration pauses while timer time continues), German app language with English Siri, and Siri AI tool calls on iOS 27.3 hardware.
