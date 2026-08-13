# SCN-005 local lifecycle and audio-policy probe

Date: 2026-08-10
Status: Passed for deterministic lifecycle policy and hosted app integration; physical audio closure remains
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## 2026-08-13 policy correction

The owner-observed build-9 timer continued running while the interruption notice claimed it was paused. Timer and stopwatch timing now remain authoritative through audio interruption, route loss, or media reset; their audio graph stops and rebuilds independently, then resumes from current elapsed time when a safe route returns. Guided narration still pauses because silently advancing spoken content would lose the practice. The paused notice is now published only after a guided-session pause is durably reflected in authoritative state.

## Outcome

A running three-minute timer durably pauses on an interruption, output-route loss, and media-services reset. Interruption end and route availability never resume it implicitly. Only an explicit user resume restarts active-time accounting; media reset rebuilds the audio controller before that resume. The completed session records exactly 180,000 active milliseconds and a late duplicate lifecycle callback cannot insert a second qualifying event.

The hosted integration probe exercises `AppModel`, its persisted session repository boundary, virtual monotonic time, the exact lifecycle event mapping, and a recording native-audio-controller seam. Production code observes `AVAudioSession` interruption, route-change, and media-reset notifications and compiles into the simulator and device targets, but no simulator result is represented as proof of physical audio routing.

## Reproducible checks

| Check | Target | Result |
|---|---|---|
| `swift test --package-path Packages/ArriveWithinCore` | Host Swift package | 44 passed across 7 suites; 0 failed/skipped, including lifecycle-policy transitions |
| Guarded hosted unit target | iPhone 17 Pro simulator, iOS 26.5, exact destination retained privately | 21 passed, 0 failed/skipped; raw result-bundle path retained only in private local evidence |
| `audioSystemEventsNeverResumeOrCompleteImplicitly` | Same guarded run | Pauses at 60,000 / 120,000 / 150,000 active ms; zero implicit resumes; one rebuild; explicit final resume; exactly one 180,000 ms event |

The XCTest invocation used `scripts/run_guarded_xcode_tests.sh`, one destination, one invocation, one worker, and no parallel testing. Unexpected skips: none.

## Claim boundary

This report does not prove audible quality, lock-screen continuity, real Bluetooth/wired/speaker route changes, phone-call or Siri interruptions, media-services recovery on hardware, notification delivery, energy use, or background execution limits. Those require the exact authorized physical iPhone and iPad, OS/build/commit binding, controlled side effects, listening observation, and repetition on the signed/TestFlight candidate. No physical-device automation is authorized in this task.
