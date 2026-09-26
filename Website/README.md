# Arrive Within website

This directory is the canonical source for the bilingual, static Arrive Within website. The production host is the Vercel Hobby project `arrive-within`, with `https://arrivewithin.com` as its owner-controlled canonical origin.

## Local verification

Use the blueprint-pinned Node 26.7.0 and pnpm 11.20.0:

```sh
pnpm verify
pnpm test:browser
```

The dependency-free build writes ignored `dist/`, exact English/German home, support, privacy, and open-source routes, security headers, robots/sitemap files, a deterministic build manifest, eight provenance-bound actual-app UI images, three provenance-bound public-media assets, and the selected 40/180 px Quiet Threshold browser/touch identity assets. Its source identity excludes ignored `.env*`, `.vercel/`, dependency, and generated-output state so a clean public checkout hashes the same source bytes. The silent growth film is locally controlled, never autoplays, and uses the real deterministic renderer. Validation rejects source/output drift, missing routes, external runtime assets, scripts, forms outside the two privacy preference controls, browser analytics markers, unresolved links, inaccessible media, privacy-contract gaps, and changed asset hashes. The privacy page provides no-JavaScript opt-out and opt-in POST controls; Vercel Routing Middleware counts eligible public HTML document requests from a finite known-route allowlist and sends minimal server-side records when configured. Middleware cannot observe the downstream response status, so this is not a per-response HTTP 200 proof. Production middleware needs the server-only `ANALYTICS_SITE_HOSTNAME`, `ANALYTICS_INGEST_URL`, and `ANALYTICS_INGEST_TOKEN` variables; missing variables fail closed. The browser matrix fulfills requests directly from `dist/` without opening a listening socket and covers every route at 1440, 390, and 320 px, including icon loading, navigation exposure, 44 px link targets, reduced motion, and video seeking. Local verification uses the reserved non-routable origin `https://arrive-within.local.invalid`; a release deployment must set `ARRIVE_WITHIN_PUBLIC_BASE_URL` to the exact read-back production HTTPS origin.

After intentionally changing the selected canonical app icon outputs, run `pnpm sync:brand`. The synchronizer copies only the selected opaque Default 40/180 px files from `docs/brand/app-icon-derived/` and rewrites `src/assets/brand-provenance.json`; website validation rejects source/copy/output drift.

After intentionally regenerating the canonical public renderer media, run `node Marketing/PublicMedia/scripts/sync-website-media.mjs` from the repository root. The synchronizer copies only the three declared public-media files and rewrites their exact SHA-256 provenance; website validation then rejects any source/copy drift.

The video, poster, and social preview are first-party current-source renderer media, regenerated with external requests blocked. Owner visual review is pending; do not deploy these refreshed media until that review is complete. This is local product-media evidence, not physical-device, signed-candidate, App Store, or deployment proof.

After intentionally recapturing the canonical App Store UI source, run `node Marketing/AppStoreScreenshots/scripts/sync-website-ui.mjs` from the repository root. The synchronizer copies only the eight declared first-party UI images and rewrites their exact capture revision and SHA-256 provenance.

The current local site images are bound to App Store candidate 1.0.2 (build 19). Their owner visual review is pending; do not upload or deploy them until review is complete.

## Boundaries

- The site links to the verified public 1.0.1 listing at `https://apps.apple.com/app/id6800192697`. New app-version claims remain tied to their own exact storefront readback.
- The current local source includes the guided-first entry flow, recoverable local journal text drafts, and validation-first local restore from a user-selected complete archive. Restore keeps language, timer preferences, reminders, and permission choices on the device; journal data is uploaded only if the user deliberately exports and shares it.
- Deployment may target only the verified `arrive-within` Vercel Hobby project and owner-controlled `arrivewithin.com` domain. Unrelated domain, DNS, project, or account mutation remains unauthorized.
- The exact external links are the public source at `https://github.com/p0s/arrive-within` and live App Store listing at `https://apps.apple.com/app/id6800192697`; validation permits no other external website link.
