# ADR 0008: Preserve icon material and verify Apple layer order

Status: Accepted for local implementation; release packaging remains gated.

## Problem

The procedural SVG reconstruction changed the selected Quiet Threshold proportions and tactile material. A second defect made the custom preview misleading: it drew the interior first, while the Icon Composer document placed that same group first in its front-to-back stack. Apple's compiler therefore put the warm inset over the sprout. Default glass effects further reduced color fidelity.

## Decision

Retain the selected composition and the canonical three-layer `.icon` package. Use separately generated transparent PNG material layers, normalized to the selected geometry with reproducible transformations. Preserve the old source and exports and record every new prompt, raw output and hash.

Store the document front to back: sprout, threshold, interior. Derive preview order directly from the document. Disable glass, specular and translucency effects for the matte artwork using the schema saved by the installed Icon Composer GUI.

Validate Apple's compiled phone and pad previews in addition to source previews. Assert a visible green sprout within the aperture, verify the compiled appearance stacks, and bind evidence to the exact source hash.

## Validation and release boundary

Current evidence lives in `docs/brand/icon-build-validation.json` and `docs/brand/compiled/2026-09-15/`. The installed Xcode 27 asset compiler emits masked RGBA small compatibility PNGs while its 1024 marketing renditions remain opaque RGB. Preserve those actual output facts. The existing no-alpha compatibility release gate is retained; `validate_app_icon.mjs --local-preview` verifies the artwork without claiming that release gate passed. A release-toolchain rebuild or explicit resolution of the archive format remains necessary before distribution.

The contact sheet's Dark/Tinted variants are marketing previews. Physical Home Screen appearances, a complete app/archive, owner production approval, and App Store display have separate evidence requirements.
