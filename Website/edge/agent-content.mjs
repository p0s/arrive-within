import { CONTENT_SIGNAL, LLMS_TXT_PATH, markdownPath } from "../src/agent-access.mjs";
import { PUBLIC_HTML_PATHS } from "../src/analytics.mjs";

const MARKDOWN_PAGES = new Map([...PUBLIC_HTML_PATHS].map((page) => [markdownPath(page), page]));
const DESCRIBED_BY = `<${LLMS_TXT_PATH}>; rel="describedby"; type="text/plain"`;
const MAX_ACCEPT_LENGTH = 1024;
const HTML_RANGES = { "text/html": 3, "text/*": 2, "*/*": 1 };

function quality(parameters) {
  for (const parameter of parameters) {
    const [name, value = ""] = parameter.split("=").map((part) => part.trim());
    if (name.toLowerCase() !== "q") continue;
    return /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value) ? Number(value) : null;
  }
  return 1;
}

// Markdown needs an explicit text/markdown range that ranks at least as high
// as the most specific range matching HTML. Wildcards keep the HTML default.
export function prefersMarkdown(accept) {
  if (!accept || accept.length > MAX_ACCEPT_LENGTH) return false;
  let markdown = 0;
  let html = { specificity: 0, quality: 0 };
  for (const range of accept.split(",")) {
    const [mediaRange = "", ...parameters] = range.split(";");
    const q = quality(parameters);
    if (q === null) continue;
    const type = mediaRange.trim().toLowerCase();
    if (type === "text/markdown") markdown = Math.max(markdown, q);
    const specificity = HTML_RANGES[type] ?? 0;
    if (specificity > html.specificity) html = { specificity, quality: q };
    else if (specificity && specificity === html.specificity) html.quality = Math.max(html.quality, q);
  }
  return markdown > 0 && markdown >= html.quality;
}

function varyOnAccept(headers) {
  const vary = headers.get("Vary");
  if (!vary) headers.set("Vary", "Accept");
  else if (!vary.split(",").some((value) => ["accept", "*"].includes(value.trim().toLowerCase()))) headers.set("Vary", `${vary}, Accept`);
}

function withHeaders(response, update) {
  const headers = new Headers(response.headers);
  update(headers);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function markdownResponse(response, page, url, negotiated) {
  return withHeaders(response, (headers) => {
    headers.set("Content-Type", "text/markdown; charset=utf-8");
    headers.set("Content-Signal", CONTENT_SIGNAL);
    headers.set("Link", `<${new URL(page, url).href}>; rel="canonical", ${DESCRIBED_BY}`);
    if (negotiated) {
      headers.set("Content-Location", markdownPath(page));
      varyOnAccept(headers);
    }
  });
}

// Returns the Markdown representation of a public page when the request
// prefers it, or null so the Worker serves the HTML document.
export async function negotiatedMarkdown(request, url, assets) {
  const method = request.method.toUpperCase();
  if ((method !== "GET" && method !== "HEAD") || !PUBLIC_HTML_PATHS.has(url.pathname)) return null;
  if (!prefersMarkdown(request.headers.get("accept"))) return null;
  const response = await assets.fetch(new Request(new URL(markdownPath(url.pathname), url), { method, headers: request.headers }));
  if (response.status !== 200 && response.status !== 304) return null;
  return markdownResponse(response, url.pathname, url, true);
}

// Adds agent discovery headers to public documents and labels the direct
// Markdown and llms.txt files with their UTF-8 media types.
export function withAgentDiscovery(response, url) {
  if (response.status !== 200 && response.status !== 304) return response;
  if (PUBLIC_HTML_PATHS.has(url.pathname)) {
    if (!/\btext\/html\b/i.test(response.headers.get("content-type") || "")) return response;
    return withHeaders(response, (headers) => {
      headers.append("Link", `<${markdownPath(url.pathname)}>; rel="alternate"; type="text/markdown", ${DESCRIBED_BY}`);
      headers.set("Content-Signal", CONTENT_SIGNAL);
      varyOnAccept(headers);
    });
  }
  const page = MARKDOWN_PAGES.get(url.pathname);
  if (page) return markdownResponse(response, page, url, false);
  if (url.pathname === LLMS_TXT_PATH) {
    return withHeaders(response, (headers) => {
      headers.set("Content-Type", "text/plain; charset=utf-8");
      headers.set("Content-Signal", CONTENT_SIGNAL);
    });
  }
  return response;
}
