# SCN-010 local export, reset, and deletion probe

Date: 2026-08-09
Status: Focused source and host regressions plus selected build-7 archive/IPA gate passed; physical exact-candidate repetition pending
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## Outcome

Data & Storage is a bilingual native settings surface with honest device-local state, current record counts, complete readable export, permanent-generation reset, and complete deletion. Destructive actions are disabled during an active meditation and require explicit confirmation.

The deterministic complete export contains manifest hashes, profile and journey summaries, practice JSON/CSV, customization, favorites, journal Markdown/JSON, and only checksum-verified local voice files. Archives live in one protected, short-lived app-owned staging root that requests iOS backup exclusion, are removed after sharing/dismissal, and never cause deletion of an external user-shared copy. One focused hosted-iOS test reads back backup exclusion and complete protection; physical-candidate repetition remains separate. Reset removes all owned archives plus old-generation events/journal/customization and referenced audio. Full deletion removes product records, audio, staged exports, settings, preferences, and legacy files, then resets the in-memory language to System only after persistent deletion succeeds.

## Reproducible evidence

| Check | Target | Result |
|---|---|---|
| `swift test --package-path Packages/ArriveWithinCore` | Host Swift package | Latest coherent package freeze: 41 tests across 7 suites passed; 0 failed/skipped |
| `Complete data export is deterministic, readable, and includes verified voice files` | Export archive | Byte-identical repeated ZIPs passed archive validation and contained the expected readable paths |
| `Whole-product controls export, reset, and delete without old-generation resurrection` | Product controller | Export, audio cleanup, generation reset, preferences boundary, complete local delete, and zero counts passed |
| Guarded `testLocalDataExportResetAndCompleteDeletionRemainTruthful` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed/skipped; result bundle `Test-ArriveWithin-2026.08.09_19-47-39-+0800.xcresult` |

## Claim boundary

The guarded rendered flow began from a clean local-only state seeded with two immutable sessions, observed the live count, created a shareable archive, reset the garden/history, acknowledged the non-resurrection message, deleted everything, returned to first use, and remained there after relaunch. The two prior failing runs were accessibility/count freshness defects and are retained as non-passing evidence; the code changed before the passing rerun.

Version 1.0 is local-only, so successful delete-all has no cloud-pending state. The selected build-7 frozen-source, archive, and distribution-IPA gates confirm the protected local-only product composition; binary inspection cannot substitute for exercising destructive UI behavior. Exact physical build-7 export/reset/delete and backup-exclusion repetition remains external. CloudKit remains disabled until a future operation-specific deletion protocol and stale-device/reinstall proof exists.
