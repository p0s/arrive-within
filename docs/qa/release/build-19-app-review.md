# Arrive Within 1.0.2 (19): App Review submission

Observed on 2026-10-01. The machine-readable receipt is
[build-19-app-review.json](build-19-app-review.json).

## Delivery

- App source: `42afc7799256481fce84745150f1ff29eaa56f11`.
- Marketing alignment source: `74283d0d7b9464991a7f2fab323594aabe9da57b`.
- Apple reports build 19 as valid and App Store eligible; internal TestFlight membership was verified.
- Submission `bdbb8994-0493-4be7-a445-bffda381ace7` was submitted at `2026-10-01T01:59:53.745Z` and read back as `WAITING_FOR_REVIEW`.
- Its single review item points to the exact 1.0.2 version. The version retains `MANUAL` release mode.

## Screenshots and icon

All 24 approved English/German iPhone/iPad images were uploaded. Apple’s
source checksums, file sizes, dimensions, numbered order, six-image set counts,
and `COMPLETE` delivery states match the frozen PNGs.

The second image has the dark Garden behind the light Garden. Frame tops share
one height across each device family and both languages. The compiled sprout
icon was inspected in the distribution artifact.

## Verification scope

The frozen app source passed the offline Goal in the writer checkout and a
tracked-only clean clone, concrete iPhone/iPad Release builds, and archive/IPA
inspection. The later alignment patch passed its export and geometry gates.
Independent review cleared both before source delivery.

Exact installed 1.0.2 (19) was observed on a physical iPhone and iPad. A real
three-minute timer completed on both, with truthful Garden/Journey projections.
The German iPad timer also held elapsed time while paused and backgrounded,
then resumed and completed. Every device session was closed.

This bounded run does not establish a complete physical system or human
VoiceOver matrix, cold termination, or human audio audibility. A minor
singular/plural accessibility duration wording issue remains a follow-up;
the visible numeric timer is unaffected. The formal security scan was waived,
not passed. Raw signing, provider, and physical evidence remains private.

## Public release boundary

Version 1.0.1 (18) remains public. Review approval, a new storefront icon,
and public distribution of 1.0.2 are not claimed. Manual release after approval
is a separate operation. Apple supplied no server-side IPA checksum.
