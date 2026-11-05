# Shared verification entrypoint

`scripts/verify` delegates to the iOS Blueprint runner. The app owns the adjacent
`verification-profile.json`, test selectors, and acceptance states. Set
`P0S_IOS_BLUEPRINT_ROOT` to a Blueprint checkout when it is not at
`$HOME/src/pg/ios-dev-blueprint`. The wrapper resolves its own checkout, including
task worktrees. Adoption was prepared against runner SHA-256
`6fc4d22d9ba00f1318d39b424a8015d386e11597770688538a2bc1fde55c653b`.

## Run

Install the documented project dependencies and generate the ignored Xcode project
with `xcodegen generate`. Simulator execution requires the installed Blueprint
process-backed test pool; it selects one destination and serializes XCTest within
its slot. Do not start raw XCTest or manually reserve simulator capacity.

```sh
./scripts/verify --plan
./scripts/verify --output .build/verification/default.json
./scripts/verify --strict --lane offline --output .build/verification/offline.json
./scripts/verify --strict --lane simulator --scenario practice-ipad --output .build/verification/ipad.json
./scripts/verify --strict --lane simulator --scenario reminder-recovery --output .build/verification/reminders.json
./scripts/verify --strict --lane simulator --scenario app-integration --output .build/verification/integration.json
./scripts/verify --strict --lane simulator --scenario fixture-isolation --output .build/verification/isolation.json
./scripts/verify --strict --lane simulator --scenario siri-intent-adapter --output .build/verification/siri-adapter.json
./scripts/verify --strict --lane simulator --scenario siri-app-intents --output .build/verification/siri-app-intents.json
```

The default command is an iPhone smoke journey. `--strict` selects all required
checks; focused commands avoid rerunning unchanged passing checks. Keep raw JSON,
logs and result bundles ignored: they can contain machine paths. A dirty-source
run is diagnostic evidence for its recorded digest, not a clean-commit certificate.
The complete engineering/release gates remain `scripts/check` and `scripts/goal`.

## Acceptance mapping

| Check | Meaningful state and evidence |
| --- | --- |
| offline | English/German localization parity; existing deterministic domain, persistence, meditation, content and bridge package tests, including reminder validation and completion idempotency. Does not cover simulator checks. |
| practice-iphone / practice-ipad (SCN-001) | New practitioner completes an accelerated three-minute session, sees rendered garden growth, relaunches into persisted progress, and retains that progress in the native renderer fallback. XCTest stores screenshots of growth and fallback. |
| reminder-recovery (SCN-011) | Practitioner saves one local weekly reminder while notification permission is denied; the same schedule survives relaunch and reconciles after injected authorization. Screenshots record both states. |
| app-integration | Existing AppModel vertical slices independently exercise persistence, session completion, native fallback, journal and reminder reconciliation using injected dependencies. |
| fixture-isolation | Namespace validation rejects missing, duplicate and traversal values; separate UUID roots preserve an existing product-store sentinel, alongside directory safety/backup tests. |
| siri-intent-adapter (SCN-021) | Hosted tests drive the real AppModel through the Siri and Shortcuts adapter with injected repositories and a virtual clock: one practice at a time, repeated starts report the existing practice, remembered timer settings stay unchanged, invalid lengths and unpackaged narration fail with recovery text, paused time is excluded, recovery-pending and unloaded sessions stay untouched, and the practice ledger stays unchanged. |
| siri-app-intents (SCN-021) | AppIntentsTesting runs the three real intents through the system against the app launched in an isolated namespace and checks the 42-entry guided catalog. A DEBUG-only, hidden, read-only inspection intent reads back session identity, timing, guided identity and ledger count. Needs an iOS 27.0 or later simulator runtime. |

## Isolation and evidence limits

The new UI journeys use a fresh UUID with the DEBUG-only `-ui-test-namespace`
argument. Relaunches reuse that UUID. Their data lives under a separate
`ArriveWithinVerification` application-support directory; they do not reset or
delete the ordinary product store. Invalid namespaces fail closed. Timer alerts,
Live Activities and weekly notifications use no-op controllers in this mode.
Permission state is deliberately injected, so no OS permission setting changes
or real notification deliveries occur. Release builds do not expose this fixture.
The Siri system tests add one DEBUG-only inspection intent that is hidden from
Shortcuts, reads state without changing it, and is not compiled into Release.
The beta Siri AI preview configuration and its metadata analysis are separate
non-pool builds described in ADR-0015; they are not part of this profile.

This meditation app has no trip or location acceptance scenario. Physical-device
notification delivery, real permission changes, background scheduling, audio and
Live Activity behavior remain hardware-only proof outside this profile. An empty
physical lane means not applicable to this bounded invocation, not hardware
verification or release approval.
