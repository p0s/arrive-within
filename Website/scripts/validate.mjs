import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DIST,
  ROOT,
  UNBOUND_PUBLIC_BASE_URL,
  assertRegularFile,
  assertToolchain,
  hashTree,
  hashWebsiteSource,
  listFiles,
  resolvePublicBaseURL,
  sha256,
} from "./lib.mjs";
import { repositoryURL } from "../src/content.mjs";

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

function inspectPng(file, bytes, size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    !bytes.subarray(0, 8).equals(signature)
    || bytes.toString("ascii", 12, 16) !== "IHDR"
    || bytes.readUInt32BE(16) !== size
    || bytes.readUInt32BE(20) !== size
    || bytes[24] !== 8
    || bytes[25] !== 2
  ) {
    throw new Error(`${file}: expected an opaque 8-bit RGB ${size}x${size} PNG`);
  }
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
  const currentSource = await hashWebsiteSource();
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
  if (
    provenance.schema_version !== 1 ||
    provenance.assets.length !== 11 ||
    provenance.public_media_source_state !== "current-source-renderer-media-regenerated-and-reviewed-locally" ||
    provenance.public_media_source_revision !== "e001e54e6cbecd30a8080dd5e3f9014650bcc253ca28cbe86c27185b231fc284" ||
    !provenance.public_media_review.includes("pavilion") ||
    !provenance.public_media_next_action.includes("future renderer changes")
  ) throw new Error("website asset provenance must bind the current Garden renderer media and review boundary");
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

  const brandProvenance = JSON.parse(await readFile(path.join(ROOT, "src", "assets", "brand-provenance.json"), "utf8"));
  if (
    brandProvenance.schema_version !== 1
    || brandProvenance.selection !== "B — Quiet Threshold"
    || brandProvenance.canonical_source !== "Apps/ArriveWithin/Resources/AppIcon.icon"
    || brandProvenance.derived_manifest !== "docs/brand/app-icon-derived/_manifest.json"
    || brandProvenance.assets?.length !== 2
    || !brandProvenance.rights?.includes("trademark rights remain reserved")
  ) {
    throw new Error("website brand provenance does not match the selected Quiet Threshold contract");
  }
  for (const [file, size] of [["brand-icon-40.png", 40], ["brand-icon-180.png", 180]]) {
    const asset = brandProvenance.assets.find((item) => item.file === file);
    if (
      !asset
      || asset.width !== size
      || asset.height !== size
      || asset.color_space !== "RGB"
      || asset.alpha !== false
      || asset.source !== `docs/brand/app-icon-derived/AppIcon-Default-${size}.png`
    ) {
      throw new Error(`${file}: incomplete website brand provenance`);
    }
    const canonical = await readFile(path.join(path.resolve(ROOT, ".."), asset.source));
    const source = await readFile(path.join(ROOT, "src", "assets", file));
    const output = await readFile(path.join(DIST, "assets", file));
    inspectPng(file, source, size);
    if (sha256(canonical) !== asset.sha256 || sha256(source) !== asset.sha256 || sha256(output) !== asset.sha256) {
      throw new Error(`${file}: website brand asset hash mismatch`);
    }
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
    if (!html.includes(`href="${repositoryURL}"`)) throw new Error(`${route}: missing canonical public repository link`);
    if (!html.includes('property="og:site_name" content="Arrive Within"') || !html.includes('property="og:image:alt"')) throw new Error(`${route}: incomplete social metadata`);
    if (!html.includes('rel="icon" type="image/png" sizes="40x40" href="/assets/brand-icon-40.png"')) throw new Error(`${route}: missing browser icon`);
    if (!html.includes('rel="apple-touch-icon" sizes="180x180" href="/assets/brand-icon-180.png"')) throw new Error(`${route}: missing Apple touch icon`);
    if ((html.match(/class="brand-mark"/g) ?? []).length !== 2) throw new Error(`${route}: header and footer must use the selected visible brand mark`);
    if (/<script\b|<form\b|<iframe\b|<object\b|<embed\b/i.test(html)) throw new Error(`${route}: active or form content is forbidden`);
    if (/google-analytics|googletagmanager|gtag\s*\(|posthog|mixpanel|segment\.io|facebook\.net|doubleclick/i.test(html)) {
      throw new Error(`${route}: analytics or tracking marker found`);
    }
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const src = tag.match(/\bsrc="([^"]+)"/)?.[1];
      const altMatch = tag.match(/\balt="([^"]*)"/);
      const alt = altMatch?.[1];
      const decorative = alt === "" && /\baria-hidden="true"/.test(tag);
      if (!src?.startsWith("/assets/") || !altMatch || (!decorative && !alt.trim())) throw new Error(`${route}: every image needs a local source and an accessible alt contract`);
      if (!outputFiles.includes(src.slice(1))) throw new Error(`${route}: missing image ${src}`);
    }
    for (const match of html.matchAll(/<source\b[^>]*\bsrcset="([^"]+)"[^>]*>/gi)) {
      const srcset = match[1];
      if (!srcset.startsWith("/assets/") || !outputFiles.includes(srcset.slice(1))) throw new Error(`${route}: missing local responsive image ${srcset}`);
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
        if (href !== repositoryURL && new URL(href).origin !== publicBaseURL) {
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
  for (const required of ["prefers-reduced-motion: no-preference", "prefers-reduced-motion: reduce", ".hero-atmosphere", ".brand-mark"]) {
    if (!css.includes(required)) throw new Error(`website CSS missing visual/accessibility contract: ${required}`);
  }
  const vercel = JSON.parse(await readFile(path.join(ROOT, "vercel.json"), "utf8"));
  const headers = JSON.stringify(vercel.headers);
  for (const required of ["Content-Security-Policy", "Permissions-Policy", "Referrer-Policy", "X-Content-Type-Options"]) {
    if (!headers.includes(required)) throw new Error(`vercel.json missing security header ${required}`);
  }
  if (!headers.includes("media-src 'self'")) throw new Error("vercel.json must allow only same-origin website media");

  const fullHash = await hashTree(DIST);
  process.stdout.write(`Website validation passed: ${expectedRoutes.length} bilingual routes, 8 provenance-bound UI images, 3 provenance-bound public-media assets, 2 provenance-bound brand icons, ${fullHash.files.length} output files; build SHA-256 ${fullHash.sha256}. Host/domain binding is externally verified; this local build is not deployment proof.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
