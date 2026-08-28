# Arrive Within SEO review package

Date: 2026-08-28 (Asia/Singapore)
Status: `PREPARED_FOR_REVIEW` — local source and evidence only; not pushed or deployed

## Provenance and authority

- Task checkout: `/Users/p/.codex/worktrees/e983/arrive-within`
- Base and verified remote `main`: `28d5d75a5ed9d515898c779627c98dae61f608aa`
- Frozen prerequisite: `/Users/p/src/pg/orchestrator/artifacts/public-site-seo-2026-08-28/frozen-review-prerequisite.md`
- Frozen prerequisite SHA-256: `3b0b174cb8cc6209135cc21eb52b887a1a3aa5dbd9858c9833ee86f81e1363df`
- Boundaries: no push, PR, deployment, DNS/hosting change, App Store mutation, or publication

## Live readback before implementation

The dedicated research Chrome 151 profile performed credential-free visible reads.

| Surface | Observed evidence |
| --- | --- |
| `/` | HTTP 200; canonical and reciprocal `en`/`de`/`x-default`; `index,follow`; no JSON-LD. First navigation reached response start at 12,993 ms, DOMContentLoaded at 13,030 ms, and load at 13,063 ms. |
| `/de` | HTTP 200; reciprocal alternates and German metadata; no JSON-LD. Response start 1,889 ms; load 1,952 ms. |
| `/robots.txt` | HTTP 200; allows `/` and declares the production sitemap. Response start 229 ms. |
| `/sitemap.xml` | HTTP 200; exactly the eight canonical EN/DE routes. Response start 224 ms. |
| unknown route | HTTP 404, but incorrectly emitted `index,follow`, the home canonical, and home hreflang. |
| official App Store URL | HTTP 200 after canonical redirect to the US listing. The visible page identified Arrive Within: Meditation as free with in-app purchases, for iPhone/iPad, Health & Fitness, English plus one language, and requiring iOS 18.0 or later. |

Official URL: `https://apps.apple.com/app/id6800192697`

Task-local visible App Store screenshot (not committed):
`/Users/p/.codex/visualizations/2026/08/28/01a0470d-5399-7102-85f8-d1a9253d2dd1/app-store-readback.png`

## Cold-load diagnosis

The transient delay was reproduced once. Approximately 12.993 seconds elapsed before the first HTML response byte, while the static document completed about 70 ms later. The deployed page had no executable JavaScript and a roughly 3 KB encoded HTML body. Subsequent German, robots, sitemap, and 404 reads were materially faster.

This supports an edge/network/hosting-path unknown, not a code-owned rendering defect. No infrastructure setting was changed. The local 24-case browser matrix remained deterministic and fast with zero external requests.

## Prepared implementation

- Preserves all eight indexable routes, self-canonicals, reciprocal EN/DE hreflang, `x-default`, robots, sitemap, Open Graph, and Twitter metadata.
- Adds one inert JSON-LD graph per indexable route: `Organization` + `WebSite` everywhere, `SoftwareApplication` on both home routes, and `BreadcrumbList` on six visible breadcrumb routes.
- Application markup includes only visible, verified facts. It omits offers/currency, ratings, reviews, release dates, availability dates, and exact-build claims.
- Adds matched English/German App Store discovery copy and country-neutral links after visible storefront verification.
- Changes generated 404 output to `noindex,follow` and removes its misleading canonical, hreflang, and schema.
- Adds static and rendered regression assertions for claims, schema shape, canonical/hreflang parity, breadcrumbs, App Store links, sitemap, robots, and 404 behavior.

## Rendered parity matrix

The complete machine-readable matrix is `route-seo-matrix.json`. All eight routes passed at desktop 1440 px, mobile 390 px, and compact 320 px. EN↔DE round-trip, reduced motion, 44 px targets, image alternatives, video metadata/seek, horizontal overflow, console output, and external-request checks passed.

| Route group | Schema | Visible breadcrumb | App Store discovery |
| --- | --- | --- | --- |
| `/`, `/de` | Organization, WebSite, SoftwareApplication | No | Section CTA + footer |
| support, privacy, open-source in EN/DE | Organization, WebSite, BreadcrumbList | Home/Start → current page | Footer |

Screenshots:

- `en-home-desktop.png`, `de-home-mobile.png`
- `en-availability-desktop.png`, `de-availability-mobile.png`
- `en-support-mobile.png`, `de-open-source-desktop.png`

Visual review found no clipping, overlap, hidden navigation, language asymmetry, accessibility regression, or unrelated redesign. The capture waits for the existing entrance animation to settle.

## Validation

- Exact Node `26.7.0` + pinned pnpm `11.20.0`: `pnpm --dir Website verify` — passed.
  - Source SHA-256: `369520b4b19a33b8dc9677c10aa61f6840267fea4e31388ace450119168fc507`
  - Content SHA-256: `d8b1fc8f212701549e89fcdb08e3c9faf6ed7121b9ecc57772ffac66ec4319b8`
  - Complete 28-file build SHA-256: `8eeac78cf8da2a24cd059ed0297508994c90806ee8e3a8c630d28fbc72fe84c8`
- Exact Node `26.7.0`: `node Website/scripts/validate-browser.mjs --capture-review` — 24/24 route/viewport cases and 6/6 video loads/seeks passed; zero warnings, errors, external requests, overflow failures, or tap-target failures.
- `git diff --check` — passed before final review; rerun at commit time.

## Smallest review action

Inspect the two availability close-ups, then compare `route-seo-matrix.json` with the generated home and one internal-route HTML file. Approval should authorize only a later delivery/deployment step; this package performs neither.
