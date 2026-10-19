# ADR-0012: Use source-bound simulator fixtures for marketing captures

## Status

Accepted.

## Context

The App Store screenshot matrix needs both dusk and day Garden states on iPhone and 13-inch iPad. Waiting for real local clock windows couples image production to time of day and does not improve proof that the app renders each Garden phase correctly. Marketing screenshots also need to remain distinct from physical-device and TestFlight release evidence.

## Decision

Marketing source images come from four source-bound XCUITest simulator result bundles: selected/dusk and Garden-day/day on iPhone 17 Pro and iPad Pro 13-inch (M5), iOS 26.5. Each bundle must contain the English and German test for its capture role.

The app reads shared DEBUG-only clock fixtures independently of the simulator's system clock:

| ID | UTC instant | Timezone | Garden local time | Phase |
|---|---|---|---|---|
| `day-v1` | `2026-08-01T01:41:00Z` | `Asia/Singapore` | `2026-08-01 09:41` | day |
| `dusk-v1` | `2026-08-01T09:41:00Z` | `Asia/Singapore` | `2026-08-01 17:41` | dusk |

The day fixture is used for `garden-day`. The dusk fixture is used for every selected-state capture, including Journey and Journal. Fixture IDs, epochs, local times, timezone, and Garden phase are validated against the shared fixture resource. The simulator's visible status bar is captured as rendered with no status-bar override. Proof records the fixture, actual XCTest `captured_at`, and observed system timezone as distinct clock facts.

Schema 6 binds every screenshot to its signed source commit, capture-source manifest, simulator product model/platform/OS, xcresult tree hash, passing test identity, attachment, and per-capture proof. Public provenance omits simulator UDIDs, custom pool device names, and private result paths. The selected App Store exports remain 24 opaque RGB images across English/German iPhone/iPad sets; slide 2 places the dark `garden-seed` behind the light `garden-day` capture.

Physical-device hardware, TestFlight, and release checks remain under their own evidence contracts. Simulator marketing captures do not satisfy or replace those checks, and physical evidence does not supply the marketing screenshots.

## Consequences

- Screenshot capture has no real-time day/dusk wait.
- The fixture proves deterministic Garden phase projection for the captured app build; it does not assert that the simulator's visible system clock shows the Garden fixture time.
- Build and screenshot proof stay tied to one signed app source revision, while a later signed evidence-only commit can retain that source as an ancestor.
- Hardware and TestFlight release evidence remains independently required where its contract applies.
