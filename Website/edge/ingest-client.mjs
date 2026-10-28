// Reference producer client for the frozen ingest contract (CONTRACT.md).
// Server-side only: it holds the site token. Copy it into a producer as-is.
export const CONTRACT_VERSION = 'p0s-ingest-2-20261028';
export const ROUTES = Object.freeze({ page: '/ingest/v1', action: '/ingest/action/v1', stage: '/ingest/stage/v1' });
export const SIGNALS = Object.freeze({ visible: 'page_visible', engaged: 'page_engaged' });
export const STAGES = Object.freeze(['bootstrap', 'ga_skip_no_session', 'ga_ok', 'ga_fail_definite', 'ga_fail_uncertain']);

const EVENT_ID = /^[0-9a-f]{32}$/;
// Only these mean the gateway may not have the event; 409 means possibly stored.
const RETRYABLE = new Set([500, 502, 503, 504]);

export function newEventId(cryptoImpl = globalThis.crypto) {
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function post(url, token, body, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      // Workers reject redirect: 'error'; manual never forwards the token or body.
      redirect: 'manual',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    return response.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

// Deliver one event, retrying once after a transport failure, timeout or 5xx.
// The gateway forwards a retry only when it recorded the first attempt as
// definitely unsent, so a retry cannot double count; any other retry is
// answered as a repeat (202/204) or refused as a possible loss (409).
export async function deliver(base, route, token, body, {
  fetchImpl = globalThis.fetch, timeoutMs = 1500, retryDelayMs = 400,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), cryptoImpl = globalThis.crypto,
} = {}) {
  if (!Object.hasOwn(ROUTES, route) || typeof token !== 'string' || !token || !base?.startsWith('https://')) {
    return { outcome: 'not_configured', status: null, attempts: 0 };
  }
  const event = { ...body, eventId: body.eventId ?? newEventId(cryptoImpl) };
  delete event.attempt;
  if (!EVENT_ID.test(event.eventId)) return { outcome: 'invalid', status: null, attempts: 0 };
  const url = new URL(ROUTES[route], base).toString();
  let status = await post(url, token, event, fetchImpl, timeoutMs);
  let attempts = 1;
  if (status === 0 || RETRYABLE.has(status)) {
    await sleep(retryDelayMs);
    status = await post(url, token, { ...event, attempt: 2 }, fetchImpl, timeoutMs);
    attempts = 2;
  }
  const outcome = status === 204 ? 'accepted' : status === 202 || status === 409 ? 'duplicate'
    : status === 0 || RETRYABLE.has(status) ? 'failed' : 'rejected';
  return { outcome, status, attempts };
}

export function stageBody(stage, { qa = false } = {}) {
  if (!STAGES.includes(stage)) throw new TypeError('unknown analytics stage');
  return qa ? { stage, qa: true } : { stage };
}

// Map one GA4 Measurement Protocol attempt to its stage. HTTP 2xx is only a
// receipt: GA4 reports remain the processing proof.
export function ga4Stage({ status = null, timedOut = false, networkError = false } = {}) {
  if (Number.isInteger(status) && status >= 200 && status < 300) return 'ga_ok';
  // A redirect is never followed and a 4xx is a refusal: GA4 kept nothing.
  if (Number.isInteger(status) && status >= 300 && status < 500) return 'ga_fail_definite';
  if (Number.isInteger(status) || timedOut || networkError) return 'ga_fail_uncertain';
  throw new TypeError('GA4 outcome is unknown');
}
