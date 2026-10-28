import { isEligibleHTMLDocumentResponse, isEligiblePageRequest, payloadForRequest, PUBLIC_HTML_PATHS } from "../src/analytics.mjs";
import { deliver, SIGNALS, stageBody } from "./ingest-client.mjs";

const HOST = "arrivewithin.com";
const PRIVATE_QUERY = /(?:^|[&;])(?:code|email|id|key|password|secret|session|token|user)=/i;

function permittedBrowser(request) {
  const url = new URL(request.url);
  return url.protocol === "https:" && url.hostname === HOST && !url.port
    && request.cf && request.cf.botManagement?.verifiedBot !== true
    && !PRIVATE_QUERY.test(url.search.slice(1));
}

function documentRequest(request, path) {
  const url = new URL(request.url);
  if (path !== undefined) { url.pathname = path; url.search = ""; }
  const headers = new Headers(request.headers);
  // The outer Worker has verified the canonical URL. Host can describe a local
  // runtime proxy; never use that transport header as the recorded site ID.
  headers.set("host", HOST);
  return new Request(url, { headers, method: path === undefined ? request.method : "GET" });
}

function collect(config, route, body, context) {
  const work = deliver(config.ingestURL, route, config.ingestToken, body);
  if (typeof context?.waitUntil === "function") context.waitUntil(work);
  else void work;
}

export function observeDocument(request, response, config, context) {
  const allowed = Boolean(permittedBrowser(request) && isEligibleHTMLDocumentResponse(documentRequest(request), response, config));
  if (allowed) {
    const body = { ...payloadForRequest(request), hostname: HOST };
    if (new URL(request.url).searchParams.get("measurement_qa") === "1") body.qa = true;
    collect(config, "page", body, context);
  }
  if (!/\btext\/html\b/i.test(response.headers.get("content-type") || "")) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.delete("ETag");
  headers.delete("Content-Length");
  return new HTMLRewriter().on("body", { element(element) {
    element.setAttribute("data-site-measurement", allowed ? "allowed" : "denied");
  } }).transform(new Response(response.body, { status: response.status, statusText: response.statusText, headers }));
}

async function emptyBody(request) {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) !== 0)) return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  try {
    const { done } = await reader.read();
    if (!done) await reader.cancel();
    return done;
  } catch { return false; }
  finally { reader.releaseLock(); }
}

export async function measurementResponse(request, config, context) {
  const reply = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  if (url.search || url.protocol !== "https:" || url.port) return reply(404);
  if (request.method !== "POST") return reply(405);
  if (request.headers.get("origin") !== url.origin
      || ![null, "same-origin"].includes(request.headers.get("sec-fetch-site"))) return reply(403);
  const path = request.headers.get("x-analytics-path");
  const signal = request.headers.get("x-analytics-signal");
  const qaHeader = request.headers.get("x-measurement-qa");
  if (!PUBLIC_HTML_PATHS.has(path) || ![null, "1"].includes(qaHeader)
      || !["bootstrap", "visible", "engaged", "action"].includes(signal)
      || !await emptyBody(request)) return reply(400);
  const action = request.headers.get("x-analytics-action");
  if (signal === "action" ? action !== "source_repo_open" : action !== null) return reply(400);
  // The same public-document privacy/IP/UA gate applies to every signal.
  if (!permittedBrowser(request) || !isEligiblePageRequest(documentRequest(request, path), config)) return reply();
  const qa = qaHeader === "1";
  let body, route;
  if (signal === "bootstrap") {
    route = "stage"; body = stageBody("bootstrap", { qa });
  } else if (signal === "action") {
    route = "action"; body = { actionId: action, ...(qa ? { qa: true } : {}) };
  } else {
    route = "page"; body = { ...payloadForRequest(request), hostname: HOST, path, eventName: SIGNALS[signal], ...(qa ? { qa: true } : {}) };
  }
  collect(config, route, body, context);
  return reply();
}
