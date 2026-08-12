# Quiet Threshold layer plan

The canonical source is `Apps/ArriveWithin/Resources/AppIcon.icon/`. It translates the owner-selected B composition into three independently editable SVG layers over the Icon Composer background fill.

| Back-to-front group | Layer | Meaning | Editable decisions |
| --- | --- | --- | --- |
| Inner sanctuary | Warm interior | A calm mineral opening with restrained dawn warmth | arch aperture, cream/amber balance, matte texture, depth |
| Quiet threshold | Forest threshold | One still architectural boundary around the interior | outer/inner arch geometry, forest palette, safe margin, relief |
| Growth | Living shoot | One compact two-leaf sign of practice becoming growth | leaf silhouette, stem height, green palette, alignment |

The background fill is misted sage. Each SVG uses simple paths and bounded matte relief; no text, canvas mask, route, arrow, dots, proprietary geometry, or uncertain-rights source is embedded. The image-generation refinement is a visual target only. The canonical output is rendered from these named layers by `scripts/generate_app_icon_assets.mjs`.

The first generated canonical preview was rejected before freeze because its texture introduced chromatic noise. A second preview was rejected because the stem extended below the threshold base and weakened the selected geometry. The current source uses monochrome low-opacity texture and aligns the shoot with the threshold baseline.
