# Arrive Within Cloudflare edge

This is the Cloudflare Workers Static Assets production configuration for
`arrivewithin.com`. It serves the deterministic `../dist` tree through the
`ASSETS` binding. Documents and unknown paths run through the Worker first so
`www` can redirect before a static 404; media, robots.txt, and sitemap.xml
remain asset-first. The Worker counts a request only after the static
asset binding returns HTTP 200 with an HTML content type. It has no browser
tracker and does not proxy Vercel.

`agent-content.mjs` serves a public page as Markdown when the `Accept` header
names `text/markdown` at least as strongly as HTML; browsers and wildcard
requests keep HTML. Both representations send `Vary: Accept` and the
`Content-Signal` preference. HTML pages add RFC 8288 `Link` headers to their
`/index.md` alternate and `/llms.txt`. Markdown responses name their canonical
HTML page and are never counted as document views.

The committed configuration sets `workers_dev = false` and
`preview_urls = false`, and binds apex and www as Custom Domains. The Worker
serves only the exact apex
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

Use the checked publisher from `Website` for production deployments:

```sh
node scripts/publish-edge.mjs
```

The publisher reads the saved profile and account binding from the owner-only
file `~/.config/arrive-within/deployment.json`, or the absolute path supplied by
`ARRIVE_WITHIN_DEPLOYMENT_CONFIG`. The file must be outside the repository and
readable only by its owner. It contains `schemaVersion` (1), `profile`,
`accountId`, `workerName`, and `customDomains`. Its Worker and domain values
must match the checked-in project configuration. Never commit this file or copy
its values into documentation, tests, reports, or PR text. An optional
`--profile <saved-wrangler-profile>` argument must match the private binding.

Public builds need no private configuration. Public manifests contain only
project/domain identity and content hashes. Account selection is passed to
Wrangler through its environment; raw provider output stays out of publisher
summaries. Check local configuration without deployment using:

```sh
node scripts/publish-edge.mjs --check-config
```

For initial deployment or migration from an older manifest, use
`node scripts/publish-edge.mjs --deploy-only`. It verifies the exact deployed
version and the new public manifest without sending IndexNow requests or
changing the retained queue. Normal publishing uses the new manifest format.
The publisher stores acknowledged public page hashes and bounded pending URL
status in ignored `Website/.indexnow-state/publisher-state.json`. Keep that
state with the persistent production-publisher checkout.

The queue records attempts before each request. Accepted batches remain marked
until the full queue is acknowledged. HTTP 429 and 503 responses honor
`Retry-After` (or wait at least one minute); other rejections and interrupted
in-flight requests are held for review and are never replayed automatically.
Use this command to retry due retained URLs without deployment:

```sh
node scripts/publish-edge.mjs --retry-indexnow
```

It rebuilds the exact current source, verifies that the live manifest and pages
match it, and submits only due retained entries. A normal deploy sends nothing
when its public candidate is unchanged.
Removed pages are notified only after the old route returns HTTP 404 or 410.
Before IndexNow, the publisher also matches Wrangler's returned version ID to
the provider status readback at 100% traffic. Preview/build-only commands do
not run this publisher.

The checked-in Wrangler build hook runs `pnpm verify:edge` before upload. For
`deploy` and `versions upload`, its wrapper sets the canonical production
origin so the generated sitemap and robots file use `https://arrivewithin.com`.
For local `wrangler dev`, it preserves the local origin behavior. The
verification rebuilds and validates the site, sitemap, robots file, analytics
behavior, and edge Worker.

The build publishes the public IndexNow verification key at the root path
`/<key>.txt`. The key is public verification data, not a secret. Page
fingerprints include the page HTML and the build manifest's hash of every
output asset and dependency. Before notification, a bounded live read must
match those fingerprints. The publisher accepts at most 100 URLs per batch,
checks the canonical host, HTTPS scheme, robots rules, canonical tags, and
noindex state, and uses at most eight concurrent page reads with a 12-second
timeout. Bing Webmaster Tools sitemap submission remains a separate pending
action.

This is a Wrangler CLI build hook; it does not create a GitHub push-triggered
deployment. Cloudflare Workers Builds has separate build settings and does not
apply Wrangler's `[build]` command, so configure the same verification command
there if that deployment integration is used.

Any separate version upload or rollback must use the same private account and
profile binding and the checked build hook. Do not rely on an implicit default
account. Never publish raw provider output or local operational identifiers.

The active Cloudflare zone and both Custom Domains must exist before production
deployment. Keep the previous Vercel deployment as a rollback artifact until
canonical, media, 404, security-header, and native-form probes pass. If the
Cloudflare cutover fails, restore the previous Vercel DNS and alias. For a
Worker version already attached to a domain, use the recorded version ID with
`wrangler rollback <VERSION_ID>`.
