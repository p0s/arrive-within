# Bilingual static website — local verification

Date: 2026-08-13
Status: deployed Twilight artifact retained; unreleased brand/visual successor statically verified

## Artifact

- Canonical source: `Website/`
- Verified target: the existing Vercel Hobby project named `arrive-within`, with the owner-authorized canonical `arrivewithin.com` origin; deployment and DNS/TLS are verified by credential-free readback
- Routes: `/`, `/de`, `/support`, `/de/support`, `/privacy`, `/de/privacy`, `/open-source`, `/de/open-source`
- Runtime policy: static HTML/CSS with local images and one controlled, silent local MP4; no JavaScript, autoplay, form, analytics, tracking, cookie, account, newsletter, or remote runtime asset
- Actual-UI media: eight first-party build-6 captures from the pooled iPhone simulator and authorized physical iPad, bound to capture source revision `720deeed8719b680ebe4359e1f572565780cc1015ce4ab0d83cb530335bfb405`, plus deterministic renderer-derived garden video, poster, and social preview bound by `Website/src/assets/provenance.json`

## Deterministic build

The exact Node 26.7.0 runtime ran the dependency-free build and validation scripts directly and successfully; the installed project package state remains pinned by the pnpm 11.20.0 lockfile, and this verification performed no dependency resolution.

- Source tree SHA-256: `852734086aea864863db252197935728a77ab5c8df5f48413bd9e645be0c4c1d`
- Content SHA-256: `941f7f236fe71993b35b37f46e4e8e199d66b0f72b15b3512f23835fd1e0e8c6`
- Complete 25-file build SHA-256: `4e6c33937800655078380031178e04d67553833b8c02790a587e95fa97e468c1`
- The production-origin build passed the deterministic validator and all eight route bodies read back byte-for-byte from `arrivewithin.com`.
- The validator passed exact route/link, injected-origin canonical/hreflang, landmark, local-image/alt, local-video/control, provenance/hash, privacy-copy, no-active-content, no-tracking, no-external-runtime-asset, and Vercel security-header checks.

## Rendered review

The current-source production-origin build was served only on loopback and inspected through a real browser at desktop `1440×1000` and mobile `390×844` dimensions.

- The reproducible report is `docs/qa/website/browser-matrix.json`.
- All 16 route/viewport combinations had one main landmark, one H1, the correct document language, a visible footer, local images with nonempty alt text, and no horizontal overflow.
- English-to-German and German-to-English navigation completed with the expected localized title and H1.
- Browser console warning/error count: 0.
- External request count: 0; every non-loopback request would have been blocked and failed the matrix.
- All four home-page viewport/language cases loaded the 1280×720, 9.733-second video metadata and sought to a decoded five-second frame while remaining paused; controls were present and autoplay was absent.
- Representative English desktop hero, growth, Timer/Stopwatch mode choice, and German mobile article layouts were visually inspected.
- Review found a 15-point overflow in the German mobile open-source heading. The fix uses German-only automatic hyphenation with safe word wrapping; the full 16-case matrix then passed. English heading hyphenation is explicitly disabled.

## Current deployed artifact

After build 7 entered review, the renderer-derived Garden video, poster, and social preview were regenerated from the current Twilight source and synchronized into `Website/src/assets`. The successor has source SHA-256 `f87034ba7bbad7e9fdd51485a2f9ed02a2f4f103fa15e9632fab42950d6a237d`, content SHA-256 `c0facf9f554a2690b01d3575456c02a44d72f4f3b7b75d348b4b9fba43ebc812`, and complete 25-file production-origin build SHA-256 `59430428d7124fc08b6fb3d155f22eb8e63d56aafd1c9240cb0bfcb3486cc951`. Static validation, the 16-case browser matrix, and all four video load/seek cases pass locally. Deployment `dpl_DdCw74n9x8f862DJBLYynnSztA1e` is READY and aliased to `arrivewithin.com`; all eight route bodies and all three refreshed media assets were then downloaded without credentials and matched the local artifact byte-for-byte.

## Unreleased brand and visual successor

The 2026-08-13 website polish replaces the generic dot with exact byte copies of the selected B — Quiet Threshold 40 px and 180 px opaque RGB assets. The mark is now visible in the header/footer and linked as the browser favicon and Apple touch icon, with separate public-safe source/hash/trademark provenance. The home hero becomes one full-canvas garden composition with product-first hierarchy; mobile navigation keeps all destinations exposed in a bounded horizontal row; visible links receive 44-point minimum targets; CSS-only entrance, depth, and hover motion disable under Reduce Motion. English/German repository copy now reflects the independently read-back public canonical repository while retaining the no-App-Store-availability boundary.

Two clean production-origin builds with exact Node 26.7.0 were byte-identical:

- Source tree SHA-256: `6e4a6d0a34f7527ead9d73d5d6f5cdca5ae0e79038a2815982468e0cbb8b01c5` across 27 public source files; ignored environment, host-binding, dependency, and generated-output files are excluded.
- Content SHA-256: `3804864eec3eefdc720eebdf84e747a3aabeb4f86d11113aa63c97c4a39ac7b7`
- Complete 28-file build SHA-256: `3026c55a75253a73442efc82505a53fe47228af091f8141d5967a659986f98d4`
- Static validation: passed for eight routes, eleven product/media assets, two selected brand icons, local-only runtime assets, bilingual metadata, CSP, privacy copy, and provenance/hash integrity.
- Rendered matrix: not refreshed in this execution. The pinned Playwright browser launch was denied by the desktop execution sandbox after the non-socket route-fulfillment harness was prepared. The prior 16-case report remains historical evidence for the deployed artifact and is not relabeled as proof of this successor.
- Deployment/public readback: not performed and not authorized by this website-edit request.

## Claim boundary

The deployed-artifact evidence proves the deterministic, public-safe refreshed website artifact, the existing Vercel Hobby project binding, `arrivewithin.com` DNS/TLS, eight production routes, and the three current Twilight media assets. Public-repository availability is proven separately by credential-free GitHub readback. Neither that evidence nor the unreleased local successor proves App Store availability, production narration, or a later signed release candidate. No domain purchase, registration, unrelated project, or unrelated DNS mutation was performed.

The eight app-UI images remain synchronized to build-6 capture revision `720deeed8719b680ebe4359e1f572565780cc1015ce4ab0d83cb530335bfb405`; the renderer-derived media is current Twilight output. Live route/media hashes match the deployed 25-file artifact. The 28-file brand/visual successor remains local until a separately authorized deploy and exact readback.
