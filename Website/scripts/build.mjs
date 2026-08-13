import { copyFile, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { repositoryURL, siteContent } from "../src/content.mjs";
import {
  DIST,
  ROOT,
  UNBOUND_PUBLIC_BASE_URL,
  assertToolchain,
  escapeHtml,
  hashTree,
  hashWebsiteSource,
  listFiles,
  resolvePublicBaseURL,
} from "./lib.mjs";

const BASE_URL = resolvePublicBaseURL();
const ROUTES = [
  { locale: "en", page: "home", route: "/", output: "index.html" },
  { locale: "de", page: "home", route: "/de", output: "de/index.html" },
  { locale: "en", page: "support", route: "/support", output: "support/index.html" },
  { locale: "de", page: "support", route: "/de/support", output: "de/support/index.html" },
  { locale: "en", page: "privacy", route: "/privacy", output: "privacy/index.html" },
  { locale: "de", page: "privacy", route: "/de/privacy", output: "de/privacy/index.html" },
  { locale: "en", page: "openSource", route: "/open-source", output: "open-source/index.html" },
  { locale: "de", page: "openSource", route: "/de/open-source", output: "de/open-source/index.html" },
];

function routeFor(locale, page) {
  const route = ROUTES.find((item) => item.locale === locale && item.page === page)?.route;
  if (!route) throw new Error(`missing route ${locale}/${page}`);
  return route;
}

function asset(locale, name) {
  const suffix = locale === "de" ? "de" : "en";
  return `/assets/${name}-${suffix}`;
}

function brandMark() {
  return '<img class="brand-mark" src="/assets/brand-icon-180.png" width="180" height="180" alt="" aria-hidden="true">';
}

function navigation(locale, activePage) {
  const content = siteContent[locale];
  const home = routeFor(locale, "home");
  const counterpart = locale === "en" ? "de" : "en";
  const switchRoute = routeFor(counterpart, activePage);
  return `<header class="site-header">
    <a class="skip-link" href="#main">${locale === "de" ? "Zum Inhalt" : "Skip to content"}</a>
    <nav class="navigation" aria-label="${locale === "de" ? "Hauptnavigation" : "Primary navigation"}">
      <a class="brand"${activePage === "home" ? ' aria-current="page"' : ""} href="${home}" aria-label="Arrive Within ${content.nav.home}">${brandMark()}<span>Arrive Within</span></a>
      <div class="nav-links">
        <a href="${home}#practice">${escapeHtml(content.nav.practice)}</a>
        <a${activePage === "privacy" ? ' aria-current="page"' : ""} href="${routeFor(locale, "privacy")}">${escapeHtml(content.nav.privacy)}</a>
        <a${activePage === "openSource" ? ' aria-current="page"' : ""} href="${routeFor(locale, "openSource")}">${escapeHtml(content.nav.openSource)}</a>
        <a${activePage === "support" ? ' aria-current="page"' : ""} href="${routeFor(locale, "support")}">${escapeHtml(content.nav.support)}</a>
      </div>
      <a class="language-link" href="${switchRoute}" hreflang="${counterpart}" aria-label="${locale === "de" ? "Zu Englisch wechseln" : "Switch to German"}">${content.switchLabel}</a>
    </nav>
  </header>`;
}

function footer(locale) {
  const content = siteContent[locale];
  return `<footer class="site-footer">
    <div><a class="brand footer-brand" href="${routeFor(locale, "home")}">${brandMark()}<span>Arrive Within</span></a><p>${escapeHtml(content.footer.statement)}</p></div>
    <div class="footer-status"><p>${escapeHtml(content.footer.status)}</p><p>${escapeHtml(content.footer.copyright)}</p></div>
    <nav aria-label="${locale === "de" ? "Fußzeile" : "Footer"}">
      <a href="${routeFor(locale, "support")}">${escapeHtml(content.nav.support)}</a>
      <a href="${routeFor(locale, "privacy")}">${escapeHtml(content.nav.privacy)}</a>
      <a href="${routeFor(locale, "openSource")}">${escapeHtml(content.nav.openSource)}</a>
      <a href="${repositoryURL}">${escapeHtml(content.nav.source)}</a>
    </nav>
  </footer>`;
}

function shell(locale, page, metaTitle, metaDescription, body) {
  const content = siteContent[locale];
  const counterpart = locale === "en" ? "de" : "en";
  const route = routeFor(locale, page);
  const alternateRoute = routeFor(counterpart, page);
  const socialImageAlt = locale === "de"
    ? "Arrive Within mit einem gewachsenen nächtlichen Garten und dem Satz Meditation, die wächst."
    : "Arrive Within with a mature night garden and the words Meditation that grows.";
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f8f1df" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#071b14" media="(prefers-color-scheme: dark)">
  <meta name="application-name" content="Arrive Within">
  <meta name="apple-mobile-web-app-title" content="Arrive Within">
  <meta name="description" content="${escapeHtml(metaDescription)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Arrive Within">
  <meta property="og:locale" content="${content.locale.replace("-", "_")}">
  <meta property="og:url" content="${BASE_URL}${route}">
  <meta property="og:title" content="${escapeHtml(metaTitle)}">
  <meta property="og:description" content="${escapeHtml(metaDescription)}">
  <meta property="og:image" content="${BASE_URL}/assets/social-preview.png">
  <meta property="og:image:alt" content="${escapeHtml(socialImageAlt)}">
  <meta property="og:image:width" content="1280">
  <meta property="og:image:height" content="640">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(metaTitle)}">
  <meta name="twitter:description" content="${escapeHtml(metaDescription)}">
  <meta name="twitter:image" content="${BASE_URL}/assets/social-preview.png">
  <meta name="twitter:image:alt" content="${escapeHtml(socialImageAlt)}">
  <meta name="robots" content="index,follow">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; media-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'">
  <link rel="canonical" href="${BASE_URL}${route}">
  <link rel="alternate" hreflang="${locale}" href="${BASE_URL}${route}">
  <link rel="alternate" hreflang="${counterpart}" href="${BASE_URL}${alternateRoute}">
  <link rel="alternate" hreflang="x-default" href="${BASE_URL}${routeFor("en", page)}">
  <link rel="icon" type="image/png" sizes="40x40" href="/assets/brand-icon-40.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/brand-icon-180.png">
  <link rel="stylesheet" href="/assets/site.css">
  <title>${escapeHtml(metaTitle)}</title>
</head>
<body class="page-${page}">
  ${navigation(locale, page)}
  ${body}
  ${footer(locale)}
</body>
</html>\n`;
}

function homePage(locale) {
  const content = siteContent[locale];
  const home = content.home;
  const alt = locale === "de"
    ? {
        hero: "Ein gewachsener Arrive Within Garten unter einem ruhigen Nachthimmel.",
        gardenPhone: "Arrive Within auf dem iPhone mit einem gewachsenen Garten und der Aktion Meditieren.",
        gardenPad: "Der gewachsene Arrive Within Garten im angepassten iPad-Layout.",
        journey: "Der private Praxiskalender in Arrive Within zeigt einen ehrlichen Rhythmus ohne Streak-Druck.",
        journal: "Das private Arrive Within Journal mit Reflexionseditor auf dem iPad.",
      }
    : {
        hero: "A mature Arrive Within garden beneath a quiet night sky.",
        gardenPhone: "Arrive Within on iPhone showing a mature living garden and the Meditate action.",
        gardenPad: "The mature Arrive Within garden in the adaptive iPad layout.",
        journey: "The private Arrive Within practice calendar shows an honest rhythm without streak pressure.",
        journal: "The private Arrive Within journal and reflection editor on iPad.",
      };
  const modes = home.modes.items
    .map((item, index) => `<li><span class="mode-number">0${index + 1}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.text)}</p></li>`)
    .join("");
  const facts = home.growth.facts.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const body = `<main id="main">
    <section class="hero" aria-labelledby="hero-title">
      <picture class="hero-atmosphere">
        <source media="(max-width: 640px)" srcset="${asset(locale, "garden")}-iphone.png">
        <img src="/assets/garden-growth-poster.png" width="1280" height="720" alt="${escapeHtml(alt.hero)}" fetchpriority="high">
      </picture>
      <div class="hero-copy">
        <p class="eyebrow">${escapeHtml(home.eyebrow)}</p>
        <h1 id="hero-title"><span class="hero-product">Arrive Within</span><span class="hero-promise">${escapeHtml(home.title)}</span></h1>
        <p class="lede">${escapeHtml(home.intro)}</p>
        <div class="actions"><a class="primary-action light" href="#garden-film">${escapeHtml(home.primaryAction)}</a><a class="text-action on-dark" href="${routeFor(locale, "privacy")}">${escapeHtml(home.secondaryAction)}</a></div>
      </div>
    </section>

    <section class="growth-film-section" id="garden-film">
      <div class="section-heading"><p class="eyebrow">${escapeHtml(home.media.kicker)}</p><h2>${escapeHtml(home.media.title)}</h2><p>${escapeHtml(home.media.body)}</p></div>
      <figure class="growth-film">
        <video controls preload="metadata" poster="/assets/garden-growth-poster.png" aria-label="${escapeHtml(home.media.label)}">
          <source src="/assets/garden-growth-v1.mp4" type="video/mp4">
          <a href="/assets/garden-growth-v1.mp4">${escapeHtml(home.media.fallback)}</a>
        </video>
      </figure>
    </section>

    <section class="growth-section" id="growth">
      <div class="section-copy"><p class="eyebrow">${escapeHtml(home.growth.kicker)}</p><h2>${escapeHtml(home.growth.title)}</h2><p>${escapeHtml(home.growth.body)}</p><ul class="fact-line">${facts}</ul></div>
      <figure class="wide-device"><img loading="lazy" src="${asset(locale, "garden")}-ipad.png" width="2064" height="2752" alt="${escapeHtml(alt.gardenPad)}"></figure>
    </section>

    <section class="modes-section" id="practice">
      <div class="section-heading"><p class="eyebrow">${escapeHtml(home.modes.kicker)}</p><h2>${escapeHtml(home.modes.title)}</h2><p>${escapeHtml(home.modes.body)}</p></div>
      <ol class="mode-list">${modes}</ol>
    </section>

    <section class="journey-section">
      <figure class="journey-visual"><div class="device phone compact"><img loading="lazy" src="${asset(locale, "journey")}-iphone.png" width="1206" height="2622" alt="${escapeHtml(alt.journey)}"></div></figure>
      <div class="section-copy"><p class="eyebrow">${escapeHtml(home.journey.kicker)}</p><h2>${escapeHtml(home.journey.title)}</h2><p>${escapeHtml(home.journey.body)}</p></div>
    </section>

    <section class="privacy-section">
      <div class="section-copy"><p class="eyebrow">${escapeHtml(home.privacy.kicker)}</p><h2>${escapeHtml(home.privacy.title)}</h2><p>${escapeHtml(home.privacy.body)}</p><a class="text-action on-dark" href="${routeFor(locale, "privacy")}">${escapeHtml(home.privacy.link)}</a></div>
      <figure class="journal-visual"><img loading="lazy" src="${asset(locale, "journal")}-ipad.png" width="2064" height="2752" alt="${escapeHtml(alt.journal)}"></figure>
    </section>

    <section class="open-section">
      <p class="eyebrow">${escapeHtml(home.open.kicker)}</p><h2>${escapeHtml(home.open.title)}</h2><p>${escapeHtml(home.open.body)}</p><a class="primary-action light" href="${routeFor(locale, "openSource")}">${escapeHtml(home.open.link)}</a>
    </section>
  </main>`;
  return shell(locale, "home", home.metaTitle, home.metaDescription, body);
}

function supportPage(locale) {
  const page = siteContent[locale].support;
  const faqs = page.faqs.map((item) => `<section><h2>${escapeHtml(item.q)}</h2><p>${escapeHtml(item.a)}</p></section>`).join("");
  const body = `<main id="main" class="article-shell"><header class="article-hero"><p class="eyebrow">${escapeHtml(page.eyebrow)}</p><h1>${escapeHtml(page.title)}</h1><p class="lede">${escapeHtml(page.intro)}</p></header><article class="article-content">${faqs}<section class="support-route"><h2>${locale === "de" ? "Rückmeldung" : "Feedback"}</h2><p>${escapeHtml(page.feedbackNote)}</p><p class="status-note">${escapeHtml(page.feedbackLabel)}</p></section></article></main>`;
  return shell(locale, "support", page.metaTitle, page.metaDescription, body);
}

function privacyPage(locale) {
  const page = siteContent[locale].privacyPage;
  const sections = page.sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${section.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}</section>`).join("");
  const body = `<main id="main" class="article-shell"><header class="article-hero"><p class="eyebrow">${escapeHtml(page.eyebrow)}</p><h1>${escapeHtml(page.title)}</h1><p class="lede">${escapeHtml(page.intro)}</p></header><article class="article-content">${sections}</article></main>`;
  return shell(locale, "privacy", page.metaTitle, page.metaDescription, body);
}

function openSourcePage(locale) {
  const page = siteContent[locale].openSourcePage;
  const principles = page.principles.map((item, index) => `<li><span class="mode-number">0${index + 1}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.text)}</p></li>`).join("");
  const body = `<main id="main" class="article-shell open-source-shell"><header class="article-hero"><p class="eyebrow">${escapeHtml(page.eyebrow)}</p><h1>${escapeHtml(page.title)}</h1><p class="lede">${escapeHtml(page.intro)}</p></header><ol class="principle-list">${principles}</ol><section class="repository-callout"><a class="primary-action repository-status" href="${repositoryURL}">${escapeHtml(page.repoLabel)}</a><p>${escapeHtml(page.repoNote)}</p></section></main>`;
  return shell(locale, "openSource", page.metaTitle, page.metaDescription, body);
}

function render(route) {
  if (route.page === "home") return homePage(route.locale);
  if (route.page === "support") return supportPage(route.locale);
  if (route.page === "privacy") return privacyPage(route.locale);
  return openSourcePage(route.locale);
}

async function cleanDist() {
  if (DIST !== path.join(ROOT, "dist") || !DIST.startsWith(`${ROOT}${path.sep}`)) throw new Error("invalid website dist path");
  try {
    const stat = await lstat(DIST);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("website dist must be a real directory");
    await rm(DIST, { recursive: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(DIST, { recursive: true });
}

async function main() {
  assertToolchain();
  await cleanDist();
  const sourceHash = await hashWebsiteSource();

  for (const route of ROUTES) {
    const output = path.join(DIST, route.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, render(route));
  }
  await mkdir(path.join(DIST, "assets"), { recursive: true });
  await copyFile(path.join(ROOT, "src", "site.css"), path.join(DIST, "assets", "site.css"));
  for (const relative of await listFiles(path.join(ROOT, "src", "assets"))) {
    const output = path.join(DIST, "assets", relative);
    await mkdir(path.dirname(output), { recursive: true });
    await copyFile(path.join(ROOT, "src", "assets", relative), output);
  }

  const sitemapUrls = ROUTES.map((route) => `  <url><loc>${BASE_URL}${route.route}</loc></url>`).join("\n");
  await writeFile(path.join(DIST, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls}\n</urlset>\n`);
  await writeFile(path.join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`);
  await writeFile(path.join(DIST, "404.html"), shell("en", "home", "Not found — Arrive Within", "The requested Arrive Within page was not found.", `<main id="main" class="article-shell"><header class="article-hero"><p class="eyebrow">404</p><h1>That path has not taken root.</h1><p class="lede">Return to the quiet place we know.</p><a class="primary-action" href="/">Return home</a></header></main>`));

  const contentHash = await hashTree(DIST, new Set(["_build-manifest.json"]));
  const assetProvenance = JSON.parse(await readFile(path.join(ROOT, "src", "assets", "provenance.json"), "utf8"));
  const manifest = {
    schema_version: 1,
    product: "Arrive Within",
    state: "local-build-verified-pending-validation",
    generated_at: null,
    generation_time_policy: "omitted-for-byte-reproducibility",
    source_sha256: sourceHash.sha256,
    content_sha256: contentHash.sha256,
    source_file_count: sourceHash.files.length,
    output_file_count_excluding_manifest: contentHash.files.length,
    capture_source_revision: assetProvenance.source_revision,
    routes: ROUTES.map(({ route }) => route),
    host: {
      provider: "Vercel",
      plan: "Hobby",
      intended_project: "arrive-within",
      project_binding: "verified-external-readback-2026-08-12",
      custom_domain: "arrivewithin.com",
      public_base_url: BASE_URL,
      public_base_url_state: BASE_URL === UNBOUND_PUBLIC_BASE_URL ? "unbound-local-placeholder" : "deployment-bound",
    },
    external_network_dependencies: [],
    deployment_authorization: "authorized-verified-hobby-project-and-owner-domain",
    deployment_performed: false,
  };
  await writeFile(path.join(DIST, "_build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const fullHash = await hashTree(DIST);
  process.stdout.write(`${JSON.stringify({ source_sha256: sourceHash.sha256, content_sha256: contentHash.sha256, build_output_sha256: fullHash.sha256, files: fullHash.files.length, routes: ROUTES.length })}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
