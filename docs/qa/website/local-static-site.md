# Bilingual static website — local verification

Date: 2026-08-13
Status: current Garden media refreshed and locally verified; deployment readback remains separate

## Artifact

- Canonical source: `Website/`
- Verified target: the existing Vercel Hobby project named `arrive-within`, with the owner-authorized canonical `arrivewithin.com` origin; deployment and DNS/TLS are verified by credential-free readback
- Routes: `/`, `/de`, `/support`, `/de/support`, `/privacy`, `/de/privacy`, `/open-source`, `/de/open-source`
- Runtime policy: static HTML/CSS with local images and one controlled, silent local MP4; no JavaScript, autoplay, form, analytics, tracking, cookie, account, newsletter, or remote runtime asset
- Actual-UI media: eight first-party build-6 captures from the pooled iPhone simulator and authorized physical iPad, bound to capture source revision `720deeed8719b680ebe4359e1f572565780cc1015ce4ab0d83cb530335bfb405`, plus deterministic renderer-derived garden video, poster, and social preview bound by `Website/src/assets/provenance.json`

## Deterministic build

The exact Node 26.7.0 runtime ran the dependency-free build and validation scripts directly and successfully; the installed project package state remains pinned by the pnpm 11.20.0 lockfile, and this verification performed no dependency resolution.

- Source tree SHA-256: `258ffde1474acd4ee178db84e4ab465f9a9f3f5914a5a7cce00c829693928c5c`
- Content SHA-256: `8bd645d39e8d880cfa9b48afd1b9685111f6db4bdcbc3304fd34fc47f49982ab`
- Complete 28-file build SHA-256: `8824c79da5d3955e34a63e5c74028f09a9969064ed1b8b16c489b5bf9506ca0c`
- The production-origin build passed the deterministic validator and all eight route bodies read back byte-for-byte from `arrivewithin.com`.
- The validator passed exact route/link, injected-origin canonical/hreflang, landmark, local-image/alt, local-video/control, provenance/hash, privacy-copy, no-active-content, no-tracking, no-external-runtime-asset, and Vercel security-header checks.

## Rendered review

The current-source production-origin build was served only on loopback and inspected through a real browser at desktop `1440×1000` and mobile `390×844` dimensions.

- The reproducible report is `docs/qa/website/browser-matrix.json`.
- All 24 route/viewport combinations had one main landmark, one H1, the correct document language, a visible footer, local images with nonempty alt text, and no horizontal overflow.
- English-to-German and German-to-English navigation completed with the expected localized title and H1.
- Browser console warning/error count: 0.
- External request count: 0; every non-loopback request would have been blocked and failed the matrix.
- All four home-page viewport/language cases loaded the 1280×720, 9.733-second video metadata and sought to a decoded five-second frame while remaining paused; controls were present and autoplay was absent.
- Representative English desktop hero, growth, Timer/Stopwatch mode choice, and German mobile article layouts were visually inspected.
- Review found a 15-point overflow in the German mobile open-source heading. The fix uses German-only automatic hyphenation with safe word wrapping; the full 24-case matrix then passed. English heading hyphenation is explicitly disabled.

## Retained production media

After the Garden refinement merged, the renderer-derived Garden video, poster, and social preview were regenerated from the current Twilight source with external requests blocked and synchronized into `Website/src/assets`. The refreshed poster visibly includes the open timber pavilion, mature tree silhouette, sparse hares/birds, water, and balanced sky. This is local product-media evidence; it is not physical-device, signed-candidate, App Store, or deployment proof.

## Unreleased brand and visual successor

The 2026-08-13 website polish replaces the generic dot with exact byte copies of the selected B — Quiet Threshold 40 px and 180 px opaque RGB assets. The mark is now visible in the header/footer and linked as the browser favicon and Apple touch icon, with separate public-safe source/hash/trademark provenance. The home hero becomes one full-canvas garden composition with product-first hierarchy; mobile navigation keeps all destinations exposed in a bounded horizontal row; visible links receive 44-point minimum targets; CSS-only entrance, depth, and hover motion disable under Reduce Motion. English/German repository copy now reflects the independently read-back public canonical repository while retaining the no-App-Store-availability boundary.

The current local build with exact Node 26.7.0 was validated after the current Garden media refresh:

- Source tree SHA-256: `258ffde1474acd4ee178db84e4ab465f9a9f3f5914a5a7cce00c829693928c5c` across the current public source files; ignored environment, host-binding, dependency, and generated-output files are excluded.
- Content SHA-256: `8bd645d39e8d880cfa9b48afd1b9685111f6db4bdcbc3304fd34fc47f49982ab`
- Complete 28-file build SHA-256: `8824c79da5d3955e34a63e5c74028f09a9969064ed1b8b16c489b5bf9506ca0c`
- Static validation: passed for eight routes, eleven product/media assets, two selected brand icons, local-only runtime assets, bilingual metadata, CSP, privacy copy, and provenance/hash integrity.
- Rendered matrix: refreshed in this execution. The pinned Playwright browser completed all 24 route/viewport cases, six video load/seek cases, reduced-motion checks, visible icon checks, 44px link targets, and zero external requests.
- Deployment/public readback: not performed and not authorized by this website-edit request.

## Claim boundary

The deployed-artifact evidence proves the deterministic, public-safe refreshed website artifact, the existing Vercel Hobby project binding, `arrivewithin.com` DNS/TLS, eight production routes, and the three current Twilight media assets. Public-repository availability is proven separately by credential-free GitHub readback. Neither that evidence nor the unreleased local successor proves App Store availability, production narration, or a later signed release candidate. No domain purchase, registration, unrelated project, or unrelated DNS mutation was performed.

The eight app-UI images remain synchronized to capture revision `720deeed8719b680ebe4359e1f572565780cc1015ce4ab0d83cb530335bfb405`; the renderer-derived media is now byte-bound to current renderer source `e001e54e6cbecd30a8080dd5e3f9014650bcc253ca28cbe86c27185b231fc284`. App-UI screenshots and renderer-media evidence remain separate claims.
