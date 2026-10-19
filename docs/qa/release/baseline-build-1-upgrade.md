# Baseline build 1 to selected build 7 persistence upgrade

Date: 2026-08-13
Status: Passed at deterministic repository-test fidelity; exact seeded TestFlight upgrade remains separate
Git lineage: unavailable in the intentional pre-Git checkout and not claimed

## Provenance

The frozen build-1 prospective-public tree has SHA-256 `cd17974d5196cd3e395da9782b83f30cc46dbc800aaaf6f4803eee78147d73a9`. The exact build-1 `CloudKitSafePersistence.swift` bytes were recovered from the frozen local source record and independently matched its manifest SHA-256 `9323e18ef6117fd5d9e28ff274825b2c5eaa491039218d9b3c88ffc82c578562` before fixture generation.

That byte-verified build-1 persistence implementation wrote a synthetic, privacy-safe V1 store containing one profile, qualifying practice event, Garden customization, valid text-only journal entry, and two guided favorites. Build-1-compatible V1 encodings add German app language, timer preferences, a running timer session, one weekly reminder, and the obsolete pending-cloud deletion marker. The immutable fixture manifest binds each file hash; `PRAGMA integrity_check` returned `ok`, and no WAL or SHM file is included.

## Focused result

`swift test --package-path Packages/ArriveWithinCore --filter baselineBuildOneUpgradeToSelectedBuildSeven`

The selected build-7 persistence implementation:

- opens and semantically reads every represented build-1 Core Data record;
- preserves settings, timer preferences, running session, and weekly reminder bytes;
- derives one qualifying Journey day from the immutable practice event;
- treats reinserting the baseline event as idempotent;
- removes only the obsolete local cloud-deletion marker; and
- reproduces the same profile, event, journal, and favorites after another store reopen.

One test in one suite passed. This closes deterministic local baseline-format compatibility. It does not prove an App Store/TestFlight in-place upgrade, app-hosted migration timing, physical storage protection, or user-visible post-upgrade journeys; those remain separate fidelity gates.
