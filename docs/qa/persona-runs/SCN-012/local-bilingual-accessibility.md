# SCN-012 local bilingual accessibility submatrix

Date: 2026-08-10
Status: Passed for the named local automated iPhone/iPad submatrix; full assistive-technology and physical closure remain
Product tree: current uncommitted local source; Git lineage does not exist and is not claimed

## Outcome

English and German UI resources have exact key parity, and the visible device-local language choice relocalizes immediately and survives relaunch. The compact-width app keeps its primary Practice actions reachable at AX5. Long German Practice labels remain reachable at AX5 on the smallest available phone target. The regular-width iPad shell retains all four primary destinations, supports keyboard focus movement, and keeps every primary path reachable in German, dark appearance, landscape, AX5, reduced effects, and increased contrast on the smallest available iPad target.

The full automated accessibility audit passes the clean first-use screen, forced native-garden fallback, and Practice chooser on the smallest available iPhone. A separate small-iPad run passes every audit category on first use and on the German Practice surface. The fallback remains operable with Reduce Motion, Reduce Transparency, and Increased Contrast overrides. These checks use actual rendered app UI; result bundles and screenshots remain ignored local evidence.

## Reproducible evidence

| Check | Target | Result |
|---|---|---|
| `node scripts/validate_localizations.mjs` | Source resources | 310/310 UI keys and 3/3 permission keys per locale; plist parsing passed |
| `testVisibleLanguageOverrideRelocalizesImmediatelyAndPersists` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed/skipped; `Test-ArriveWithin-2026.08.09_21-36-58-+0800.xcresult` |
| `testAccessibilityTypeKeepsPracticeModeAndActionReachable` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed/skipped; `Test-ArriveWithin-2026.08.09_21-41-46-+0800.xcresult` |
| `testIPadSidebarSurvivesLandscapeAndNavigatesEveryPrimarySection` | iPad Pro 13-inch (M5) simulator, iOS 26.5 | 1 passed, 0 failed/skipped; `Test-ArriveWithin-2026.08.09_21-53-00-+0800.xcresult` |
| `testFirstUseNativeGardenAndPracticePassAutomatedAccessibilityAudit` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed/skipped; `Test-ArriveWithin-2026.08.09_23-25-06-+0800.xcresult` |
| `testIPadAccessibilityTypeKeepsSidebarAndPracticeReachable` | iPad Pro 13-inch (M5) simulator, iOS 26.5 | 1 passed, 0 failed/skipped; `Test-ArriveWithin-2026.08.09_23-26-12-+0800.xcresult` |
| `testReducedEffectsAndIncreasedContrastKeepNativeGardenOperable` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed/skipped; `Test-ArriveWithin-2026.08.09_23-27-26-+0800.xcresult` |
| `testGermanAccessibilityTypeKeepsLongPracticeLabelsReachable` | iPhone 17 Pro simulator, iOS 26.5 | 1 passed, 0 failed/skipped; `Test-ArriveWithin-2026.08.09_23-28-24-+0800.xcresult` |
| `testGermanAccessibilityTypeKeepsLongPracticeLabelsReachable` | iPhone 17e simulator, iOS 26.5 | 1 passed, 0 failed/skipped; `.build/xcode-scn012-small-iphone/Logs/Test/Test-ArriveWithin-2026.08.10_04-20-59-+0800.xcresult` |
| `testFirstUseNativeGardenAndPracticePassAutomatedAccessibilityAudit` | iPhone 17e simulator, iOS 26.5 | 1 passed, 0 failed/skipped; `.build/xcode-scn012-small-iphone-full-audit/Logs/Test/Test-ArriveWithin-2026.08.10_04-22-50-+0800.xcresult` |
| `testSmallIPadGermanDarkAX5KeepsEveryPrimaryPathReachable` | iPad mini (A17 Pro) simulator, iOS 26.5 | 1 passed, 0 failed/skipped; `.build/xcode-scn012-small-ipad/Logs/Test/Test-ArriveWithin-2026.08.10_04-19-54-+0800.xcresult` |
| `testSmallIPadGermanPracticePassesFullAccessibilityAudit` | iPad mini (A17 Pro) simulator, iOS 26.5 | 1 passed, 0 failed/skipped; `.build/xcode-scn012-small-ipad-full-audit/Logs/Test/Test-ArriveWithin-2026.08.10_04-19-18-+0800.xcresult` |

All XCTest invocations used `scripts/run_guarded_xcode_tests.sh`, one destination, one invocation, one worker, and no parallel testing.

## Retained failure and repair history

The automated audit initially found clipped fallback retry/diagnostics controls, insufficient contrast in fallback and guided-library copy, an undersized German sidebar label, and a clipped waveform emitted by `Label`. The small-iPad run also showed that the system-managed selected `List` row did not provide deterministic audit semantics. The controls now wrap with full vertical bounds, supplementary copy uses explicit adaptive label color on opaque surfaces, decorative garden geometry is hidden while stage text and the description action remain accessible, and the iPad sidebar uses explicit high-contrast buttons with selected traits. The waveform is a hidden decorative `Image` beside an independent text node. A temporary strict expected-failure probe became unmatched after that last repair and was removed; the final run executes contrast and every other audit category normally. The forced-AX5 test uses a bounded audit set because XCTest cannot mutate an already forced AX5/custom-accessibility environment; the separate unmodified full-audit test covers the omitted categories. No final audit category or meaningful assertion is disabled.

## Claim boundary

This report does not claim fluent German copy approval, VoiceOver-user testing, Switch Control, grayscale, pointer, Stage Manager, every orientation/screen/state, physical iPhone/iPad behavior, or signed-candidate accessibility. It also does not turn simulator keyboard focus into hardware-keyboard proof. Those remain named local/manual, human, physical, and exact-candidate gates. Repeated Xcode 26.6 debugger-version warnings are host diagnostics; the retained result bundles prove the tests themselves executed and passed.
