# Arrive Within website

This directory is the canonical source for the bilingual, static Arrive Within website. Production uses Cloudflare Workers Static Assets, worker `arrivewithin-web`, with `https://arrivewithin.com` as its canonical origin. `edge/wrangler.toml` binds the existing account and apex/www Custom Domains; the previous Vercel Hobby project is a rollback artifact, not the production build target.

## Local verification

Use the blueprint-pinned Node 26.7.0 and pnpm 11.20.0:

```sh
pnpm verify
pnpm test:browser
```

The dependency-free build writes ignored `dist/`, eight English/German home, support, privacy, and open-source routes, security headers, robots/sitemap files, and a deterministic build manifest. Its source identity excludes ignored `.env*`, `.vercel/`, dependency, and generated-output state so a clean public checkout hashes the same source bytes. The stylesheet URL includes its SHA-256 so changed styles bypass the existing immutable browser cache. The silent growth film has native playback controls, no autoplay, and a visible bilingual description of its visual information. No speech captions are needed: the preserved film has one H.264 video stream and no audio stream.

Website output uses the exact already-public film, eight app UI images, poster, and social preview in `published-media/`. `published-media/binding.json` records their canonical public readback and binds the original public provenance by SHA-256. The pending-review refreshed originals in `src/assets/` remain unchanged and are excluded from output. Validation independently checks their canonical source hashes, the public snapshot, every output media hash, and all 31 responsive WebP derivatives; negative tests reject changed films, pending-source derivatives, and even unused pending originals in `dist/`. The selected 40/180 px Quiet Threshold icons retain their canonical provenance and use width-aware requests.

After intentionally updating a reviewed public media snapshot, run `pnpm sync:responsive`. This reuses Sharp 0.35.3 from the existing `Marketing/AppStoreScreenshots` toolchain, preserves aspect ratios, and records original/derivative hashes and the CC BY 4.0 transformation attribution in `src/assets/responsive-provenance.json`. It does not add a dependency or contact a server. Keep the snapshot and its derivatives together; never promote a pending-review original through this command.

Validation rejects source/output drift, missing routes, external runtime assets, scripts, forms outside the two privacy preference controls, browser analytics markers, unresolved links, inaccessible media, privacy-contract gaps, and changed asset hashes. The privacy page provides no-JavaScript opt-out and opt-in POST controls. The existing Cloudflare Worker counts only allowlisted HTML requests after its static asset binding returns HTTP 200; absent server-only ingest secrets fail closed. This website change adds no instrumentation or credential/configuration requirement.

The browser matrix fulfills requests directly from `dist/` without a listening socket and covers every route at 1440, 390, and 320 px, plus high-density mobile homes, including image selection, label contrast, keyboard preview controls, navigation exposure, 44 px link targets, reduced motion, and video seeking. Generated reports and screenshots stay ignored in `.evidence/website/` at the repository root. Local verification uses `https://arrive-within.local.invalid`; deployment must set `ARRIVE_WITHIN_PUBLIC_BASE_URL=https://arrivewithin.com`. The Wrangler build hook runs `pnpm verify:edge` with that canonical origin. Run `pnpm test:browser` before the separate authorized deployment.

After intentionally changing the selected canonical app icon outputs, run `pnpm sync:brand`. The synchronizer copies only the selected opaque Default 40/180 px files from `docs/brand/app-icon-derived/` and rewrites `src/assets/brand-provenance.json`; website validation rejects source/copy/output drift.

After intentionally regenerating the canonical public renderer media, run `node Marketing/PublicMedia/scripts/sync-website-media.mjs` from the repository root. The synchronizer copies only the three declared public-media files and rewrites their exact SHA-256 provenance; website validation then rejects any source/copy drift.

The refreshed video, poster, and social preview in `src/assets/` are first-party current-source renderer media, regenerated with external requests blocked. Owner visual review remains pending; do not deploy those refreshed media until that review is complete. They are preserved for the existing app/media owner and do not enter this website build.

After intentionally recapturing the canonical App Store UI source, run `node Marketing/AppStoreScreenshots/scripts/sync-website-ui.mjs` from the repository root. The synchronizer copies only the eight declared first-party UI images and rewrites their exact capture revision and SHA-256 provenance.

The refreshed local images in `src/assets/` are bound to App Store candidate 1.0.2 (build 19). Their owner visual review remains pending; do not upload or deploy them until review is complete. The production website candidate instead preserves the previously-public reviewed images. Website rendering does not verify a new app candidate or grant App Store upload authority.

## Boundaries

- The site links to the verified public 1.0.1 listing at `https://apps.apple.com/app/id6800192697`. New app-version claims remain tied to their own exact storefront readback.
- The current local source includes the guided-first entry flow, recoverable local journal text drafts, and validation-first local restore from a user-selected complete archive. Restore keeps language, timer preferences, reminders, and permission choices on the device; journal data is uploaded only if the user deliberately exports and shares it.
- Deployment may target only the existing `arrivewithin-web` Cloudflare Worker and owner-controlled `arrivewithin.com` apex/www domains. Unrelated domain, DNS, project, or account mutation remains unauthorized.
- The exact external links are the public source at `https://github.com/p0s/arrive-within` and live App Store listing at `https://apps.apple.com/app/id6800192697`; validation permits no other external website link.
