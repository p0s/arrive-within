# Device-local language and adaptive presentation contract

Status: Implemented and locally verified for persistence, immediate relocalization, iPhone AX5, and iPad portrait/landscape; broader assistive-technology and human-language closure remains

## Product behavior

Arrive Within exposes one visible app-language choice in Settings: System, English, or Deutsch. System follows the device for English and German and deliberately falls back to English for every other language. The choice affects the app immediately and remains local to that device; it is not profile history, garden progress, journal data, analytics, or a CloudKit record.

The app persists schema-v1 `app-settings-v1.json` with atomic replacement and `completeUntilFirstUserAuthentication` file-protection intent. It saves a new selection before activating it. If persistence fails, the previous language remains active and a localized non-destructive notice appears. Missing settings mean System; malformed or unsupported schemas never become an implicit user choice.

The selected locale is injected once at the app root. All user-visible date, number, duration, garden-description, guided-language default, timer-alert, and weekly-reminder formatting consumes that locale rather than reading `Locale.current` independently. Notification requests therefore preserve the app's chosen language even when it differs from the device language.

## Adaptive interaction

Compact width uses four primary tabs whose native material overlays the full-canvas Garden. Regular-width Garden collapses the split view to its detail surface and uses one quiet native four-item overlay; choosing Practice, Journey, or Journal restores the `NavigationSplitView` sidebar, while returning to Garden restores the immersive composition. Command-1 through Command-4 still select Garden, Practice, Journey, and Journal on iPad keyboards. The practice-mode and guided-language segmented controls become menu pickers at accessibility Dynamic Type sizes.

Material-backed cards honor Reduce Transparency with an opaque adaptive background and add an outline for Increased Contrast. Reduce Motion flows from the SwiftUI environment through authoritative `GardenState` to the bundled renderer; the renderer stops ambient motion and uses its reduced update cadence. DEBUG-only deterministic flags exercise the same branches in guarded UI tests without altering Release behavior.

## Local proof

- `scripts/validate_localizations.mjs` parses the catalogues, rejects duplicate/empty/mismatched keys, checks declared locales and privacy tracking absence, and currently passes 374 UI plus 3 Info.plist keys per locale.
- `AppSettingsTests` proves System default, deterministic JSON round-trip/reopen, and fail-closed malformed/unsupported schemas. CoreSimulator accepts but does not expose the file-protection attribute; the physical/archive boundary remains separately classified.
- Hosted model tests pass the selected locale to timer-end and weekly-reminder notification adapters.
- Guarded iPhone UI proves visible English-to-German selection, immediate relocalization, and relaunch persistence; a separate AX5 flow proves menu-based mode selection and a reachable primary action.
- Guarded iPad Pro 13-inch (M5), iOS 26.5 UI proves portrait AX5 operation plus landscape navigation across all four sections and Command-key routing. A separate focused physical iPad Pro 13-inch (M4), iPadOS 26.6 current-source test passes portrait and landscape Garden-first composition, renderer readiness, four overlay destinations, Settings, and direct Support/Privacy controls.
- A guarded native-fallback run proves the deterministic Reduce Motion/Transparency and Increased Contrast branches remain operable in dark appearance. Raw screenshots and result bundles remain ignored local evidence.

## Claim boundary

These checks do not claim fluent German editorial approval, VoiceOver user testing, Switch Control, Voice Control, grayscale, pointer ergonomics, Stage Manager resizing, every screen/state at AX5, or physical-device accessibility. They also do not prove file-protection behavior on hardware. Those named gates remain open and cannot be replaced by simulator output.
