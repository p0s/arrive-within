# Feedback receiver operations

Status: prepared; no endpoint deployed or activated

## Scope

The receiver under `services/feedback-receiver/` accepts only explicit Arrive Within support reports. It has no route to product state, CloudKit, journal storage, media, analytics, accounts, or release systems. `contract.json` is the machine-readable request/response boundary.

## Pre-deployment gate

Before any separately authorized deployment:

1. Re-run the Swift feedback tests and receiver tests with synthetic values only.
2. Review the exact client allowlist, `PrivacyInfo.xcprivacy`, App Privacy worksheet, privacy/support copy, and receiver retention policy.
3. Select one app-isolated public HTTPS path. Keep the URL and host configuration out of tracked source until public-safe deployment facts are approved.
4. Pass an absolute private data directory outside source, website, build, backup-export, and release-archive roots. The receiver rejects a relative path and enforces directory mode `0700` and file mode `0600`.
5. The process enforces the exact IPv4 loopback bind and a 15-second connection timeout. Put it behind TLS termination; disable proxy access/request-body logging, request buffering to shared logs, cookies, CORS, and cache storage; and set additional bounded proxy concurrency and timeouts.
6. The receiver purges expired records at startup, every 60 seconds while serving, before digest generation, and on every accepted request. A maintenance failure stops intake instead of silently extending retention. Verify expired files are gone and the content-free digest contains no IDs, messages, addresses, or context values.

## Synthetic smoke plan

Use one fixed synthetic UUID, message, reply address, and context. POST it twice with the same `Idempotency-Key`; both responses must return the same report ID and `accepted`, while exactly one private record exists. Reuse the ID with changed content and require `409`. Then verify an unknown field, absent idempotency header, oversized body, non-JSON body, and wrong route fail closed. Inspect response headers for `no-store` and verify proxy/application logs contain neither payload nor network identity.

Never use a real journal excerpt, practice history, recording, account detail, device identifier, credential, or personal address in a smoke test.

## Activation and rollback

Activation is two distinct authorized changes: deploy/read back the isolated receiver, then bind the exact HTTPS URL into an ignored release configuration and rebuild the exact candidate. If health, privacy, retention, TLS, idempotency, or delivery readback fails, remove the endpoint value and rebuild; the public default already fails closed. Rollback must not delete unreviewed private reports: first stop new intake, preserve the bounded private directory under the approved retention policy, verify the app has returned to not-configured behavior, and then follow the approved data-deletion process.

Production deployment, DNS, credentials, service start, endpoint activation, external smoke, and rollback execution are not authorized by this document.
