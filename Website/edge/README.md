# Arrive Within Cloudflare edge

This is the Cloudflare Workers Static Assets production configuration for
`arrivewithin.com`. It serves the deterministic `../dist` tree through the
`ASSETS` binding. Documents and unknown paths run through the Worker first so
`www` can redirect before a static 404; media, robots.txt, and sitemap.xml
remain asset-first. The Worker counts a request only after the static
asset binding returns HTTP 200 with an HTML content type. It has no browser
tracker and does not proxy Vercel.

The committed configuration targets account `0317b000520a8e6b237de500c592d67a`,
sets `workers_dev = false` and `preview_urls = false`, and binds apex and www
as Custom Domains. The Worker serves only the exact apex
`arrivewithin.com`; requests for `www.arrivewithin.com` redirect to the HTTPS
apex while preserving path and query, and other hosts return 404.
`ANALYTICS_SITE_HOSTNAME` is the only source-controlled analytics variable.
`ANALYTICS_INGEST_URL` and `ANALYTICS_INGEST_TOKEN` are Worker secrets;
absent secrets intentionally make collection fail closed.

Build and validate from `Website` with the pinned Node 26.7 runtime:

```sh
ARRIVE_WITHIN_PUBLIC_BASE_URL=https://arrivewithin.com node scripts/build.mjs
ARRIVE_WITHIN_PUBLIC_BASE_URL=https://arrivewithin.com node scripts/validate.mjs
node scripts/test-analytics.mjs
node edge/worker.test.mjs
```

An unattached version can be uploaded without activating a public endpoint:

```sh
wrangler versions upload --config edge/wrangler.toml
```

The active Cloudflare zone and both Custom Domains must exist before production
deployment. Keep the previous Vercel deployment as a rollback artifact until
canonical, media, 404, security-header, and native-form probes pass. If the
Cloudflare cutover fails, restore the previous Vercel DNS and alias. For a
Worker version already attached to a domain, use the recorded version ID with
`wrangler rollback <VERSION_ID>`.
