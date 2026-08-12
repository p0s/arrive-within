import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DIST,
  ROOT,
  UNBOUND_PUBLIC_BASE_URL,
  assertRegularFile,
  assertToolchain,
  hashTree,
  listFiles,
  resolvePublicBaseURL,
  sha256,
} from "./lib.mjs";

const expectedRoutes = ["/", "/de", "/support", "/de/support", "/privacy", "/de/privacy", "/open-source", "/de/open-source"];
const routeFiles = {
  "/": "index.html",
  "/de": "de/index.html",
  "/support": "support/index.html",
  "/de/support": "de/support/index.html",
  "/privacy": "privacy/index.html",
  "/de/privacy": "de/privacy/index.html",
  "/open-source": "open-source/index.html",
  "/de/open-source": "de/open-source/index.html",
};

function localTarget(href) {
  const pathOnly = href.split("#", 1)[0].split("?", 1)[0];
  return pathOnly || null;
}

async function main() {
  assertToolchain();
  const publicBaseURL = resolvePublicBaseURL();
  if (resolvePublicBaseURL("") !== UNBOUND_PUBLIC_BASE_URL) {
    throw new Error("empty public-origin input must fail closed to the reserved local origin");
  }
  if (resolvePublicBaseURL("https://release.example.invalid/") !== "https://release.example.invalid") {
    throw new Error("public-origin normalization is not deterministic");
  }
  const credentialBearingOrigin = ["https://fixture:fixture", "release.example.invalid"].join(String.fromCharCode(64));
  for (const invalid of [
    "http://release.example.invalid",
    credentialBearingOrigin,
    "https://release.example.invalid/path",
    "https://release.example.invalid?candidate=1",
    "https://release.example.invalid#candidate",
  ]) {
    let rejected = false;
    try {
      resolvePublicBaseURL(invalid);
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error(`unsafe public origin was accepted: ${invalid}`);
  }
  const manifestPath = path.join(DIST, "_build-manifest.json");
  await assertRegularFile(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const currentSource = await hashTree(ROOT, new Set(["dist", "node_modules"]));
  const currentContent = await hashTree(DIST, new Set(["_build-manifest.json"]));
  if (
    manifest.schema_version !== 1 ||
    manifest.generated_at !== null ||
    manifest.generation_time_policy !== "omitted-for-byte-reproducibility" ||
    manifest.source_sha256 !== currentSource.sha256 ||
    manifest.content_sha256 !== currentContent.sha256 ||
    JSON.stringify(manifest.routes) !== JSON.stringify(expectedRoutes) ||
    manifest.deployment_authorization !== "authorized-verified-hobby-project-and-owner-domain" ||
    manifest.deployment_performed !== false ||
    manifest.host?.provider !== "Vercel" ||
    manifest.host?.plan !== "Hobby" ||
    manifest.host?.intended_project !== "arrive-within" ||
    manifest.host?.project_binding !== "verified-external-readback-2026-08-12" ||
    manifest.host?.custom_domain !== "arrivewithin.com" ||
    manifest.host?.public_base_url !== publicBaseURL ||
    manifest.host?.public_base_url_state !== (publicBaseURL === UNBOUND_PUBLIC_BASE_URL ? "unbound-local-placeholder" : "deployment-bound") ||
    manifest.external_network_dependencies.length !== 0
  ) {
    throw new Error("website build manifest does not match the current deterministic source/output contract");
  }

  const provenance = JSON.parse(await readFile(path.join(ROOT, "src", "assets", "provenance.json"), "utf8"));
  if (provenance.schema_version !== 1 || provenance.assets.length !== 11) throw new Error("website asset provenance must contain eight app-UI images plus three public-media assets");
  for (const asset of provenance.assets) {
    const canonicalSource = path.join(path.resolve(ROOT, ".."), asset.source);
    const sourceFile = path.join(ROOT, "src", "assets", asset.file);
    const outputFile = path.join(DIST, "assets", asset.file);
    if (
      sha256(await readFile(canonicalSource)) !== asset.sha256
      || sha256(await readFile(sourceFile)) !== asset.sha256
      || sha256(await readFile(outputFile)) !== asset.sha256
    ) {
      throw new Error(`${asset.file}: website asset hash mismatch`);
    }
    if (
      !asset.alt.trim()
      || (!asset.source.startsWith("Marketing/AppStoreScreenshots/") && !asset.source.startsWith("Marketing/PublicMedia/"))
    ) throw new Error(`${asset.file}: incomplete public provenance`);
  }

  const outputFiles = await listFiles(DIST);
  for (const [route, file] of Object.entries(routeFiles)) {
    if (!outputFiles.includes(file)) throw new Error(`missing output for ${route}`);
    const html = await readFile(path.join(DIST, file), "utf8");
    const expectedLang = route.startsWith("/de") ? "de" : "en";
    if (!html.includes(`<html lang="${expectedLang}">`) || !html.includes('<main id="main"') || !html.includes('class="skip-link"')) {
      throw new Error(`${route}: missing language or accessibility landmarks`);
    }
    if (!html.includes(`rel="canonical" href="${publicBaseURL}${route}"`)) throw new Error(`${route}: incorrect canonical URL`);
    if (!html.includes(`property="og:image" content="${publicBaseURL}/assets/social-preview.png"`)) throw new Error(`${route}: missing canonical social preview`);
    if (/<script\b|<form\b|<iframe\b|<object\b|<embed\b/i.test(html)) throw new Error(`${route}: active or form content is forbidden`);
    if (/google-analytics|googletagmanager|gtag\s*\(|posthog|mixpanel|segment\.io|facebook\.net|doubleclick/i.test(html)) {
      throw new Error(`${route}: analytics or tracking marker found`);
    }
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const src = tag.match(/\bsrc="([^"]+)"/)?.[1];
      const alt = tag.match(/\balt="([^"]*)"/)?.[1];
      if (!src?.startsWith("/assets/") || !alt?.trim()) throw new Error(`${route}: every image needs a local source and nonempty alt text`);
      if (!outputFiles.includes(src.slice(1))) throw new Error(`${route}: missing image ${src}`);
    }
    for (const match of html.matchAll(/<video\b[^>]*>[\s\S]*?<\/video>/gi)) {
      const tag = match[0];
      const poster = tag.match(/\bposter="([^"]+)"/)?.[1];
      const source = tag.match(/<source\b[^>]*\bsrc="([^"]+)"/)?.[1];
      const label = tag.match(/\baria-label="([^"]+)"/)?.[1];
      if (!poster?.startsWith("/assets/") || !source?.startsWith("/assets/") || !label?.trim()) throw new Error(`${route}: video needs local poster/source and an accessible label`);
      if (!outputFiles.includes(poster.slice(1)) || !outputFiles.includes(source.slice(1))) throw new Error(`${route}: missing local video media`);
    }
    for (const match of html.matchAll(/\bhref="([^"]+)"/g)) {
      const href = match[1];
      if (href.startsWith("https://")) {
        if (new URL(href).origin !== publicBaseURL) {
          throw new Error(`${route}: unapproved external link ${href}`);
        }
        continue;
      }
      const target = localTarget(href);
      if (!target || target.startsWith("#") || target === "/assets/site.css") continue;
      if (target.startsWith("/assets/")) {
        if (!outputFiles.includes(target.slice(1))) throw new Error(`${route}: missing asset link ${target}`);
      } else if (!expectedRoutes.includes(target) && target !== "/") {
        throw new Error(`${route}: unresolved internal link ${target}`);
      }
    }
  }

  const allHtml = (await Promise.all(Object.values(routeFiles).map((file) => readFile(path.join(DIST, file), "utf8")))).join("\n");
  for (const token of ["TODO", "TBD", "lorem ipsum", "App Store badge", "Download now"]) {
    if (allHtml.toLowerCase().includes(token.toLowerCase())) throw new Error(`website contains forbidden placeholder or release claim: ${token}`);
  }
  const privacyEnglish = await readFile(path.join(DIST, routeFiles["/privacy"]), "utf8");
  const privacyGerman = await readFile(path.join(DIST, routeFiles["/de/privacy"]), "utf8");
  for (const phrase of ["No third-party analytics", "no account, backend, or cloud sync", "Microphone access", "excluded from backup"]) {
    if (!privacyEnglish.includes(phrase)) throw new Error(`English privacy page missing: ${phrase}`);
  }
  for (const phrase of ["Keine Drittanbieter-Analyse", "weder Konto, Backend noch Cloud-Synchronisierung", "Mikrofonzugriff", "von Backups ausgeschlossen"]) {
    if (!privacyGerman.includes(phrase)) throw new Error(`German privacy page missing: ${phrase}`);
  }
  const css = await readFile(path.join(DIST, "assets", "site.css"), "utf8");
  if (/@import|url\s*\(\s*["']?https?:/i.test(css)) throw new Error("website CSS may not import external resources");
  const vercel = JSON.parse(await readFile(path.join(ROOT, "vercel.json"), "utf8"));
  const headers = JSON.stringify(vercel.headers);
  for (const required of ["Content-Security-Policy", "Permissions-Policy", "Referrer-Policy", "X-Content-Type-Options"]) {
    if (!headers.includes(required)) throw new Error(`vercel.json missing security header ${required}`);
  }
  if (!headers.includes("media-src 'self'")) throw new Error("vercel.json must allow only same-origin website media");

  const fullHash = await hashTree(DIST);
  process.stdout.write(`Website validation passed: ${expectedRoutes.length} bilingual routes, 8 provenance-bound UI images, 3 provenance-bound public-media assets, ${fullHash.files.length} output files; build SHA-256 ${fullHash.sha256}. Host/domain binding is externally verified; this local build is not deployment proof.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
