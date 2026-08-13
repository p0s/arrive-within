# Motion acceptance matrix

Status: current motion direction owner-approved; complete selected-build accessibility capture and physical haptic review pending

All motion is state-driven, interruptible by the next user action, and non-authoritative. `AppMotion` owns native instant/quick/gentle/reveal rhythms; the selected Garden direction consumes the same `GardenState` and replaces camera/parallax/reveal movement with static state changes when Reduced Motion is active. No decorative animation can block practice, persistence, export, reset, or recovery.

The owner approved this current motion direction on 2026-08-13. That product-direction decision does not substitute for the final normal/Reduced Motion capture matrix, physical haptic comfort review, or device performance/energy evidence below.

| Boundary | Standard behavior | Reduced Motion behavior | Haptic / sound | Deterministic assertion |
| --- | --- | --- | --- | --- |
| First use to product | Gentle state transition after one explicit choice | Direct change | None | launch phase and selected root are authoritative |
| Practice preparation/start | Countdown then direct active state | Same readable countdown, no depth movement | One optional start haptic and separate opening bell | monotonic phase transition and saved active session |
| Pause/resume/interruption | Control/state change without decorative loop | Direct change | None | active milliseconds exclude paused time |
| Qualification/completion | Progress ring and selected Garden micro/reveal response | Static qualified/completed state | One optional end haptic and separate closing bell | exactly one immutable event and deterministic projection |
| Garden micro-growth | Short bounded scale/position reveal | Immediate before/after state | None | `microGrowthOrdinal` changes the visual signature once |
| Garden milestone | Longer bounded reveal with calm orbit available | Immediate mature state; orbit remains user-controlled | None | milestone projection and customization remain Swift-owned |
| Garden context/memory recovery | Pause, recover, or switch to native equivalent | Same | None | diagnostics are deduplicated; core actions remain native |
| Journey month/day | Quick directional content transition | Direct month/day replacement | None | stored practice-day keys never shift with timezone |
| Journal record/save/retry | Native control-state feedback only | Same | System recording affordance only | pending audio and unsaved changes cannot disappear silently |
| Reminder change | Native Form update after persistence | Same | Notification behavior only after explicit permission | schedule reconciliation remains idempotent |
| Data export/reset/delete | Native progress, confirmation, and terminal state | Same | None | destructive actions require explicit confirmation and generation boundaries |

Final selected-build evidence must cover normal and Reduced Motion clips, Reduce Transparency, increased contrast, grayscale, large Dynamic Type, VoiceOver focus, dim/flashing safety, cancellation, and state assertions without timing-only sleeps. Simulator evidence cannot substitute for physical haptic, audio-route, energy, or thermal proof.
