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
import { appStoreURL, repositoryURL, siteContent } from "../src/content.mjs";

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
const routeContracts = {
  "/": { locale: "en", page: "home", alternate: "/de", xDefault: "/" },
  "/de": { locale: "de", page: "home", alternate: "/", xDefault: "/" },
  "/support": { locale: "en", page: "support", alternate: "/de/support", xDefault: "/support" },
  "/de/support": { locale: "de", page: "support", alternate: "/support", xDefault: "/support" },
  "/privacy": { locale: "en", page: "privacy", alternate: "/de/privacy", xDefault: "/privacy" },
  "/de/privacy": { locale: "de", page: "privacy", alternate: "/privacy", xDefault: "/privacy" },
  "/open-source": { locale: "en", page: "openSource", alternate: "/de/open-source", xDefault: "/open-source" },
  "/de/open-source": { locale: "de", page: "openSource", alternate: "/open-source", xDefault: "/open-source" },
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
    const contract = routeContracts[route];
    const expectedLang = contract.locale;
    const counterpart = expectedLang === "en" ? "de" : "en";
    if (!html.includes(`<html lang="${expectedLang}">`) || !html.includes('<main id="main"') || !html.includes('class="skip-link"')) {
      throw new Error(`${route}: missing language or accessibility landmarks`);
    }
    if (!html.includes(`rel="canonical" href="${publicBaseURL}${route}"`)) throw new Error(`${route}: incorrect canonical URL`);
    if (!html.includes('<meta name="robots" content="index,follow">')) throw new Error(`${route}: indexable route robots policy mismatch`);
    const alternates = [...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map((match) => [match[1], match[2]]);
    const expectedAlternates = [
      [expectedLang, `${publicBaseURL}${route}`],
      [counterpart, `${publicBaseURL}${contract.alternate}`],
      ["x-default", `${publicBaseURL}${contract.xDefault}`],
    ];
    if (JSON.stringify(alternates) !== JSON.stringify(expectedAlternates)) throw new Error(`${route}: hreflang set is not exact and reciprocal`);
    if (!html.includes(`property="og:image" content="${publicBaseURL}/assets/social-preview.png"`)) throw new Error(`${route}: missing canonical social preview`);
    if (!html.includes(`href="${repositoryURL}"`)) throw new Error(`${route}: missing canonical public repository link`);
    if (!html.includes(`href="${appStoreURL}"`)) throw new Error(`${route}: missing verified App Store discovery link`);
    if (!html.includes('property="og:site_name" content="Arrive Within"') || !html.includes('property="og:image:alt"')) throw new Error(`${route}: incomplete social metadata`);
    if (!html.includes(`property="og:locale:alternate" content="${siteContent[counterpart].locale.replace("-", "_")}"`)) throw new Error(`${route}: missing alternate Open Graph locale`);
    if (!html.includes('rel="icon" type="image/png" sizes="40x40" href="/assets/brand-icon-40.png"')) throw new Error(`${route}: missing browser icon`);
    if (!html.includes('rel="apple-touch-icon" sizes="180x180" href="/assets/brand-icon-180.png"')) throw new Error(`${route}: missing Apple touch icon`);
    if ((html.match(/class="brand-mark"/g) ?? []).length !== 2) throw new Error(`${route}: header and footer must use the selected visible brand mark`);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    if (scripts.length !== 1 || !/^\s+type="application\/ld\+json"\s*$/i.test(scripts[0][1])) throw new Error(`${route}: exactly one inert JSON-LD script is required`);
    let schema;
    try {
      schema = JSON.parse(scripts[0][2]);
    } catch {
      throw new Error(`${route}: JSON-LD must be valid JSON`);
    }
    if (schema["@context"] !== "https://schema.org" || !Array.isArray(schema["@graph"])) throw new Error(`${route}: invalid schema graph envelope`);
    const schemaTypes = schema["@graph"].map((item) => item["@type"]);
    const expectedSchemaTypes = contract.page === "home"
      ? ["Organization", "WebSite", "SoftwareApplication"]
      : ["Organization", "WebSite", "BreadcrumbList"];
    if (JSON.stringify(schemaTypes) !== JSON.stringify(expectedSchemaTypes)) throw new Error(`${route}: structured-data types do not match the visible page`);
    const organization = schema["@graph"].find((item) => item["@type"] === "Organization");
    const website = schema["@graph"].find((item) => item["@type"] === "WebSite");
    if (
      organization?.name !== "Arrive Within"
      || organization?.url !== `${publicBaseURL}/`
      || organization?.logo?.url !== `${publicBaseURL}/assets/brand-icon-180.png`
      || JSON.stringify(organization?.sameAs) !== JSON.stringify([repositoryURL])
      || website?.name !== "Arrive Within"
      || website?.url !== `${publicBaseURL}/`
      || JSON.stringify(website?.inLanguage) !== JSON.stringify(["en-US", "de-DE"])
      || website?.publisher?.["@id"] !== `${publicBaseURL}/#organization`
    ) throw new Error(`${route}: WebSite or organization schema is unsupported or inconsistent`);
    if (contract.page === "home") {
      const application = schema["@graph"].find((item) => item["@type"] === "SoftwareApplication");
      if (
        application?.name !== "Arrive Within"
        || application?.url !== `${publicBaseURL}/`
        || application?.downloadUrl !== appStoreURL
        || application?.applicationCategory !== "HealthApplication"
        || application?.operatingSystem !== "iOS 18.0 or later"
        || application?.isAccessibleForFree !== true
        || !Array.isArray(application?.featureList)
        || application.featureList.length !== 3
        || ["offers", "aggregateRating", "review", "datePublished", "availabilityStarts"].some((key) => key in application)
      ) throw new Error(`${route}: application schema exceeds or misses the visible verified claims`);
      if ((html.match(new RegExp(`href="${appStoreURL}"`, "g")) ?? []).length < 2 || html.includes('class="breadcrumbs"')) {
        throw new Error(`${route}: home availability discovery or breadcrumb boundary mismatch`);
      }
    } else {
      const breadcrumb = schema["@graph"].find((item) => item["@type"] === "BreadcrumbList");
      const expectedBreadcrumb = [
        { "@type": "ListItem", position: 1, name: siteContent[expectedLang].nav.home, item: `${publicBaseURL}${expectedLang === "de" ? "/de" : "/"}` },
        { "@type": "ListItem", position: 2, name: siteContent[expectedLang].nav[contract.page], item: `${publicBaseURL}${route}` },
      ];
      if (JSON.stringify(breadcrumb?.itemListElement) !== JSON.stringify(expectedBreadcrumb)) throw new Error(`${route}: breadcrumb schema does not match the visible route`);
      if ((html.match(/class="breadcrumbs"/g) ?? []).length !== 1 || !html.includes('<li aria-current="page">')) throw new Error(`${route}: visible breadcrumb is missing`);
    }
    if (/<form\b|<iframe\b|<object\b|<embed\b/i.test(html)) throw new Error(`${route}: active or form content is forbidden`);
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
        if (href !== repositoryURL && href !== appStoreURL && new URL(href).origin !== publicBaseURL) {
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

  const notFound = await readFile(path.join(DIST, "404.html"), "utf8");
  if (
    !notFound.includes('<meta name="robots" content="noindex,follow">')
    || /<link rel="canonical"|<link rel="alternate"|application\/ld\+json|property="og:url"|property="og:locale:alternate"/i.test(notFound)
  ) throw new Error("404 output must be noindex,follow without canonical, alternate-locale, URL, or schema claims");

  const robots = await readFile(path.join(DIST, "robots.txt"), "utf8");
  if (robots !== `User-agent: *\nAllow: /\nSitemap: ${publicBaseURL}/sitemap.xml\n`) throw new Error("robots.txt does not match the exact crawl contract");
  const sitemap = await readFile(path.join(DIST, "sitemap.xml"), "utf8");
  const sitemapLocations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (JSON.stringify(sitemapLocations) !== JSON.stringify(expectedRoutes.map((route) => `${publicBaseURL}${route}`))) {
    throw new Error("sitemap.xml must list each canonical indexable route exactly once");
  }

  const allHtml = (await Promise.all(Object.values(routeFiles).map((file) => readFile(path.join(DIST, file), "utf8")))).join("\n");
  for (const token of ["TODO", "TBD", "lorem ipsum", "App Store badge", "Download now"]) {
    if (allHtml.toLowerCase().includes(token.toLowerCase())) throw new Error(`website contains forbidden placeholder or release claim: ${token}`);
  }
  const englishHome = await readFile(path.join(DIST, routeFiles["/"]), "utf8");
  const germanHome = await readFile(path.join(DIST, routeFiles["/de"]), "utf8");
  if (!englishHome.includes("Arrive Within is free for iPhone and iPad") || !englishHome.includes("one optional one-time purchase")) {
    throw new Error("English home page is missing the verified App Store availability boundary");
  }
  if (!germanHome.includes("Arrive Within ist für iPhone und iPad kostenlos") || !germanHome.includes("ein optionaler einmaliger Kauf")) {
    throw new Error("German home page is missing the verified App Store availability boundary");
  }
  const guidedCopy = {
    "/": ["Three quiet ways to begin.", "42 original English or German practices"],
    "/de": ["Drei ruhige Wege zu beginnen.", "42 originalen englischen oder deutschen Meditationen"],
    "/support": ["Version 1.0 includes 42 original guided practices", "packaged for offline playback"],
    "/de/support": ["Version 1.0 enthält 42 originale geführte Meditationen", "Offline-Wiedergabe"],
  };
  for (const [route, phrases] of Object.entries(guidedCopy)) {
    const html = await readFile(path.join(DIST, routeFiles[route]), "utf8");
    for (const phrase of phrases) {
      if (!html.includes(phrase)) throw new Error(`${route}: current Guided product copy missing: ${phrase}`);
    }
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
