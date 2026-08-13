# Bilingual static website — local verification

Date: 2026-08-12
Status: refreshed Twilight production artifact verified locally, deployed, and read back

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

## Retained production media

After build 7 entered review, the renderer-derived Garden video, poster, and social preview were regenerated from the then-current Twilight source and synchronized into `Website/src/assets`. That production artifact passed its static and 16-case browser matrices and was read back byte-for-byte. The later post-publication Garden changes renderer and schema source, so these retained assets are now explicitly historical product media rather than current-source Garden proof. A fresh browser capture was skipped after host denial, not passed; the next successful current-source regeneration must be visually reviewed, hash-bound, and resynchronized before replacing the three assets.

## Claim boundary

This proves the deterministic, public-safe refreshed website artifact, the existing Vercel Hobby project binding, `arrivewithin.com` DNS/TLS, eight production routes, and the three current Twilight media assets. It does not prove public-repository availability, App Store availability, production narration, or a signed release candidate. No domain purchase, registration, unrelated project, or unrelated DNS mutation was performed.

The eight app-UI images remain synchronized to build-6 capture revision `720deeed8719b680ebe4359e1f572565780cc1015ce4ab0d83cb530335bfb405`; the renderer-derived media remains byte-bound pre-enhancement output. The post-publication Garden has separate rendered and deterministic proof and is not represented by these retained assets.
