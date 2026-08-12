# Renderer resilience and diagnostics

Status: Implemented with local and focused physical source proof; exact distribution and performance budgets remain external

## Contract

- Swift remains authoritative. Renderer events can report readiness, interaction, rounded render timing, selected quality, typed diagnostics, or typed errors only.
- Every incoming event must have exactly `type`, `schemaVersion`, UUID `requestID`, and `payload`, fit within 64 KiB, and satisfy its exact whitelisted payload shape. Unknown fields, codes, reasons, qualities, identifiers, booleans-as-timings, and non-finite/out-of-range values are rejected.
- A WebGL context loss is a recoverable diagnostic, not a fatal renderer error. The same web view pauses rendering, restores/rebuilds from its latest complete `GardenState`, and resends authoritative Swift state. Only a four-second recovery timeout activates the native fallback.
- Renderer resources are disposed once even when meshes share geometry/material instances. Page teardown removes the bridge and scene resources; Swift removes its scoped handler and cancels recovery work.
- Swift resolves the exact bundled `GardenRenderer/dist` directory, validates both HTML and JavaScript as UTF-8, and loads the validated HTML string with that directory as its base URL. This avoids signed-bundle file-document navigation drift while preserving local relative assets, CSP, the navigation allowlist, and named-world JavaScript injection.

## Adaptive quality

Render work is sampled separately from the intentional 60/30/12 fps scheduling cap. Two sustained windows above 18 ms lower one tier; six windows below 9 ms restore one tier after a cooldown, never above the Swift-provided ceiling. Quality reduces particles, background vegetation, and shadow resolution while preserving deterministic tree form, growth, and camera composition. Physical frame, memory, thermal, and battery budgets remain device evidence rather than simulator claims.

## Redacted diagnostics

The user can prepare then share a renderer-only JSON report from native fallback. It contains schema/contract versions, ready/fallback state, selected quality, recovery count, and at most 32 typed observations with rounded timings. The file is capped at 32 KiB and contains no garden/profile/event identifiers, dates/timestamps, locale, device identity, journal content, meditation history, credentials, or arbitrary JavaScript/native error text.

## Local proof

- `pnpm verify` in `Renderer/`: TypeScript typecheck, 18 tests across 4 files, and deterministic production build pass.
- Guarded hosted app suite: 15 tests pass; strict event rejection and diagnostics bounds/redaction are directly tested.
- Guarded `testRendererRecoversContextLossAndFallbackOffersDiagnostics`: an actual `WEBGL_lose_context` extension cycle restores the same iPhone-simulator garden without fallback, then a forced native relaunch retains Meditate/retry and produces a shareable redacted report. Final result bundle: `Test-ArriveWithin-2026.08.09_21-21-22-+0800.xcresult`.
- A focused physical UI test on an authorized iPad Pro 13-inch (M4), iPadOS 26.6, passes the real WebGL readiness handshake and proves the native fallback remains absent in current development build 4. The retained 2064×2752 screenshot visibly contains the rendered garden. This is source-bound physical evidence, not TestFlight-build or sustained-performance proof.

Raw result bundles and screenshots remain ignored local evidence. The retained recovery and fallback frames were visually inspected; neither is physical-device performance evidence.
