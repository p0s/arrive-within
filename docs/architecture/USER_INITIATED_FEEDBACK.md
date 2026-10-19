# User-initiated feedback boundary

Status: future non-shipping source reference; removed from the version 1.0 app target

## Decision

Version 1.0 exposes only direct public Support and Privacy links in Settings. It contains no feedback endpoint, transport dependency, compose/preview/send UI, or automatic support transmission. The package and reference receiver described below remain public source for a possible future owner decision; they are not linked into the shipping app.

If a future version activates this receiver, it is not a product-data backend. Meditation, local persistence, Garden, Journey, Journal, reminders, export, reset, and deletion must never call it or depend on it.

## Privacy and security properties

- The same immutable report object drives preview and JSON encoding.
- Unknown payload fields are rejected by both client tests and the receiver contract.
- No automatic request, telemetry, analytics, logs, stable identifier, practice or journal content, recording, transcript, renderer state, screenshot, clipboard content, credential, or CloudKit value is collected.
- Retry reuses the exact random report ID and payload; changed reuse is a conflict, and duplicate taps cannot start a second in-flight request.
- The client uses an ephemeral no-cookie/no-cache session, a bounded request and response, and no redirects. Server error bodies are never rendered.
- The receiver keeps no access log or implicit address/user-agent metadata, stores private reports with bounded retention, and produces only a content-free aggregate digest.

## Configuration and failure

Version 1.0 has no `ArriveWithinFeedbackEndpointURL` Info key or `ARRIVE_WITHIN_FEEDBACK_ENDPOINT_URL` build setting. Future activation requires a new binary, product/privacy decision, exact App Privacy reconciliation, and deployment evidence.

## Evidence boundary

Host Swift and receiver contract tests cover the future reference implementation only. Version 1.0 evidence instead proves target/config/resource isolation, direct Support/Privacy links, no collected-data manifest entries, and no shipping network client.

No feedback UI selector or receiver smoke is a version 1.0 release gate.
