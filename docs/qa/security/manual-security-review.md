# Manual security review

Date: 2026-08-12
Status: supplied findings resolved or fail-closed for V1 source; focused regressions pass; formal workbench owner-waived, skipped, and not passed

## Scope and method

The review now binds both the earlier manual findings and the owner-supplied 2026-08-12 audit. It traced persisted journal payloads through domain decoding and export, app-owned export archives through sharing/reset/entry deletion/full deletion, settings persistence through delete-all, prospective-public enumeration through pre-Git and future Git modes, and the V1 CloudKit activation boundary. Negative and legitimate controls run through the real domain/persistence interfaces.

Assets considered sensitive include journal text, voice recordings and transcripts, immutable practice events and stored day identity, progression state, app-owned export archives, signing/configuration material, device evidence, and prospective public/release bytes.

Trust boundaries include persisted bytes to validated domain values, protected local storage to app-owned share staging, staging to Apple’s share sheet and external user copies, Swift to the isolated renderer, Xcode result bundles to marketing inputs, local browser rendering to final images, CI dependencies/actions, and source to future public or release archives.

## Resolved findings

| ID | Finding | Resolution and regression evidence |
| --- | --- | --- |
| MSR-001 | Feedback endpoint and receiver accepted boundaries needed stricter canonicalization. | Require an exact HTTPS public host and `/v1/reports`, reject ambiguous/placeholder hosts and redirects, require an absolute private receiver directory, exact loopback binding, and bounded socket timeouts. Swift and receiver negative tests cover the boundary. |
| MSR-002 | Local marketing capture requests and exported attachment names needed parse-based containment. | Compare parsed origins exactly, reject crafted lookalike URLs, resolve attachments beneath their temporary root, reject absolute/traversal/link/nonregular inputs, and exercise malicious controls in the plan validator. |
| MSR-003 | CI actions and JavaScript production dependencies needed immutable/patched inputs. | Pin third-party actions to full commit identifiers, disable persisted checkout credentials, update the three affected direct packages, and bind zero-advisory production audits to exact lock hashes. |
| MSR-004 | Feedback retention could otherwise depend on later intake or digest activity. | Add startup and periodic retention sweeps; stop the reference server if maintenance fails. Tests prove explicit expiry without a new report. |
| AW-SEC-001 | Sensitive app-owned export archives could survive their source data. | One protected, TTL-bounded staging manager owns at most one archive, requests iOS backup exclusion, removes it after sharing/dismissal, reset, entry deletion, full deletion, and startup expiry, and rejects links/nonregular files. External user-shared copies are never targeted. A focused hosted-iOS test reads back backup exclusion and complete protection; physical-candidate repetition remains separate. |
| AW-SEC-002 | CloudKit deletion had no operation-specific confirmation and could not meet anti-resurrection requirements. | Version 1.0 now always composes the local store and binds no CloudKit container, entitlement, push entitlement, or remote-notification mode. The historical adapter remains unreachable future source until a real protocol and two-device proof exist. |
| AW-SEC-003 | Delete-all omitted persisted app settings. | Standalone product artifacts are classified centrally; settings deletion is required, and in-memory language returns to System only after persistence and settings cleanup succeed. |
| AW-SEC-004 | Pre-publication tooling could include ignored local/generated files. | One shared enumerator uses Git candidate/check-ignore semantics after initialization, ripgrep’s mature ignore engine before Git, and explicit sensitive-path rejection. Ignore/negation plus key/config/cache fixtures pass without creating Git metadata. |
| AW-SEC-005 | Synthesized decoding could bypass journal invariants and feed unsafe audio metadata to a single-entry export. | Audio, transcript, and entry decoding all re-enter validating initializers. The exporter independently requires a direct regular non-symlink audio child with matching checksum and size. Malformed traversal, tombstone-content, and transcript-engine payloads fail. |

No open source-code finding remains from this manual review after targeted revalidation. This means only that the reviewed paths and exact dependency snapshots passed the stated checks.

## Preserved security properties

- Core practice completion and protected local persistence have no network dependency.
- V1 always selects local-only storage; optional CloudKit code is unreachable and retained only for future work.
- Persisted journals revalidate domain invariants; journal/export paths reject traversal, links, nonregular audio, and integrity mismatches.
- App-owned exports are short-lived and deletion-scoped; external copies intentionally shared by the user are outside app control.
- The renderer is bundled, nonpersistent, hash-validated, CSP-isolated, size/schema bounded, navigation-denied by default, and has a native fallback.
- V1 contains no feedback endpoint, linked transport, compose UI, or automatic support transmission; Settings has direct web links only.
- The website is static and tracker-free; local marketing tooling blocks external requests and consumes bounded real files.
- CI has read-only permissions, immutable third-party action references, and no persisted checkout credential.

## Gates that remain separate

The owner waived the formal Codex Security workbench; no scan context or formal pass exists. Exact signed archive/IPA inspection, physical-device candidate behavior including backup-exclusion repetition, deployed website readback, and the future staged-tree/history privacy scan remain separate. CloudKit is not a V1 capability; it requires a new security/product decision and real two-device evidence before reactivation.

Machine-readable evidence: [`manual-security-review.json`](manual-security-review.json). The ignored full report contains check-level results only and must never be staged or packaged.
