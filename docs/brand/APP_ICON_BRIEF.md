# Arrive Within app icon brief

Status: B — Quiet Threshold selected by the owner on 2026-08-10; canonical local production source compiled

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

## Production result

1. The image-generation refinement is preserved as a visual target with its prompt, input roles, timestamp, rights state, and hashes.
2. `Apps/ArriveWithin/Resources/AppIcon.icon/` is the canonical three-layer source: warm interior, forest threshold, and living shoot.
3. `scripts/generate_app_icon_assets.mjs` deterministically derives opaque Default/Dark RGB and Tinted grayscale artifacts at 1024, 180, 60, and 40 px.
4. The contact sheet passed agent visual inspection for semantic fidelity, safe margin, color-independent recognition, and small-size legibility after two pre-freeze corrections.
5. An unsigned generic iOS Release build compiled the Icon Composer source for both phone and pad and emitted Any, Dark, and Tintable icon stacks plus opaque phone and iPad compatibility PNGs.
6. The exact baseline 1.0 (1) and selected 1.0 (7) archives contain `AppIcon60x60@2x` at 120×120 and `AppIcon76x76@2x~ipad` at 152×152. Both inspect as RGB with no alpha. Their SHA-256 values and each archive's compiled `Assets.car` hash are recorded in `icon-status.json`; build 7 preserves the compatibility-icon hashes and has asset-catalog SHA-256 `8092fd3e0dfef7008fc80263079faec3694985abcf8d815d783528a26863cf7f`. This closes selected-candidate archive packaging, not visual Home Screen/TestFlight/App Store, publication, or trademark readback.

The first Icon Composer GUI launch presented an Apple EULA. Accepting it is an owner-only legal action, so GUI-only Clear Light/Clear Dark inspection remains blocked on that acceptance. The package itself compiles without a fallback. Selected-final archive, simulator-home-screen, physical, TestFlight icon-display, and App Store evidence remain distinct and unclaimed.
