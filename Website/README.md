# Arrive Within website

This directory is the canonical source for the bilingual, static Arrive Within website. The production host is the Vercel Hobby project `arrive-within`, with `https://arrivewithin.com` as its owner-controlled canonical origin.

## Local verification

Use the blueprint-pinned Node 26.7.0 and pnpm 11.20.0:

```sh
pnpm verify
pnpm test:browser
pnpm review:seo
```

The dependency-free build writes ignored `dist/`, exact English/German home, support, privacy, and open-source routes, security headers, robots/sitemap files, supported WebSite/organization/application/breadcrumb JSON-LD, a deterministic build manifest, eight provenance-bound actual-app UI images, three provenance-bound public-media assets, and the selected 40/180 px Quiet Threshold browser/touch identity assets. Its source identity excludes ignored `.env*`, `.vercel/`, dependency, and generated-output state so a clean public checkout hashes the same source bytes. The silent growth film is locally controlled, never autoplays, and uses the real deterministic renderer. Validation rejects source/output drift, missing routes, external runtime assets, executable scripts/forms, invented application claims, analytics/tracking markers, unresolved links, inaccessible media, privacy-contract gaps, and changed asset hashes. The browser matrix fulfills requests directly from `dist/` without opening a listening socket and covers every route at 1440, 390, and 320 px, including canonical/hreflang/schema/breadcrumb parity, icon loading, navigation exposure, 44 px link targets, reduced motion, and video seeking. `review:seo` also writes a compact route matrix and six representative review screenshots under `docs/qa/website/seo-review-2026-08-28/`. Local verification uses the reserved non-routable origin `https://arrive-within.local.invalid`; a release deployment must set `ARRIVE_WITHIN_PUBLIC_BASE_URL` to the exact read-back production HTTPS origin.

After intentionally changing the selected canonical app icon outputs, run `pnpm sync:brand`. The synchronizer copies only the selected opaque Default 40/180 px files from `docs/brand/app-icon-derived/` and rewrites `src/assets/brand-provenance.json`; website validation rejects source/copy/output drift.

After intentionally regenerating the canonical public renderer media, run `node Marketing/PublicMedia/scripts/sync-website-media.mjs` from the repository root. The synchronizer copies only the three declared public-media files and rewrites their exact SHA-256 provenance; website validation then rejects any source/copy drift.

The video, poster, and social preview are first-party current-source renderer media. They were regenerated with external requests blocked and visually reviewed for the pavilion, mature tree silhouette, sparse wildlife, water, and sky balance. This is local product-media evidence, not physical-device, signed-candidate, App Store, or deployment proof.

After intentionally recapturing the canonical App Store UI source, run `node Marketing/AppStoreScreenshots/scripts/sync-website-ui.mjs` from the repository root. The synchronizer copies only the eight declared first-party UI images and rewrites their exact capture revision and SHA-256 provenance.

## Boundaries

- The official country-neutral `https://apps.apple.com/app/id6800192697` URL visibly resolved to the public Arrive Within listing on 28 August 2026. The bilingual CTA and application schema use only that verified availability, free-price, device, language, category, and minimum-OS evidence; no rating, review, release-date, or exact-build claim is emitted.
- This local source change is not website deployment proof. Storefront availability also remains separate from repository evidence for the exact submitted binary.
- The current local source matches the repository-recorded build-16 Guided, Timer, Stopwatch, and local-only data scope. Its Guided correction is not deployment proof; the older deployed artifact remains bound to its own exact readback evidence, and future CloudKit work retains a separate external boundary.
- Deployment may target only the verified `arrive-within` Vercel Hobby project and owner-controlled `arrivewithin.com` domain. Unrelated domain, DNS, project, or account mutation remains unauthorized.
- The exact public source link is `https://github.com/p0s/arrive-within`; validation permits no other external website link.
