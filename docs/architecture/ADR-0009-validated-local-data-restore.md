# ADR-0009: Validate local archives before replacing product data

**Status:** Accepted
**Date:** 2026-09-25

## Context

Arrive Within already creates a complete, readable archive of saved profile,
practice, Garden, journal, voice, and favorite data. A readable export without a
matching restore path leaves people unable to move that saved history between
devices. Restore must also preserve the app's local-only privacy boundary and
must not leave the existing store half-replaced when an archive is malformed.

## Decision

- Restore only the versioned archive format produced by `WholeProductExporter`.
- Bound archive size and entry count. Accept only stored, UTF-8 ZIP entries with
  safe allowlisted paths; reject encrypted, compressed, multi-disk, Zip64,
  duplicate, malformed, and path-traversal inputs.
- Verify each file against the manifest, decode the domain models, and check
  generation identity, unique practice/session IDs, derived Journey state,
  journal links, favorites, and voice-file checksums before offering restore.
- Show the archive's practice, journal, and voice counts and require a separate
  destructive confirmation. Invalid input does not mutate app data.
- Replace Core Data records in one local transaction. A failed transaction
  leaves the current snapshot active.
- Keep language, timer preferences, reminder schedules, and system permission
  choices on the current device. Remove stale sessions, unfinished text
  drafts, app-owned exports, and materialized voice files after commit.
- Do not merge, synchronize, upload, or import unsaved drafts.

## Consequences

The archive is a deliberate user-controlled transfer file. Restore does not add
data collection or a network path. The user sees which saved product data will
be replaced and which device settings remain. Current archive limits are 256
MiB, 10,000 ZIP entries, 20,000 practice events, and 4,096 journal entries.

Validation evidence belongs to `WholeProductImporterTests` and the
`productDataControls` persistence integration test. Physical candidate evidence
remains a separate release gate.
