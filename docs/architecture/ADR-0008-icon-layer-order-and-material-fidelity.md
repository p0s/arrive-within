# ADR 0008: Preserve icon material and verify Apple layer order

Status: Accepted; source-level validation now checks transparency rather than PNG channel encoding. Complete app/archive, owner, device, and store review remain separate.

## Problem

The procedural SVG reconstruction changed the selected Quiet Threshold proportions and tactile material. A second defect made the custom preview misleading: it drew the interior first, while the Icon Composer document placed that same group first in its front-to-back stack. Apple's compiler therefore put the warm inset over the sprout. Default glass effects further reduced color fidelity.

## Decision

Retain the selected composition and the canonical three-layer `.icon` package. Use separately generated transparent PNG material layers, normalized to the selected geometry with reproducible transformations. Preserve the old source and exports and record every new prompt, raw output and hash.

Store the document front to back: sprout, threshold, interior. Derive preview order directly from the document. Disable glass, specular and translucency effects for the matte artwork using the schema saved by the installed Icon Composer GUI.

Validate Apple's compiled phone and pad previews in addition to source previews. Assert a visible green sprout within the aperture, verify the compiled appearance stacks, and bind evidence to the exact source hash.

## Validation and release boundary

Current evidence lives in `docs/brand/icon-build-validation.json` and `docs/brand/compiled/2026-09-15/`. Xcode 27 emits RGBA small compatibility PNGs, but inspection of every pixel finds alpha 255 throughout and zero transparent pixels; its 1024 marketing renditions are opaque RGB. The release validator therefore accepts an alpha channel only when all decoded pixels are opaque, matching Apple's published app-icon guidance that an alpha channel is allowed but transparent regions are not ([Technical Q&A QA1686](https://developer.apple.com/library/archive/qa/qa1686/_index.html)). The validator independently decodes the checksum-bound compatibility PNGs and counts transparent pixels; this replaces the earlier over-strict channel-presence check.

The contact sheet's Dark/Tinted variants are marketing previews. Physical Home Screen appearances, a complete app/archive, owner production approval, and App Store display have separate evidence requirements.
