# Garden-first responsive shell

Status: Implemented and focused physical iPad proof passed; exact-candidate and broader accessibility/performance closure remain separate

## Decision

Garden is the home surface, not a card inside product chrome. Its bundled Three.js renderer fills the available phone or tablet canvas. A compact day/stage capsule, quiet Settings control, dominant Meditate action, and the four native product destinations overlay that world without obscuring the central composition.

On compact width, the existing native tab bar remains the four-root navigation authority and its material overlays the canvas. On regular width, Garden collapses `NavigationSplitView` to the detail surface and presents the same four destinations in one native floating row. Selecting Practice, Journey, or Journal restores the sidebar; selecting Garden restores the full-canvas world. Settings moves from a title toolbar into the Garden overlay. Other destinations keep normal native titles and Settings access.

There is no user-facing 2D/3D mode. The bundled 3D world is the default; the native view activates automatically only when renderer recovery requires it. The old “3D” camera-reset badge, separate Garden title bar, and visible description sheet are removed. The renderer and native fallback still expose the deterministic Garden summary as their VoiceOver value, so visual simplification does not remove semantic access.

Settings links directly to the published bilingual Support and Privacy pages. The former in-app “Private by design / Privacy at a glance” explainer and manual native-renderer switch are removed; privacy behavior remains enforced by the binary, manifest, data-flow contract, and public policy rather than repeated as a settings card.

## Focused proof

- English/German localization validation passes with exact key parity after the surface reduction.
- A generic iOS Simulator Debug build compiles with warnings treated as errors.
- On the authorized physical iPad Pro 13-inch (M4), iPadOS 26.6, the exact focused current-source test passes 1/1 with zero failures or skips.
- Retained portrait and landscape frames visibly show the full-canvas Three.js Garden, compact status, quiet Settings, Meditate, and four-destination overlay; the old title/sidebar/3D/description controls are absent.
- The same test opens Settings and confirms the language control plus direct Privacy and Support controls. The app and automation runner are absent from the device process list after completion.

## Claim boundary

This proves the focused current-source layout on one physical iPad. It is not TestFlight or App Store proof for the post-build-4 source, and it does not close phone visuals, every Dynamic Type size, VoiceOver user review, pointer, Stage Manager resizing, sustained renderer performance, or human design approval.
