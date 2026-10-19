# Build 18 physical Live Activity evidence

Date: 2026-08-30

Status: exact existing candidate and compact Dynamic Island core lifecycle verified; remaining system-presentation matrix explicitly unverified

## Exact candidate

- Source commit: `28d5d75a5ed9d515898c779627c98dae61f608aa`
- Source tree: `c333250dd5f30452e574f22aba8bb00d0dce8fd9`
- Live Activity implementation commit: `5feb6b881174cd6086e7d55c0bc71032dfeb3beb`
- Version-selection commit: `f2209d9a67f3f068d5442a5dc9b580409a81c68b`
- Version/build: `1.0.1 (18)`
- App Store Connect build ID: `dccf3c83-99c9-4671-aad6-9cd2f7fbfa9f`
- Archive ZIP SHA-256: `465303c903ec0ef1691b527a460e703461248551f691f54c4e935876c1b2cb3a`
- IPA SHA-256: `ad4e14d2e9b93b461db528af1fff179a336aa2be47d46e901f5caa43ccddf22c`
- Apple readback: `VALID`, `APP_STORE_ELIGIBLE`, unexpired; preserved release evidence binds explicit membership in the existing Internal Testing group

The signed feature and version commits merge to canonical `main`; the merge tree is byte-identical to the version commit tree. The preserved release record, archive ZIP, and IPA were rehashed before device work. No replacement build was produced or uploaded.

## Authorized physical iPhone result

The app’s Settings screen exposed exact installed version `1.0.1 (18)` before the Live Activity flow. On the same authorized iPhone:

- A three-minute Timer produced the compact Dynamic Island leaf and live countdown while the app was backgrounded.
- Natural Timer completion removed the app-owned Dynamic Island presentation.
- A Stopwatch pause replaced its running counter with a stable confirmed `00:19` value.
- Resume advanced that counter to `00:42`.
- Terminating and relaunching the app while the Stopwatch was running presented the recovery choice and reset the Dynamic Island to the last confirmed `00:19`, rather than guessing closed-app time.
- Choosing **Keep confirmed time** restored the paused session; ending the short practice removed the remaining activity.

Raw screenshots, semantic device output, the exact device binding, and their hashes remain in ignored local evidence because the Home Screen captures contain owner-private device content. The public report intentionally omits device identifiers and personal paths.

## Remaining boundary

This run does not claim Lock Screen or expanded Dynamic Island presentation, Live Activities-disabled behavior, Dynamic Type, VoiceOver, or measured energy behavior. The approved device-pool surface could capture the compact system presentation but could not automate those additional system controls or measurements. AC-032 therefore remains externally blocked only for those rows; it is no longer blocked for exact-candidate installation, compact running/pause/resume, relaunch recovery, or completion cleanup.

The run saved one qualifying three-minute Timer practice and one nonqualifying nineteen-second Stopwatch practice to the device’s private local history. It did not delete or reset device data. No TestFlight, App Store, group, tester, notification, CloudKit, GitHub, tag, certificate, or public-release mutation occurred.
