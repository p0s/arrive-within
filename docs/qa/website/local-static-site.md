# Bilingual static website — local verification

Date: 2026-08-13, with a 2026-08-24 local-source correction
Status: the exact deployed artifact remains preserved; current Guided-aware local source is verified but not deployed

## Artifact

- Canonical source: `Website/`
- Verified target: the existing Vercel Hobby project named `arrive-within`, with the owner-authorized canonical `arrivewithin.com` origin; deployment and DNS/TLS are verified by credential-free readback
- Routes: `/`, `/de`, `/support`, `/de/support`, `/privacy`, `/de/privacy`, `/open-source`, `/de/open-source`
- Runtime policy: static HTML/CSS with local images and one controlled, silent local MP4; no JavaScript, autoplay, form, analytics, tracking, cookie, account, newsletter, or remote runtime asset
- Actual-UI media: eight first-party build-6 captures from the pooled iPhone simulator and authorized physical iPad, bound to capture source revision `720deeed8719b680ebe4359e1f572565780cc1015ce4ab0d83cb530335bfb405`, plus deterministic renderer-derived garden video, poster, and social preview bound by `Website/src/assets/provenance.json`

## Deployed artifact deterministic record

For the 2026-08-13 deployed artifact, exact Node 26.7.0 ran the dependency-free build and validation scripts directly and successfully; the installed project package state remains pinned by the pnpm 11.20.0 lockfile, and that verification performed no dependency resolution.

- Source tree SHA-256: `f87034ba7bbad7e9fdd51485a2f9ed02a2f4f103fa15e9632fab42950d6a237d`
- Content SHA-256: `c0facf9f554a2690b01d3575456c02a44d72f4f3b7b75d348b4b9fba43ebc812`
- Complete 25-file build SHA-256: `59430428d7124fc08b6fb3d155f22eb8e63d56aafd1c9240cb0bfcb3486cc951`
- The production-origin build passed the deterministic validator and all eight route bodies read back byte-for-byte from `arrivewithin.com`.
- The validator passed exact route/link, injected-origin canonical/hreflang, landmark, local-image/alt, local-video/control, provenance/hash, privacy-copy, no-active-content, no-tracking, no-external-runtime-asset, and Vercel security-header checks.

## 2026-08-13 local successor rendered review

The then-current local successor was served only on loopback and inspected through a real browser at desktop `1440×1000`, mobile `390×844`, and compact `320×700` dimensions.

- The report path is `docs/qa/website/browser-matrix.json`; Git history preserves this 2026-08-13 run, while the current file records the 2026-08-24 successor check.
- All 24 route/viewport combinations had one main landmark, one H1, the correct document language, a visible footer, local images with nonempty alt text, and no horizontal overflow.
- English-to-German and German-to-English navigation completed with the expected localized title and H1.
- Browser console warning/error count: 0.
- External request count: 0; every non-loopback request would have been blocked and failed the matrix.
- All six home-page viewport/language cases loaded the 1280×720, 9.733-second video metadata and sought to a decoded five-second frame while remaining paused; controls were present and autoplay was absent.
- Representative English desktop hero, growth, Timer/Stopwatch mode choice, and German mobile article layouts were visually inspected.
- Review found a 15-point overflow in the German mobile open-source heading. The fix uses German-only automatic hyphenation with safe word wrapping; the full 24-case matrix then passed. English heading hyphenation is explicitly disabled.

## Retained production media

After the Garden refinement merged, the renderer-derived Garden video, poster, and social preview were regenerated from the current Twilight source with external requests blocked and synchronized into `Website/src/assets`. The refreshed poster visibly includes the open timber pavilion, mature tree silhouette, sparse hares/birds, water, and balanced sky. This is local product-media evidence; it is not physical-device, signed-candidate, App Store, or deployment proof.

## Historical unreleased brand and visual successor

The 2026-08-13 website polish replaces the generic dot with exact byte copies of the selected B — Quiet Threshold 40 px and 180 px opaque RGB assets. The mark is now visible in the header/footer and linked as the browser favicon and Apple touch icon, with separate public-safe source/hash/trademark provenance. The home hero becomes one full-canvas garden composition with product-first hierarchy; mobile navigation keeps all destinations exposed in a bounded horizontal row; visible links receive 44-point minimum targets; CSS-only entrance, depth, and hover motion disable under Reduce Motion. English/German repository copy now reflects the independently read-back public canonical repository while retaining the no-App-Store-availability boundary.

The 2026-08-13 local build with exact Node 26.7.0 was validated after the Garden media refresh:

- Source tree SHA-256: `258ffde1474acd4ee178db84e4ab465f9a9f3f5914a5a7cce00c829693928c5c` across the current public source files; ignored environment, host-binding, dependency, and generated-output files are excluded.
- Content SHA-256: `8bd645d39e8d880cfa9b48afd1b9685111f6db4bdcbc3304fd34fc47f49982ab`
- Complete 28-file build SHA-256: `8824c79da5d3955e34a63e5c74028f09a9969064ed1b8b16c489b5bf9506ca0c`
- Static validation: passed for eight routes, eleven product/media assets, two selected brand icons, local-only runtime assets, bilingual metadata, CSP, privacy copy, and provenance/hash integrity.
- Rendered matrix: at that stage, the pinned Playwright browser completed all 24 route/viewport cases, six video load/seek cases, reduced-motion checks, visible icon checks, 44px link targets, and zero external requests.
- Deployment/public readback: not performed and not authorized by this website-edit request.

## Current Guided local successor

The 2026-08-24 complete-codebase review corrected the local English/German home and support copy from the historical Timer/Stopwatch-only state to the repository-recorded build-16 product: 42 original bilingual Guided practices with approved narration and bound transcripts packaged for offline playback, alongside Timer and Stopwatch. The mode layout now presents all three choices without changing the static/no-tracking runtime boundary.

- Source tree SHA-256: `bdfb10651fa0bc79a5f0a2091c4abcbf62df08bc1502cedeb8144335e012c339`.
- Content SHA-256: `4f6c9820d60f053425aefea55d03373738f00bed05e35db7d680ce795334072d`.
- Complete 28-file build SHA-256: `256dc785ffaabdc7b583f4b0ea5f2accee98ce25e96bd3b2ad3a379d4ebb7c4d`.
- Static validation: passed for all eight bilingual routes, current Guided copy, provenance-bound local assets, privacy copy, CSP, and no active/tracking content.
- Rendered matrix: 24/24 route/viewport cases and 6/6 video load/seek cases passed with visible navigation, 44-point link targets, Reduced Motion, no horizontal overflow, and zero external requests.
- Deployment/public readback: not performed; the current local successor must not be represented as the live website.

## Claim boundary

The deployed-artifact evidence proves its deterministic, public-safe historical website artifact, the existing Vercel Hobby project binding, `arrivewithin.com` DNS/TLS, eight production routes, and the three current Twilight media assets. Public-repository availability is proven separately by credential-free GitHub readback. The current local successor truthfully reflects the repository-recorded build-16 Guided product but does not prove website deployment, App Store availability, Apple approval, or public release. No domain purchase, registration, unrelated project, or unrelated DNS mutation was performed.

The eight app-UI images remain synchronized to capture revision `720deeed8719b680ebe4359e1f572565780cc1015ce4ab0d83cb530335bfb405`; the renderer-derived media is now byte-bound to current renderer source `e001e54e6cbecd30a8080dd5e3f9014650bcc253ca28cbe86c27185b231fc284`. App-UI screenshots and renderer-media evidence remain separate claims.
