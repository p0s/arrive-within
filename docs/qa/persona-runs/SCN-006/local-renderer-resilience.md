# SCN-006 local renderer resilience

Date: 2026-08-09
Status: Passed for the named deterministic and iPhone-simulator resilience boundary; final art and physical performance remain
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## Outcome

The renderer no longer destroys its web view on recoverable WebGL context loss. It pauses, restores the context, rebuilds from the latest complete deterministic state, and accepts Swift's authoritative snapshot again. A bounded four-second timeout still fails safely to the native garden. The native fallback preserves stage description, Meditate, retry, and a user-initiated redacted diagnostics path.

Adaptive quality measures render work independently of its deliberate frame-rate caps, lowers tiers only after sustained pressure, restores only after sustained headroom plus cooldown, and never exceeds the state-provided ceiling. Low quality reduces background detail before the hero tree. Shared scene resources dispose exactly once.

## Reproducible checks

| Check | Target | Result |
|---|---|---|
| `pnpm verify` from `Renderer/` | TypeScript resilience/contracts and production bundle | 18 passed across 4 files; typecheck/build passed |
| Guarded hosted app unit suite | iPhone 17 Pro simulator, iOS 26.5 | 15 passed, 0 failed/skipped; result bundle `Test-ArriveWithin-2026.08.09_21-22-03-+0800.xcresult` |
| Guarded `testRendererRecoversContextLossAndFallbackOffersDiagnostics` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed/skipped; result bundle `Test-ArriveWithin-2026.08.09_21-21-22-+0800.xcresult` |
| Plist/string/privacy parse and key parity | EN/DE resources | All six parse; 302 UI keys and 3 permission keys per locale |

## Rendered proof and claim boundary

The test uses the real WebGL `WEBGL_lose_context` extension, not a mocked fallback flag. After restoration the live scene, stage, and Meditate action remain visible; no native-fallback message appears. A separate forced-native relaunch shows the same seed-stage truth with a visually inspected material-backed recovery panel, retry, prepare/share diagnostics, and Meditate.

This does not prove final premium art, every representative milestone/customization image, iPad recovery layout, low-memory process pressure, or the declared oldest/recent physical startup/frame/memory/thermal/battery budgets. Those remain separate, named gates.
