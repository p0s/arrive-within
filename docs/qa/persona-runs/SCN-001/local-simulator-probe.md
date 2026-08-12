# SCN-001 local simulator probe

Date: 2026-08-09
Status: Passed within the declared local-simulator boundary
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## Outcome

The first-use probe completed one persisted three-minute timer, accepted exactly one qualifying event, derived deterministic day-one garden growth, rendered that growth through the bundled offline WebGL renderer, restored it after termination/relaunch, and communicated the same state through the functional native fallback. The bundled renderer also loaded independently on the iPhone and iPad targets without falling back.

## Reproducible checks

| Check | Target | Result |
|---|---|---|
| `swift test --package-path Packages/ArriveWithinCore` | Host Swift package | 20 passed, 0 failed, 0 skipped |
| `pnpm verify` from `Renderer/` | TypeScript contracts, tests, deterministic production bundle | 11 passed; typecheck and build passed |
| Guarded hosted unit target using one explicit destination | iPhone 17 Pro simulator, iOS 26.5 | 5 passed, 0 failed, 0 skipped; destination identifier retained only in private local evidence |
| Guarded `testBundledRendererLoadsWithoutNetworkFallback` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed, 0 skipped; retained screenshot reviewed |
| Guarded `testBundledRendererLoadsWithoutNetworkFallback` | iPad Pro 13-inch (M5) simulator, iOS 26.5 | 1 passed, 0 failed, 0 skipped; retained screenshot reviewed |
| Guarded `testThreeMinutePracticeGrowsRendererRestoresAndFallsBack` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed, 0 skipped; retained day-one screenshot reviewed |

The UI clock is accelerated only at its injected monotonic-clock boundary. The production session still advances through the full 180-second model transition; no acceptance threshold is shortened.

## Determinism and isolation covered

- Duplicate completion callbacks remain idempotent and accepted events are immutable.
- Swift and TypeScript consume a versioned, bounded bridge contract and shared fixtures.
- The renderer bundle is manifest-size/hash verified before isolated-world injection.
- The shipping page forbids page scripts and network access; navigation stays inside its local directory.
- Renderer authority is read-only; forced renderer failure preserves the same native garden truth.

## Claim boundary

This report proves the current local source on the named simulators. It does not prove physical-device audio/lifecycle/performance, a signed archive, CloudKit, TestFlight, App Store, commit provenance, public-clone reproduction, or release readiness. Those gates remain separate.
