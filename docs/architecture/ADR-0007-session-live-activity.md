# ADR 0007: Project active practice into one local Live Activity

Status: accepted by the owner on 2026-08-26; local implementation complete, physical presentation pending

## Context

Arrive Within already owns one persisted meditation-session state machine. The Lock Screen and Dynamic Island can make a running practice easier to follow, but a Live Activity must not become a second timer, a background-execution workaround, or a control that can accidentally finish a session.

## Decision

- The iPhone app starts one local ActivityKit activity only after the prepared session is durably running.
- The activity receives a read-only snapshot containing the session identifier, localized mode/status/label, confirmed active time, optional target duration, and the wall-clock running origin.
- SwiftUI timer intervals animate the presentation between app updates. Persisted session state remains authoritative for pause, resume, recovery, completion, and growth.
- Pause and resume publish phase snapshots. Completion, abandonment, data deletion, or the absence of an active session ends stale app-owned activities.
- Relaunch recovery replaces an uncertain running presentation with the last confirmed paused duration until the user chooses the maximum plausible or last confirmed recovery value.
- The extension targets iPhone only and exposes no buttons, push token, remote update path, network work, analytics, or separate storage.

## Consequences

Supported iPhones gain a calm Lock Screen and Dynamic Island view without weakening monotonic session truth or privacy. Unsupported/disabled Live Activities fail silently and never block a practice. Local lifecycle tests and an unsigned build can prove state wiring and packaging; exact Lock Screen/Dynamic Island layout, system settings, lifecycle, and energy behavior still require an authorized physical iPhone candidate.
