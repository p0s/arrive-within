# Physical iPad local-development E2E

Status: local development build/install/launch passed; automation blocked before test entry

## Exact authorized hardware boundary

The exact authorized device resolves as an iPad Pro 13-inch (M4) running iPadOS 26.6. It was available, paired, trusted, unlocked for the attempt, in Developer Mode, and reachable through the CoreDevice tunnel. Device aliases, serials, device identifiers, account details, and signing identifiers are intentionally absent from this public-safe report; exact local binding remains in ignored private evidence.

The attempted app identity was Arrive Within `1.0 (1)` against the 69-file shipping-source SHA-256 `f0d57313208804c5319631bb0e17c014a88edfd9dd50d0a5d0e2db6ce7772904`. This is a no-Git local source identity, not a commit, tag, archive, TestFlight, or release candidate.

## Result

Narrow inspection of an already-used local development binding allowed an ignored `Config/Local.xcconfig` to supply the existing team. The exact device build succeeded without provisioning updates. Built-bundle inspection found a valid, unexpired local development profile covering the device, a development-only debug entitlement, no configured official CloudKit container, and no distribution or release-candidate claim. Installation and a direct launch of Arrive Within succeeded.

The one serialized physical UI-suite invocation failed in the XCTest runner before entering any test method: Xcode timed out while enabling device automation mode. The result contained zero passed tests and one runner failure. Consequently, no onboarding, practice, Garden, Journey/calendar, guided content, audio, Journal, reminders, export, reset/delete, accessibility, orientation, performance, offline, or feedback scenario ran under automation. No microphone prompt, reminder, recording, export, journal entry, feedback report, or qualifying practice event was created by the failed suite. A clean-state preflight had removed prior Arrive Within test state; the frozen lane prevents a further device cleanup/readback claim.

## Smallest continuation

When the physical lane is separately reauthorized, diagnose the device-automation enablement timeout without provisioning changes, confirm exact installed/test state, run the smallest physical test first, and then execute the coherent E2E matrix with synthetic data and explicit cleanup. No Apple registration or portal mutation is currently indicated by the successful existing-local build/install path.

This report proves only the public-safe hardware/OS inventory, local development signing/build/install/direct-launch path, and the automation-runner blocker. It is not a passed physical product flow, official CloudKit proof, archive or signed-candidate proof, TestFlight proof, or App Store evidence.
