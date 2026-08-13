# Premium Garden styles contract

Status: implemented locally; App Store Connect product is intentionally unconfigured

## Product decision

Twilight remains the complete free Garden. One optional non-consumable purchase unlocks four presentation styles together for a proposed USD 4.99 equivalent: Hand-drawn, Stop-motion, Crochet (`Gehäkelt` in German), and Claymation. This is not a subscription and never buys progress, milestones, wildlife, time phases, or a stronger Garden.

The future App Store Connect product identifier is `com.philipps.arrivewithin.garden.materialstyles`. Source code and the local StoreKit configuration use that identifier, but this change does not create, price, clear, or publish a product in App Store Connect. `Config/PremiumGardenStyles.storekit` is local test data only; `$4.99` is a product proposal, not live-store availability evidence.

## Visual thesis

One beloved living Garden is retold through four tactile studios while its tree, path, water, pavilion, sky, and sparse ecology remain recognizably the same place.

- **Hand-drawn:** warm paper grain, restrained cross-hatching, imperfect dark contours, and muted ink color.
- **Stop-motion:** a softly lit handmade miniature, lightly mottled surfaces, and an intentional eight-frame-per-second movement cadence.
- **Crochet:** matte natural fibre color and small repeating loop marks that read as yarn without adding geometry.
- **Claymation:** rounded light response, low-contrast fingerprint arcs, and gently moulded color.

All marks are deterministic Canvas-generated textures written for this project. There are no external images, copied styles, new media rights, post-processing passes, runtime downloads, or additional dependencies.

## One-world renderer boundary

`GardenState` and `deriveWorldModel` remain the sole world/progression authority. `Renderer/src/render-style.ts` selects a compact `GardenVisualDirection`; it does not select another scene. Every premium profile preserves Twilight’s camera composition, foliage form, ground-layer count, object set, milestone gates, local-clock day phase, quality budgets, and fixed world-space lights.

Only one scene root is live. A rare user-initiated style switch removes and disposes the old visual projection before constructing the same topology with new materials; it never keeps parallel worlds or duplicates authoritative state. Reduce Motion continues to skip all camera, canopy, bird, and animal animation. Stop-motion additionally caps moving presentation at eight frames per second when motion is enabled.

## Entitlement and privacy boundary

The native StoreKit 2 client grants access only from verified transactions for the exact non-consumable product. It listens for transaction updates, supports explicit restore, refreshes on foreground, and uses `Transaction.currentEntitlements`, allowing previously verified ownership to resolve from StoreKit’s local entitlement cache while offline. An unverified, revoked, wrong-product, unavailable, pending, or failed result never grants access.

The selected style is protected device-local app setting data. No account, analytics, advertising, receipt upload, custom server, or renderer network request is introduced. Deleting app data resets the local selection to Twilight but does not erase App Store ownership; Restore Purchase can re-establish it.

## Native UI boundary

The selector lives in Settings, not on the Garden canvas. Tapping a locked style presents one restrained native paywall; owned styles switch directly. English and German copy ship together, locked state is not conveyed by color alone, and Twilight remains selectable regardless of StoreKit availability.

## Acceptance checks

- The free Twilight profile remains the default and unchanged fallback for unknown renderer input.
- Exactly four styles require one verified non-consumable entitlement.
- All five styles render the same milestones at dawn/day/dusk/night on phone and iPad proportions.
- Reset/left/right orbit preserves phase light positions, intensities, and exposure for every style.
- Reduce Motion freezes all scene life; stop-motion is also static under Reduce Motion.
- Style switching leaves one scene root and stable authoritative feature counts.
- App Store Connect, TestFlight, website, and release state remain untouched by this implementation.
