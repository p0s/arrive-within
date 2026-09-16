# Arrive Within app icon brief

Status: B — Quiet Threshold selected by the owner on 2026-08-10; corrected layered material source compiled locally on 2026-09-15; release packaging and owner review pending

## Meaning

A small intentional pause becomes a living inner sanctuary. The icon should feel calm and authored before it reads as “meditation software.”

## Symbol territory

Use one singular, recognizable gesture drawn from:

- a seed becoming a central tree or canopy;
- growth rings resolving into a quiet garden clearing;
- a restrained threshold opening toward living growth.

The icon is not a miniature garden scene. It must remain unmistakable at 40 px.

## Palette territory

- deep forest green;
- misted sage;
- warm mineral cream;
- one restrained dawn-amber accent;
- optional night indigo for Dark appearance.

Default, Dark, and Tinted must preserve the same core silhouette and semantic hierarchy.

## Prohibited motifs

- lotus, seated/yoga silhouette, brain, heart, zen-stone stack;
- dominant clock/timer, currency, flame, streak badge, trophy, or game token;
- photoreal tree, neon, glassmorphism, generic wellness gradient;
- Sakura/Japanese town identity, copied garden/product imagery;
- the first-party house-style reference's literal route, S-curve, arrow, dots, palette, or composition.

## Three required directions

Generate each direction in a separate `imagegen` call after the real Garden UI establishes the brand palette:

1. **Living Rings** — a central tree canopy/seed expressed through organic growth rings and one dawn accent.
2. **Quiet Threshold** — a simple open arch/clearing with living growth beyond it; no route or arrow geometry.
3. **Rooted Light** — a seed/root silhouette meeting a calm disc of light, emphasizing practice becoming growth.

Each call records exact prompt, timestamp, raw output, SHA-256, input roles, model/tool evidence, license/provenance, and review state. Surface all three together for explicit owner selection; do not infer a winner.

## Concept generation result — 2026-08-10

The three owner candidates are preserved under `docs/brand/provenance/2026-08-10/concept-board/`:

1. **A — Living Rings:** direct tree/canopy and organic growth-ring emblem.
2. **B — Quiet Threshold:** negative-space threshold revealing one living shoot.
3. **C — Rooted Light:** grounded rooted-seed base meeting one calm light disc.

All three were generated in separate built-in `image_gen` calls using a first-party house icon only as a material/lighting reference. The exact prompts, raw opaque RGB PNGs, timestamps, file and prompt hashes, input-role boundary, current OpenAI output-rights source, and selection state are recorded in `provenance.json`. Two intermediate C outputs are retained with explicit rejection reasons because they risked prohibited flame and person/seated-figure readings.

The owner verified “image 2” as **B — Quiet Threshold** and selected it on 2026-08-10. A and C remain preserved rejected-direction provenance. Run the pinned Node command documented by the root gate to verify the board and production records.

## Current production source

Three transparent material layers reproduce the selected B proportions and tactile surface. Their prompts, raw outputs, deterministic crop/placement transforms and checksums are in `provenance/2026-09-15/layers/`. The previous SVG package and exports remain byte-preserved in `legacy/2026-09-15/`.

The canonical package stores the sprout in front of the arch and warm inset. The preview generator reads the package's actual group order. Glass/specular/translucency settings are disabled for the matte artwork; see `APP_ICON_LAYER_PLAN.md` and ADR 0008.

`icon-build-validation.json` records current Apple asset compilation for phone and pad, including visible-sprout checks and opaque 1024 marketing renditions. `icon-status.json` separately retains historical build-1/build-7 archive facts; those do not certify this corrected source.

Current derived 1024/180/60/40 Default/Dark/Tinted previews have been visually inspected. Owner production review, complete app/archive, physical Home Screen, TestFlight and App Store readback remain pending. The installed Xcode 27 small compatibility PNGs include a platform mask with alpha, so the existing no-alpha release gate remains open. Local artwork verification does not waive it.

The current Icon Composer GUI opened without presenting an agreement. No agreement was accepted by the agent. Clear-mode runtime inspection remains pending.
