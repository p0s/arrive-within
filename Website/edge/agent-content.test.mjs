import assert from 'node:assert/strict';
import test from 'node:test';
import { FixtureRewriter } from './measurement-fixtures.mjs';
globalThis.HTMLRewriter = FixtureRewriter;
const { default: worker } = await import('./worker.mjs');
const { prefersMarkdown } = await import('./agent-content.mjs');

const SIGNAL = 'search=yes, ai-input=yes, ai-train=no';
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const env = { ANALYTICS_SITE_HOSTNAME: 'arrivewithin.com', ANALYTICS_INGEST_URL: 'https://stats.example.test/ingest/v1', ANALYTICS_INGEST_TOKEN: 'synthetic-token' };
const html = (status = 200) => new Response('<html><body>Fixture</body></html>', { status, headers: { 'content-type': 'text/html' } });
const markdown = (body) => new Response(body, { headers: { 'content-type': 'text/markdown', etag: '"md"' } });

function request(path, headers = {}, method = 'GET', origin = 'https://arrivewithin.com') {
  const req = new Request(origin + path, { method, headers: {
    host: 'arrivewithin.com', 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'Mozilla/5.0 Test Browser', ...headers,
  } });
  Object.defineProperty(req, 'cf', { value: { country: 'SG' } });
  return req;
}

async function send(req, files = {}) {
  const assets = [], ingest = [], waits = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => { ingest.push(url); return new Response(null, { status: 204 }); };
  try {
    const response = await worker.fetch(req, { ...env, ASSETS: { fetch: async (assetRequest) => {
      const { pathname } = new URL(assetRequest.url);
      assets.push({ pathname, method: assetRequest.method });
      return files[pathname]?.(assetRequest) ?? html(404);
    } } }, { waitUntil: (promise) => waits.push(promise) });
    const body = await response.text();
    await Promise.all(waits);
    return { response, body, assets, ingest };
  } finally { globalThis.fetch = previous; }
}

test('Markdown is chosen only for an explicit, highest-ranked text/markdown range', () => {
  for (const accept of ['text/markdown', 'TEXT/MARKDOWN', 'text/markdown, text/html;q=0.9', 'text/markdown, text/html, */*',
    'text/markdown;q=0.5, text/html;q=0.5', 'text/markdown;q=0.5, */*;q=0.1']) assert.equal(prefersMarkdown(accept), true, accept);
  for (const accept of [null, '', '*/*', 'text/*', BROWSER_ACCEPT, 'text/html, text/markdown;q=0.9', 'text/markdown;q=0',
    'text/markdown;q=2', 'text/markdown;q=0.8, text/*;q=0.9', `text/markdown, ${'x'.repeat(1100)}`]) assert.equal(prefersMarkdown(accept), false, String(accept));
});

test('negotiated Markdown keeps security headers, varies on Accept, and is not counted as a page view', async () => {
  const result = await send(request('/support', { accept: 'text/markdown' }), {
    '/support/index.md': () => markdown('# Support\n'),
  });
  const headers = result.response.headers;
  assert.equal(result.response.status, 200);
  assert.equal(result.body, '# Support\n');
  assert.equal(headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(headers.get('vary'), 'Accept');
  assert.equal(headers.get('content-location'), '/support/index.md');
  assert.equal(headers.get('link'), '<https://arrivewithin.com/support>; rel="canonical", </llms.txt>; rel="describedby"; type="text/plain"');
  assert.equal(headers.get('content-signal'), SIGNAL);
  assert.equal(headers.get('etag'), '"md"');
  assert.match(headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(result.assets, [{ pathname: '/support/index.md', method: 'GET' }]);
  assert.equal(result.ingest.length, 0);
});

test('browsers keep HTML with discovery links and unchanged page measurement', async () => {
  const result = await send(request('/', { accept: BROWSER_ACCEPT }), { '/': () => html() });
  const headers = result.response.headers;
  assert.match(result.body, /data-site-measurement="allowed"/);
  assert.equal(headers.get('content-type'), 'text/html');
  assert.equal(headers.get('link'), '</index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"; type="text/plain"');
  assert.equal(headers.get('vary'), 'Accept');
  assert.equal(headers.get('content-signal'), SIGNAL);
  assert.equal(headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(result.ingest, ['https://stats.example.test/ingest/v1']);
});

test('direct Markdown and llms.txt files carry UTF-8 types, canonical page links, and content signals', async () => {
  const page = await send(request('/de/privacy/index.md', { accept: '*/*' }), { '/de/privacy/index.md': () => markdown('# Datenschutz\n') });
  assert.equal(page.response.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(page.response.headers.get('link'), '<https://arrivewithin.com/de/privacy>; rel="canonical", </llms.txt>; rel="describedby"; type="text/plain"');
  assert.equal(page.response.headers.get('vary'), null);
  assert.equal(page.response.headers.get('content-location'), null);
  assert.equal(page.ingest.length, 0);
  const llms = await send(request('/llms.txt'), { '/llms.txt': () => new Response('# Arrive Within\n', { headers: { 'content-type': 'text/plain' } }) });
  assert.equal(llms.response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(llms.response.headers.get('content-signal'), SIGNAL);
  assert.equal(llms.ingest.length, 0);
});

test('negotiation preserves method, validators, and existing Vary dimensions', async () => {
  const head = await send(request('/privacy', { accept: 'text/markdown' }, 'HEAD'), {
    '/privacy/index.md': () => new Response(null, { headers: { 'content-type': 'text/markdown', vary: 'Accept-Encoding' } }),
  });
  assert.deepEqual(head.assets, [{ pathname: '/privacy/index.md', method: 'HEAD' }]);
  assert.equal(head.response.headers.get('vary'), 'Accept-Encoding, Accept');
  const revalidated = await send(request('/', { accept: 'text/markdown', 'if-none-match': '"md"' }), {
    '/index.md': (assetRequest) => new Response(null, { status: assetRequest.headers.get('if-none-match') === '"md"' ? 304 : 200, headers: { etag: '"md"' } }),
  });
  assert.equal(revalidated.response.status, 304);
  assert.equal(revalidated.response.headers.get('vary'), 'Accept');
});

test('unknown paths, other methods, missing variants, and www keep their existing behavior', async () => {
  const unknown = await send(request('/nope', { accept: 'text/markdown' }));
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.response.headers.get('link'), null);
  assert.equal(unknown.response.headers.get('content-signal'), null);
  const post = await send(request('/support', { accept: 'text/markdown' }, 'POST'), { '/support': () => new Response('Method not allowed', { status: 405 }) });
  assert.deepEqual(post.assets, [{ pathname: '/support', method: 'POST' }]);
  assert.equal(post.response.status, 405);
  const missing = await send(request('/open-source', { accept: 'text/markdown' }), { '/open-source': () => html() });
  assert.deepEqual(missing.assets.map((item) => item.pathname), ['/open-source/index.md', '/open-source']);
  assert.equal(missing.response.headers.get('content-type'), 'text/html');
  const www = await send(request('/support', { accept: 'text/markdown' }, 'GET', 'https://www.arrivewithin.com'));
  assert.equal(www.response.status, 301);
  assert.equal(www.response.headers.get('location'), 'https://arrivewithin.com/support');
  assert.equal(www.assets.length, 0);
});
