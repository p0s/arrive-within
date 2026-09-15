# Quiet Threshold layer plan

The canonical source is `Apps/ArriveWithin/Resources/AppIcon.icon/`. It preserves the selected B composition with separately editable transparent PNG materials. The earlier procedural SVG source and its exports are byte-preserved under `docs/brand/legacy/2026-09-15/`.

| Back to front | Source | Meaning and geometry |
| --- | --- | --- |
| Background | `icon.json` solid fill | Pale sage field; no baked icon mask |
| Inner sanctuary | `threshold-interior.png` | Warm arched inset, extending behind the threshold |
| Quiet threshold | `threshold-arch.png` | Broad dark forest arch with a soft matte surface |
| Growth | `living-shoot.png` | Two broad leaves and short stem aligned with the threshold baseline |

**Icon Composer serializes groups frontmost first.** The JSON order is Growth, Quiet threshold, Inner sanctuary. The Sharp preview reads that order and reverses it for back-to-front composition. An independent hardcoded preview order previously concealed the reversed Apple stack.

The surface texture and subtle bevels are material artwork. Glass and specular effects are explicitly disabled and group translucency is off so the original colors remain visible. Group shadow strength and canvas fill remain editable in Icon Composer. Foreground layers contain no background or platform mask.

`scripts/prepare_app_icon_layers.mjs` reproduces normalized 1024 RGBA layers from three preserved raw images with recorded crop and placement parameters. `scripts/generate_app_icon_assets.mjs` derives opaque marketing previews at 1024, 180, 60, and 40 pixels. Dark and Tinted previews are deterministic marketing variants; they do not prove a system Home Screen appearance.

`scripts/record_app_icon_compilation.mjs` invokes Apple's asset compiler, inspects Light/Dark/Tintable stacks and opaque 1024 marketing renditions, and checks that phone and pad compatibility previews retain the green sprout. Proof is bound to the current source hash. Full app/archive, runtime appearance, owner approval, and distribution remain separate gates.
