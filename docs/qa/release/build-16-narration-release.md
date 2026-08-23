# Build 16 narration release

Date: 2026-08-23

Status: Apple `WAITING_FOR_REVIEW`; physical runtime proof remains separately unverified.

## Source and media

- Source merge: `b993fd8533381e01557d9ee9da22322b4f4c8ecb`
- Source tree: `c229005b5eed58e224f716f9ff8989f86bd1c462`
- Version/build: `1.0 (16)`
- Archive ZIP SHA-256: `02ca79bc6eb0446a2b7eef8d4e59574b2ebbde8217c0bbfaf9270158d2aba329`
- IPA SHA-256: `0f04813b49ba2af40dcc51b962bb50e65c18cc3192e430690aa90f6522c3c718`
- IPA size: 120,097,144 bytes
- Narration: 42 English and 42 German M4A tracks, matching VTT transcripts and provenance records
- Owner-review packet SHA-256: `34929c585a65e73f69a39925a332196be605aa6bd744d34788b9c22b636ffa79`

The owner approved every exact track hash for fluent listening, pronunciation/artifacts, script/editorial quality, VTT alignment, redistribution, and device candidacy. The promoted `Content/guided` tree passed the complete objective content gate. Inspection of the exported IPA found its complete Guided directory byte-identical to that promoted public tree.

## Apple readback

- Apple accepted build 16 and reports it `VALID`, `APP_STORE_ELIGIBLE`, unexpired, minimum iOS 18.0, and exempt from non-exempt encryption reporting.
- Adding build 16 to the existing Internal Testing group succeeded without creating a group or tester.
- Build 16 is attached to App Store version 1.0.
- The previously rejected app-version review item was marked resolved.
- The existing two-item review package was resubmitted at `2026-08-22T23:57:39.645Z`.
- API readback reports version 1.0, the review submission, and Premium Garden Material Styles `WAITING_FOR_REVIEW`, with automatic release selected after approval.

## Separate physical boundary

The authorized iPhone was available and TestFlight opened, but the host automation runner could not start because its own iOS development provisioning profile was absent. No exact build-16 physical installation, launch, audio playback, interruption, or route result is claimed. This infrastructure gap does not change the owner’s hash-bound listening approval, IPA packaging proof, TestFlight linkage, or App Store submission state.

Approval, automatic release, storefront availability, storefront installation, and exact physical runtime remain separate future readbacks.
