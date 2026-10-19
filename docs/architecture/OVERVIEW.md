# Architecture

Arrive Within keeps product truth in native Swift. The Three.js garden is a bounded, replaceable projection of deterministic state; it cannot create practice credit or own data.

## Product layers

| Layer | Location | Responsibility |
|---|---|---|
| Native shell | `Apps/ArriveWithin/Sources` | SwiftUI navigation, practice UI, audio, journal recording/transcription, reminders, accessibility, renderer hosting |
| Domain | `Packages/ArriveWithinCore/Sources/ArriveWithinDomain` | Immutable practice events, milestones, deterministic progression, journey/statistics projections |
| Meditation | `Packages/ArriveWithinCore/Sources/ArriveWithinMeditation` | Persisted session state machine, monotonic timing, qualification, exact-once completion |
| Persistence | `Packages/ArriveWithinCore/Sources/ArriveWithinPersistence` | Protected local state, Core Data product model, short-lived export staging, reset/delete, and a deferred private-CloudKit adapter |
| Content | `Packages/ArriveWithinCore/Sources/ArriveWithinContent` and `Content/guided` | Typed 42-practice bilingual catalogue and packaged-media contract |
| Bridge | `Packages/ArriveWithinCore/Sources/ArriveWithinGardenBridge` and `Shared` | Versioned `GardenState` encoding, validation, description, shared fixtures |
| Renderer | `Renderer` | Deterministic world projection, quality tiers, lifecycle/context recovery, diagnostics |
| Evidence tooling | `Marketing`, `Website`, `scripts`, `docs/qa` | Reproducible public media, screenshots, static site, validation and claim boundaries |

## Completion and growth

1. A practice starts as a persisted session with wall-clock and monotonic anchors.
2. Active elapsed time excludes pauses and is clamped during recovery.
3. Finish callbacks enter one idempotent completion coordinator.
4. A qualifying completion writes exactly one immutable `PracticeEvent`, keyed independently from UI callbacks.
5. `ProgressionReducer` sorts and reduces accepted events into a deterministic `GardenState`.
6. The native app encodes the versioned bridge message; TypeScript validates every field before rendering.
7. Relaunch, duplicate delivery, changed device order, renderer recreation, and native fallback all project the same accepted ledger.

A session under three active minutes may appear in history but does not advance the garden, journey, or streak. Session duration affects bounded micro-growth, capped at 60 active minutes; milestones and unlocked variants never decay.

## Storage and deferred private CloudKit

One versioned Core Data model backs the shipping local store and a future private-CloudKit adapter. Version 1.0 always opens the protected local persistent-store description with no CloudKit options, contains no container identifier, and requests no CloudKit signing entitlement. Reactivation is fail closed until operation-specific deletion confirmation and stale-device anti-resurrection pass an exact two-device matrix.

The domain remains Codable and independent of Core Data. Practice-event identity is immutable and idempotent. Journal edits carry revisions; competing replicas are preserved for explicit resolution rather than silently overwritten. Favorites use tombstones. Reset creates a new profile-generation identifier, immediately excluding late records from an old offline generation. Voice attachments are checksum verified and use protected local storage/external binary storage where appropriate.

Public source contains no team ID, profile, production entitlement, official container identifier, schema credential, or server secret. The previously deployed schema proves only schema availability, not a shipping sync path.

## Renderer boundary

`GardenWebView` loads only the bundled renderer. Navigation and external requests are rejected, the content security policy is restrictive, script-message handlers are removed on teardown, and bridge input is size/schema/range bounded. The renderer reports diagnostics but never modifies source-of-truth data.

The world has low, balanced, and high quality tiers. Sustained pressure lowers background density before central-tree quality; sustained headroom raises it. Rendering pauses in the background, handles actual WebGL context loss/restoration, disposes resources, and can be retried. A fully native garden description and visual fallback remain usable when WebKit/WebGL cannot render.

See `docs/architecture/RENDERER_RESILIENCE.md` and `Shared/GardenState.schema.json` for the executable boundary.

## Audio and lifecycle

Native `AVAudioSession`/`AVAudioEngine` orchestration owns bells, ambience, guided narration, interruptions, route changes, background continuation, and safe resumption. Session truth is persisted separately from audio-engine state, so audio failure cannot invent or duplicate completion. Shipping narration fails closed when a validated local asset is absent; system speech is not a narration fallback.

Physical lock, interruption, Bluetooth/route, phone-call, notification, and exact-candidate tests remain separate from deterministic simulator/unit evidence.

## Privacy and security boundaries

- no product account, ads, analytics, tracking, attribution SDK, custom backend, or runtime AI; StoreKit is limited to one verified non-consumable entitlement for optional Garden presentation styles;
- journal text/audio and guided history are never sent to a project server;
- on-device journal transcription only;
- renderer messages and exported diagnostics are bounded and redacted;
- destructive actions are explicit and cannot run during an active session;
- local-only behavior remains complete when microphone, speech recognition, notifications, or the renderer are unavailable.

`Apps/ArriveWithin/Resources/PrivacyInfo.xcprivacy` and `docs/release/app-privacy-worksheet.json` are the source-level privacy contract. The published bilingual policy is at `https://psapps.xyz/arrive-within/#privacy`; exact archive and live App Store answers remain separately evidenced.

## Testing ladder

- Swift package tests cover domain, persistence, session, content, and bridge behavior.
- Renderer type checks, unit tests, build validation, shared fixtures, and recovery tests cover the web boundary.
- Hosted app unit tests cover native integration.
- Guarded serialized XCUITest covers rendered iPhone/iPad flows, localization, accessibility settings, relaunch, and fallback.
- Physical iPhone/iPad, future real CloudKit, TestFlight, and App Store evidence are never inferred from local checks.

The public acceptance map is `docs/product/TRACEABILITY.md`; current proof and blockers are in `docs/product/ACCEPTANCE_MATRIX.md`.
