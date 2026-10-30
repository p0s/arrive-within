import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const { default: worker } = await import(process.env.MEASUREMENT_WORKER_SOURCE || './worker.mjs');
import { FixtureRewriter } from './measurement-fixtures.mjs';
globalThis.HTMLRewriter = FixtureRewriter;

const env = { ANALYTICS_SITE_HOSTNAME: 'arrivewithin.com', ANALYTICS_INGEST_URL: 'https://stats.example.test/ingest/v1', ANALYTICS_INGEST_TOKEN: 'synthetic-token' };
function request(path = '/', headers = {}, method = 'GET', body) {
  const req = new Request('https://arrivewithin.com' + path, { method, body, headers: {
    host: 'arrivewithin.com', 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'Mozilla/5.0 Test Browser', ...headers,
  } });
  Object.defineProperty(req, 'cf', { value: { country: 'SG' } });
  return req;
}
const signal = (name = 'bootstrap', headers = {}, body, query = '') => request('/analytics/signal' + query, {
  origin: 'https://arrivewithin.com', 'sec-fetch-site': 'same-origin', 'x-analytics-path': '/',
  'x-analytics-signal': name, 'x-measurement-qa': '1', ...headers,
}, 'POST', body);
async function send(req, { answers = [204], configuration = env } = {}) {
  const calls = [], waits = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const answer = answers.shift() ?? 204;
    if (answer === 'throw') throw new Error('synthetic unavailable gateway');
    return new Response(null, { status: answer });
  };
  try {
    const response = await worker.fetch(req, { ...configuration, ASSETS: {
      fetch: async () => new Response('<html><body>Fixture</body></html>', { headers: { 'content-type': 'text/html', etag: 'old' } }),
    } }, { waitUntil: promise => waits.push(promise) });
    const html = await response.text();
    await Promise.all(waits);
    return { response, html, calls };
  } finally { globalThis.fetch = previous; }
}

test('page, visible, foreground and bootstrap QA have distinct frozen payloads', async () => {
  const page = await send(request('/?measurement_qa=1'));
  assert.match(page.html, /data-site-measurement="allowed"/);
  assert.equal(page.calls[0].body.qa, true);
  assert.equal(page.calls[0].body.eventName, undefined);
  assert.equal(page.response.headers.get('cache-control'), 'private, no-store');
  assert.equal(page.response.headers.get('etag'), null);
  for (const name of ['bootstrap', 'visible', 'engaged']) {
    const result = await send(signal(name));
    assert.equal(result.response.status, 204); assert.equal(result.calls.length, 1);
    const { body, url } = result.calls[0];
    assert.match(body.eventId, /^[0-9a-f]{32}$/); delete body.eventId;
    if (name === 'bootstrap') {
      assert.equal(url, 'https://stats.example.test/ingest/stage/v1');
      assert.deepEqual(body, { stage: 'bootstrap', qa: true });
    } else {
      assert.equal(url, 'https://stats.example.test/ingest/v1');
      assert.deepEqual(body, { hostname: 'arrivewithin.com', path: '/', ip: '203.0.113.9',
        userAgent: 'Mozilla/5.0 Test Browser', country: 'SG', eventName: name === 'visible' ? 'page_visible' : 'page_engaged', qa: true });
    }
  }
});

test('privacy choices, recognizable bots and prefetch produce no pages, signals or stages', async () => {
  for (const headers of [{ dnt: '1' }, { 'sec-gpc': '1' }, { cookie: 'p0s_analytics_optout=1' },
    { 'user-agent': 'Googlebot' }, { purpose: 'prefetch' }, { 'sec-purpose': 'prerender' }]) {
    const page = await send(request('/', headers));
    assert.equal(page.calls.length, 0); assert.match(page.html, /data-site-measurement="denied"/);
    for (const name of ['bootstrap', 'visible', 'engaged']) assert.equal((await send(signal(name, headers))).calls.length, 0);
  }
  const verified = signal();
  verified.cf.botManagement = { verifiedBot: true };
  assert.equal((await send(verified)).calls.length, 0);
  assert.equal((await send(request('/'), { configuration: {} })).calls.length, 0);
});

test('signal relay rejects unknown input and private or identifier-bearing paths', async () => {
  for (const req of [signal('arbitrary'), signal('visible', {}, 'private text'), signal('visible', {}, undefined, '?qa=1'),
    signal('visible', { origin: 'null' }), signal('visible', { 'sec-fetch-site': 'cross-site' }),
    signal('visible', { 'content-length': '2000' }),
    ...['/internal/', '/account/', '/person@example/', '/p/?secret=private', '/p/#private', '//external/',
      '/p/0123456789abcdef0123456789abcdef/', '/p/this%20is%20text/'].map(path => signal('visible', { 'x-analytics-path': path }))]) {
    const result = await send(req); assert.notEqual(result.response.status, 204); assert.equal(result.calls.length, 0);
  }
  assert.equal((await send(signal('visible', { 'cf-connecting-ip': '' }))).calls.length, 0);
  const privatePage = await send(request('/?token=private'));
  assert.equal(privatePage.calls.length, 0); assert.match(privatePage.html, /data-site-measurement="denied"/);
});

test('one bounded retry preserves event identity and final receipts never resend', async () => {
  for (const answers of [[503, 409], ['throw', 204], [503, 503]]) {
    const result = await send(signal('visible'), { answers: [...answers] });
    assert.equal(result.calls.length, 2);
    const [first, second] = result.calls.map(call => call.body);
    assert.equal(second.attempt, 2); delete second.attempt; assert.deepEqual(second, first);
  }
  for (const status of [202, 204, 400, 401, 409, 429]) {
    assert.equal((await send(signal('visible'), { answers: [status] })).calls.length, 1);
  }
});

const browserSource = readFileSync(process.env.MEASUREMENT_BROWSER_SOURCE || new URL('../src/measurement.js', import.meta.url), 'utf8');
function browser({ visible = true, dnt = '0', gpc = false, permission = 'allowed', qa = true,
  originalUrl, timing = true, prerendering = false } = {}) {
  const calls = [], events = new Map(), timers = new Map();
  let now = 0, serial = 0;
  const location = new URL('https://arrivewithin.com/' + (qa ? '?measurement_qa=1' : ''));
  const navigator = { doNotTrack: dnt, globalPrivacyControl: gpc };
  const document = { body: { dataset: { siteMeasurement: permission } }, prerendering,
    visibilityState: visible ? 'visible' : 'hidden',
    addEventListener(type, listener) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(listener); },
    removeEventListener(type, listener) { events.get(type)?.delete(listener); },
  };
  const performance = { now: () => now, getEntriesByType: () => timing ? [{ name: originalUrl || location.href }] : [] };
  const setTimeout = (handler, delay) => { const id = ++serial; timers.set(id, { due: now + delay, handler }); return id; };
  const clearTimeout = id => timers.delete(id);
  const context = { window: { doNotTrack: '0' }, document, location, navigator, performance, setTimeout, clearTimeout, URL,
    fetch: (url, init) => { calls.push({ url, init }); return Promise.resolve(); } };
  const start = () => runInNewContext(browserSource, context);
  const emit = (type, values = {}) => { for (const handler of [...(events.get(type) || [])]) handler({ type, isTrusted: true, ...values }); };
  function advance(ms) {
    const end = now + ms;
    for (let i = 0; i < 100; i += 1) {
      const next = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) { now = end; return; }
      const [id, timer] = next; timers.delete(id); now = timer.due; timer.handler();
    }
    throw new Error('timer failed to settle');
  }
  start();
  return { calls, context, navigator, document, start, advance, emit,
    signals: () => calls.map(call => call.init.headers['x-analytics-signal']),
    visibility(value) { document.visibilityState = value ? 'visible' : 'hidden'; emit('visibilitychange'); },
  };
}

test('passive ten-second readers and interacting browsers remain separate, once per document', () => {
  const b = browser();
  assert.deepEqual(b.signals(), ['bootstrap']); b.advance(9999);
  assert.deepEqual(b.signals(), ['bootstrap']); b.advance(1);
  assert.deepEqual(b.signals(), ['bootstrap', 'visible']);
  b.emit('keydown', { key: 'Shift' }); b.emit('scroll', { isTrusted: false });
  assert.deepEqual(b.signals(), ['bootstrap', 'visible']);
  b.emit('keydown', { key: 'ArrowDown' }); b.emit('scroll'); b.advance(50000); b.start();
  assert.deepEqual(b.signals(), ['bootstrap', 'visible', 'engaged']);
  for (const call of b.calls) {
    assert.equal(call.init.body, undefined); assert.equal(call.init.mode, 'cors');
    assert.equal(call.init.referrerPolicy, 'no-referrer');
    assert.equal(call.init.headers['x-measurement-qa'], '1');
  }
});

test('hidden and short visits do not qualify, while visible time accumulates', () => {
  const b = browser({ visible: false }); b.advance(60000); b.emit('scroll');
  b.visibility(true); b.advance(4000); b.visibility(false); b.advance(60000);
  b.visibility(true); b.advance(5999); assert.deepEqual(b.signals(), ['bootstrap']);
  b.advance(1); assert.deepEqual(b.signals(), ['bootstrap', 'visible']);
  b.emit('scroll'); assert.deepEqual(b.signals(), ['bootstrap', 'visible', 'engaged']);
});

test('response denial, DNT, GPC and prerendering stop every browser observation', () => {
  for (const options of [{ permission: 'denied' }, { dnt: '1' }, { gpc: true }, { prerendering: true }]) {
    const b = browser(options); b.advance(20000); b.emit('scroll'); assert.deepEqual(b.calls, []);
  }
  const b = browser(); b.navigator.globalPrivacyControl = true; b.advance(20000); b.emit('scroll');
  assert.deepEqual(b.signals(), ['bootstrap']);
});

test('QA and path stay bound to the original document when history changes', () => {
  const b = browser(); b.context.location = new URL('https://arrivewithin.com/questions/changed/?email=private');
  b.advance(10000); b.emit('scroll');
  for (const call of b.calls) {
    assert.equal(call.init.headers['x-measurement-qa'], '1'); assert.equal(call.init.headers['x-analytics-path'], '/');
    assert.doesNotMatch(JSON.stringify(call), /email|private|changed/);
  }
  const alreadyChanged = browser({ qa: false, originalUrl: 'https://arrivewithin.com/?measurement_qa=1' });
  assert.equal(alreadyChanged.calls[0].init.headers['x-measurement-qa'], '1');
  const ordinary = browser({ qa: false }); ordinary.context.location = new URL('https://arrivewithin.com/?measurement_qa=1');
  ordinary.advance(10000); assert.equal(ordinary.calls[1].init.headers['x-measurement-qa'], undefined);
  assert.equal(browser({ timing: false }).calls[0].init.headers['x-measurement-qa'], '1');
});


test('source-link action is aggregate, QA-labelled and allowlisted', async () => {
  const result = await send(signal('action', { 'x-analytics-action': 'source_repo_open' }));
  assert.equal(result.response.status, 204); assert.equal(result.calls.length, 1);
  const { body, url } = result.calls[0]; delete body.eventId;
  assert.equal(url, 'https://stats.example.test/ingest/action/v1');
  assert.deepEqual(body, { actionId: 'source_repo_open', qa: true });
  for (const headers of [{ 'x-analytics-action': 'arbitrary' }, { 'x-measurement-qa': 'invalid', 'x-analytics-action': 'source_repo_open' }]) {
    const denied = await send(signal('action', headers));
    assert.equal(denied.response.status, 400); assert.equal(denied.calls.length, 0);
  }
  for (const headers of [{ dnt: '1' }, { 'sec-gpc': '1' }, { cookie: 'p0s_analytics_optout=1' }, { 'user-agent': 'Googlebot' }]) {
    assert.equal((await send(signal('action', { ...headers, 'x-analytics-action': 'source_repo_open' }))).calls.length, 0);
  }
});

test('only trusted source-link activation creates one action, including after engagement', () => {
  const b = browser(); b.advance(10000); b.emit('scroll');
  const link = href => ({ closest: () => ({ href }) });
  b.emit('click', { target: link('https://apps.apple.com/app/id6800192697') });
  b.emit('click', { isTrusted: false, target: link('https://github.com/p0s/arrive-within') });
  assert.equal(b.signals().includes('action'), false);
  b.emit('click', { target: link('https://github.com/p0s/arrive-within') });
  b.emit('click', { target: link('https://github.com/p0s/arrive-within') });
  assert.deepEqual(b.signals(), ['bootstrap', 'visible', 'engaged', 'action']);
  assert.equal(b.calls.at(-1).init.headers['x-analytics-action'], 'source_repo_open');
  assert.equal(b.calls.at(-1).init.headers['x-measurement-qa'], '1');
  b.navigator.globalPrivacyControl = true;
  b.emit('click', { target: link('https://github.com/p0s/arrive-within') });
  assert.equal(b.signals().length, 4);
});


test('canonical URL defines site identity and missing provider context fails closed', async () => {
  const proxy = await send(request('/?measurement_qa=1', {host:'127.0.0.1:12345'}));
  assert.equal(proxy.calls.length, 1); assert.equal(proxy.calls[0].body.hostname, 'arrivewithin.com');
  const absent = new Request('https://arrivewithin.com/', { headers: {host:'arrivewithin.com','user-agent':'Mozilla/5.0','cf-connecting-ip':'203.0.113.9'} });
  assert.equal((await send(absent)).calls.length, 0);
  const verified = request('/'); verified.cf.botManagement = {verifiedBot:true};
  assert.equal((await send(verified)).calls.length, 0);
});
