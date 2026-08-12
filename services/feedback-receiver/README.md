# Feedback receiver

This optional service accepts only reports that a person explicitly previews and sends from Arrive Within. It is isolated from practice, journal, audio, renderer, CloudKit, account, analytics, and release systems. The app remains fully usable when the endpoint is absent or unavailable.

The contract is `POST /v1/reports` with `Content-Type: application/json`, `Cache-Control: no-store`, and an `Idempotency-Key` equal to the random per-report UUID. The strict payload is app, category, message, optional reply email, and optional app version/build/iOS version/locale. Unknown fields fail closed. Redirects are rejected by the app client.

The receiver writes no access log and does not persist network address, user agent, cookies, credentials, device/account identifiers, or implicit diagnostics. Full reports are private operator data with mode `0600` in a `0700` directory and a maximum 30-day retention. Expired records are purged at startup, every 60 seconds while serving, before digest generation, and during intake; a maintenance failure stops intake instead of silently extending retention. The digest returns day-level counts only; it never returns report IDs, messages, addresses, or context values.

## Local verification

From this directory:

```sh
python3 -m unittest -v test_feedback_receiver.py
```

For a synthetic local smoke test, create a temporary private directory, run the receiver on loopback, and POST the fixed synthetic fixture from the runbook. Never use real app or personal content in tests.

## Deployment boundary

No deployment target, credential, host, domain, or production URL is stored here. The process rejects non-loopback bind values and relative data directories. A later authorized deployment must place it behind TLS termination, disable proxy request-body/access logging, set request and concurrency limits, persist the absolute private data directory outside release artifacts, monitor the built-in retention worker, and configure the exact app-specific HTTPS path in an ignored release override. Deployment, endpoint activation, and public readback are separate mutations.
