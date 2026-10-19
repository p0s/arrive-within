# SCN-009 local data and convergence probe

Date: 2026-08-09
Status: Passed for the version 1.0 local-only model; future CloudKit activation remains out of scope
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## Outcome

The shipping composition root uses one `ArriveWithinProduct.v1` Core Data model for profile generations, immutable practice events, garden customization, append-only journal revisions, and favorite tombstones. Version 1.0 always opens it locally with file protection and no account, backend, or cloud synchronization. The source-retained private CloudKit adapter is unreachable in V1 until a future operation-specific deletion protocol and stale-device matrix are proven.

Local reopening restores profile, event, and journal state. Duplicate practice insert is idempotent. Reset lineage keeps late old-generation records outside the active projection. Concurrent same-revision journal edits remain separate immutable records, surface both variants, keep content visible at delete/edit ambiguity, and require the user to choose a later resolving revision. Optional voice bytes use the model’s external binary storage path; save validates the local file and checksum, missing/corrupt local audio is restored only from verified replicated bytes, and tombstoning prunes the superseded private blob. The deterministic sync reducer distinguishes account, activity, offline, restriction, quota, temporary failure, and error states without inventing a last-sync timestamp.

A later focused compatibility proof binds the exact build-1 persistence source to its frozen manifest, uses it to write a synthetic privacy-safe build-1 fixture, and opens that fixture with build 7. Profile, practice, Garden customization, journal, favorites, settings, timer preferences, running session, and reminder survive; duplicate insertion and a second reopen are stable; only the obsolete pending-cloud marker is removed. See `docs/qa/release/baseline-build-1-upgrade.md`.

## Reproducible evidence

| Check | Result |
|---|---|
| `swift test --package-path Packages/ArriveWithinCore` | Latest coherent package freeze: 41 tests across 7 suites passed; 0 failed/skipped |
| `The production Core Data model is local-first, idempotent, and reset-safe` | Local reopen, exact-once event, model counts, child-generation reset, and late-old-record isolation passed |
| `Concurrent CloudKit-style journal revisions remain preserved until explicit resolution` | Two divergent revision-2 replicas survived, conflict count was 1, duplicate ingestion was idempotent, explicit choice created revision 3, conflict cleared |
| `Journal voice bytes replicate safely, repair local loss, and are scrubbed by deletion` | Verified bytes survived store round-trip, repaired missing/corrupt local files, and disappeared from the surviving model revision after tombstone |
| `Sync-state truth distinguishes local, active, unavailable, and quota states` | Every signal maps honestly; local-only ignores cloud-shaped signals |
| `baselineBuildOneUpgradeToSelectedBuildSeven` | Exact-source build-1 fixture opens under build 7 with semantic state preserved, duplicate-safe, marker-cleaned, and stable on second reopen |
| Generic iOS Simulator build | Succeeded against the current model and Data & Sync UI |

## Fidelity boundary

This proves the version 1.0 local production model, asset bridge, deterministic convergence rules, and local build-1-format compatibility including cleanup of an obsolete pending-cloud marker. It does not prove the physical/TestFlight upgrade path or claim any CloudKit behavior. Future CloudKit activation requires the protocol and two-device matrix in `docs/architecture/LOCAL_AND_PRIVATE_CLOUD_DATA.md`; that future capability is not a V1 release gate.
