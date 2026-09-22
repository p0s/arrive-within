# Arrive Within Cloudflare edge

This is the Cloudflare Workers Static Assets staging configuration for
`arrivewithin.com`. It serves the deterministic `../dist` tree through the
`ASSETS` binding and runs the Worker first only for the eight public document
routes and `/analytics/*`. The Worker counts a request only after the static
asset binding returns HTTP 200 with an HTML content type. It has no browser
tracker and does not proxy Vercel.

The committed configuration targets account `0317b000520a8e6b237de500c592d67a`,
sets `workers_dev = false` and `preview_urls = false`, and contains no
`routes` or custom-domain binding. `ANALYTICS_SITE_HOSTNAME` is the only
analytics variable present. Add `ANALYTICS_INGEST_URL` and
`ANALYTICS_INGEST_TOKEN` only after the backend recovery gate, as Worker
secrets; absent secrets intentionally make collection fail closed.

Build and validate from `Website` with the pinned Node 26.7 runtime:

```sh
ARRIVE_WITHIN_PUBLIC_BASE_URL=https://arrivewithin.com node scripts/build.mjs
ARRIVE_WITHIN_PUBLIC_BASE_URL=https://arrivewithin.com node scripts/validate.mjs
node scripts/test-analytics.mjs
node edge/worker.test.mjs
```

The staging version can be uploaded without activating a public endpoint:

```sh
wrangler versions upload --config edge/wrangler.toml
```

Record the returned version ID. The DNS owner must first have an active
Cloudflare zone for `arrivewithin.com`; a Worker Custom Domain for the exact
apex hostname then creates the necessary DNS record and certificate. The
`www` hostname requires its own explicit redirect or Custom Domain decision.
Keep the current Vercel deployment serving until the Cloudflare custom-domain
route has passed canonical, media, 404, security-header, and native-form
probes. If cutover fails, remove or disable the Cloudflare Custom Domain and
restore the existing Vercel alias; the Vercel deployment remains the rollback
artifact. For a Worker version already attached to a domain, use the recorded
version ID with `wrangler rollback <VERSION_ID>`.
