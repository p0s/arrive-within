# Garden world contract

The Garden is one authored living place whose atmosphere and ecology make practice visible. It is not a prop collection, a miniature theme park, or a placement game.

## Visual thesis

A hand-painted twilight garden grows from a quiet clearing into a sheltered living refuge: one persistent tree remains the hero, water and stone lead the eye, a distant open timber pavilion anchors the horizon, and sparse wildlife makes maturity feel inhabited rather than decorated.

The composition has four depth layers:

1. **Hero clearing** — the persistent tree, roots, and permanent micro-growth carry the strongest silhouette and light.
2. **Garden path** — stones, undergrowth, stream, and pond make a calm visual route around the tree without becoming navigation chrome.
3. **Living edge** — grass, birds, and ground wildlife appear only when the ecology can support them. They are discoveries, never rewards to collect.
4. **Distant refuge** — sky, mist, moon, and the mature pavilion close the scene without competing with the tree.

Every addition must strengthen at least one of those layers. Decorative objects that do not clarify place, growth, time, or ecological maturity do not enter the scene.

## Architectural language

The mature structure is an original **open garden pavilion**, called the sanctuary in progression data. It is secular architecture, not a temple or a composite religious monument.

- Use a low single-storey silhouette, broad sheltering eaves, an unpainted timber frame, a mineral plinth, open sides, and one warm interior plane.
- Keep the pavilion small, off-axis, and partly nested into the garden edge so the central tree remains dominant.
- Let construction logic and proportion carry the East-Asian garden influence.
- Do not use torii, pagoda tiers, shrine gates, shoji screens, dragon or guardian figures, red-and-gold palace color, roof charms, calligraphy, religious statuary, or culture-specific sacred ornament.
- Do not describe the pavilion with spiritual, historical, or cultural claims the product cannot support.

This boundary avoids a vague mixture of Japanese and Chinese symbols while retaining the calm roof rhythm, timber craft, and garden relationship requested for the world.

## Local time and sky

Swift derives one local presentation phase from the device clock and sends it through `GardenState`. No network, location, weather service, or JavaScript clock owns this state.

| Local phase | Hours | Atmosphere |
|---|---:|---|
| Dawn | 05:00–07:59 | cool indigo above a restrained peach-mineral horizon |
| Day | 08:00–16:59 | misted blue-sage sky, clearer water, quieter amber fill |
| Dusk | 17:00–19:59 | deepening violet with a warm low horizon and lengthened silhouettes |
| Night | 20:00–04:59 | night indigo, cool ambient light, warm refuge accents, and stronger celestial contrast |

Time changes presentation only. It never changes progress, unlocks, event truth, or the deterministic form of the tree. A garden recreated from the same authoritative state and local phase must reproduce the same scene.

The authored sun, hemisphere ambience, warm fill, fog, tone-mapping exposure, and sky field remain fixed in world space for a phase. Orbiting changes only the viewpoint; it must never move a light with the camera or recalculate exposure from camera position.

The sky uses a restrained multi-band atmospheric field, a soft off-axis celestial glow, low horizon haze, and authored cloud banks. Night is a true palette and lighting change, not a dark overlay. Stars remain a Space I unlock and the moon remains a Space II unlock, so an early garden can be nocturnal without pretending that later celestial milestones are already earned.

## Progression ecology

The existing fifteen milestones remain the only progression authority.

- **Earth I–III:** establish roots, path, moss, ferns, and ground texture.
- **Water I–III:** connect dew, stream, pond, ripples, and water-edge life.
- **Fire I–III:** add warm vitality, restrained fireflies, lantern-like light, and blossoms without destructive flame.
- **Air I:** make the established vegetation respond to wind.
- **Air II:** add a small deterministic flock plus drifting leaves. Birds cross and settle around the scene; they do not orbit like UI decoration.
- **Air III:** enrich cloud banks, haze, and broad atmospheric movement.
- **Space I–II:** reveal stars, then moonlight, only when those milestones are unlocked and the local phase makes them legible.
- **Space III:** complete the distant pavilion and add two quiet grass hares as signs of a safe mature habitat.

After day 30, practice may vary posture, path, or rare timing of living moments within strict bounds. It must not multiply animals indefinitely or turn wildlife into a collectible catalogue.

## Motion thesis

Motion should make the garden feel present while preserving calm:

- canopy and grass share one low-amplitude wind rhythm;
- water carries a slower independent shimmer;
- birds use long paths with sparse wing beats and no sudden camera-facing passes;
- hares breathe or move an ear occasionally but do not hop around the focal clearing;
- day-phase changes use direct color/light updates rather than theatrical time-lapse;
- milestone growth remains the only prominent reveal.

Reduced Motion freezes birds and ground animals in readable authored poses, removes camera/parallax movement, and retains only direct state changes or short fades. Rendering stops when the Garden is inactive or backgrounded.

## Quality and accessibility

Quality tiers reduce effects in this order: particles, birds and ground-wildlife density, background grass, cloud detail, water complexity, then secondary shadows. At least one readable wildlife silhouette may remain at low quality after its milestone; the hero tree, pavilion silhouette, progress, and local-time legibility never disappear.

Wildlife and atmosphere are never required to understand progress. The native Garden description remains authoritative accessibility equivalence and names mature ecological/architectural features without requiring visual inspection. Color alone never distinguishes day phase or milestone state in product UI.

## Acceptance checks

- The same `GardenState`, local phase, quality, and customization produce the same world plan.
- Dawn, day, dusk, and night resolve to visibly distinct sky and lighting models.
- Stars and moon remain milestone-gated; local night does not bypass progression.
- Birds are absent before Air II and present from Air II onward within the quality budget.
- The pavilion and grass hares are absent before Space III and appear together in the complete living world.
- The pavilion contains no prohibited religious or culture-specific symbol and never overtakes the tree silhouette.
- Reduced Motion produces a static, complete composition with no loss of state meaning.
- Representative phone, iPad portrait, and iPad landscape renders preserve the tree, pavilion, celestial field, wildlife, existing native overlays, and Meditate action without clipping or visual competition.
- Rendered reset/left/right orbit comparisons retain the same light and exposure model without the earlier camera-relative facet-lighting regression.
- The renderer remains local-only, uses no uncertain-rights asset, and degrades wildlife before hero-tree quality.
