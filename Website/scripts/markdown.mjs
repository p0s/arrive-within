import { appStoreURL, repositoryURL, siteContent } from "../src/content.mjs";
import { CONTENT_SIGNAL, markdownPath } from "../src/agent-access.mjs";

const PAGES = ["home", "support", "privacy", "openSource"];

export function escapeMarkdown(value) {
  return String(value)
    .replace(/[\\`*_[\]<>]/g, "\\$&")
    .replace(/^([#+-]|\d+[.)])(?=\s)/gm, (marker) => `${marker.slice(0, -1)}\\${marker.slice(-1)}`);
}

const text = escapeMarkdown;
const link = (label, url) => `[${text(label)}](${url})`;
const image = (alt, url) => `![${text(alt)}](${url})`;
const list = (items) => items.map((item) => `- ${item}`).join("\n");
const orderedList = (items) => items.map((item, index) => `${index + 1}. ${item}`).join("\n");

function responsive(name, width) {
  return `/assets/responsive/${name}-${width}.webp`;
}

export function pageMeta(locale, page) {
  const content = siteContent[locale];
  const source = { home: content.home, support: content.support, privacy: content.privacyPage, openSource: content.openSourcePage }[page];
  if (!source) throw new Error(`missing page metadata ${locale}/${page}`);
  return { title: source.metaTitle, description: source.metaDescription };
}

function frontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "object") {
      lines.push(`${key}:`);
      for (const [child, childValue] of Object.entries(value)) lines.push(`  ${child}: ${JSON.stringify(childValue)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function homeBlocks(locale, absolute, routeFor) {
  const content = siteContent[locale];
  const home = content.home;
  const starter = home.starter;
  const preview = starter.preview;
  return [
    `# Arrive Within — ${text(home.title)}`,
    text(home.eyebrow),
    text(home.intro),
    link(home.primaryAction, appStoreURL),
    image(home.imageAlt.hero, absolute(responsive("garden-growth-poster", 1280))),
    `## ${text(home.media.title)}`,
    text(home.media.kicker),
    text(home.media.body),
    link(home.media.fallback, absolute("/assets/garden-growth-v1.mp4")),
    text(home.media.description),
    `## ${text(home.growth.title)}`,
    text(home.growth.kicker),
    text(home.growth.body),
    list(home.growth.facts.map(text)),
    image(home.imageAlt.gardenPad, absolute(responsive(`garden-${locale}-ipad`, 960))),
    `## ${text(home.modes.title)}`,
    text(home.modes.kicker),
    text(home.modes.body),
    orderedList(home.modes.items.map((item) => `${text(item.name)}: ${text(item.text)}`)),
    `## ${text(starter.title)}`,
    text(starter.kicker),
    text(starter.intro),
    text(starter.privacy),
    link(starter.action, appStoreURL),
    orderedList(starter.steps.map((step) => `${text(step.title)}: ${text(step.text)}`)),
    `### ${text(preview.title)}`,
    preview.paragraphs.map((paragraph) => `> ${text(paragraph)}`).join("\n>\n"),
    text(preview.note),
    `${text(content.markdown.excerptSource)}: \`${preview.source}\` (${link(content.nav.source, repositoryURL)})`,
    `## ${text(home.journey.title)}`,
    text(home.journey.kicker),
    text(home.journey.body),
    image(home.imageAlt.journey, absolute(responsive(`journey-${locale}-iphone`, 720))),
    `## ${text(home.privacy.title)}`,
    text(home.privacy.kicker),
    text(home.privacy.body),
    link(home.privacy.link, absolute(routeFor(locale, "privacy"))),
    image(home.imageAlt.journal, absolute(responsive(`journal-${locale}-ipad`, 960))),
    `## ${text(home.open.title)}`,
    text(home.open.kicker),
    text(home.open.body),
    link(home.open.link, absolute(routeFor(locale, "openSource"))),
  ];
}

function supportBlocks(locale) {
  const page = siteContent[locale].support;
  return [
    `# ${text(page.title)}`,
    text(page.eyebrow),
    text(page.intro),
    ...page.faqs.flatMap((item) => [`## ${text(item.q)}`, text(item.a)]),
    `## ${text(page.feedbackTitle)}`,
    text(page.feedbackNote),
    text(page.feedbackLabel),
  ];
}

function privacyBlocks(locale) {
  const content = siteContent[locale];
  const page = content.privacyPage;
  const choice = page.analyticsChoice;
  return [
    `# ${text(page.title)}`,
    text(page.eyebrow),
    text(page.intro),
    ...page.sections.flatMap((section) => [`## ${text(section.title)}`, ...section.paragraphs.map(text)]),
    `## ${text(choice.title)}`,
    ...choice.paragraphs.map(text),
    text(content.markdown.preferenceControls),
    list([text(choice.optOutLabel), text(choice.optInLabel)]),
  ];
}

function openSourceBlocks(locale) {
  const page = siteContent[locale].openSourcePage;
  return [
    `# ${text(page.title)}`,
    text(page.eyebrow),
    text(page.intro),
    orderedList(page.principles.map((item) => `${text(item.title)}: ${text(item.text)}`)),
    link(page.repoLabel, repositoryURL),
    text(page.repoNote),
  ];
}

function footerBlocks(locale, page, absolute, routeFor) {
  const content = siteContent[locale];
  const counterpart = locale === "en" ? "de" : "en";
  return [
    `## ${text(content.markdown.pagesHeading)}`,
    list([
      link(content.nav.home, absolute(routeFor(locale, "home"))),
      link(content.nav.support, absolute(routeFor(locale, "support"))),
      link(content.nav.privacy, absolute(routeFor(locale, "privacy"))),
      link(content.nav.openSource, absolute(routeFor(locale, "openSource"))),
      link(siteContent[counterpart].languageName, absolute(routeFor(counterpart, page))),
      link(content.markdown.appStoreLink, appStoreURL),
      link(content.nav.source, repositoryURL),
    ]),
    `## ${text(content.markdown.licensesHeading)}`,
    `${text(content.footer.statement)} ${text(content.footer.status)} ${text(content.footer.copyright)}`,
    content.markdown.licensesMarkdown,
  ];
}

// Each Markdown page is rendered from the same content source as its HTML
// page, so text, links, dates, and release-status qualifiers stay identical.
export function renderPageMarkdown({ locale, page, baseURL, routeFor }) {
  const absolute = (pathname) => `${baseURL}${pathname}`;
  const counterpart = locale === "en" ? "de" : "en";
  const meta = pageMeta(locale, page);
  const body = {
    home: () => homeBlocks(locale, absolute, routeFor),
    support: () => supportBlocks(locale),
    privacy: () => privacyBlocks(locale),
    openSource: () => openSourceBlocks(locale),
  }[page]();
  const blocks = [
    frontmatter({
      title: meta.title,
      description: meta.description,
      url: absolute(routeFor(locale, page)),
      language: locale,
      alternates: { [counterpart]: absolute(routeFor(counterpart, page)) },
      content_signal: CONTENT_SIGNAL,
    }),
    ...body,
    ...footerBlocks(locale, page, absolute, routeFor),
  ];
  return `${blocks.join("\n\n")}\n`;
}

export function renderLlmsTxt({ baseURL, routeFor }) {
  const english = siteContent.en;
  const entry = (locale, page) => {
    const meta = pageMeta(locale, page);
    return `- ${link(meta.title, `${baseURL}${markdownPath(routeFor(locale, page))}`)}: ${text(meta.description)}`;
  };
  const blocks = [
    "# Arrive Within",
    `> ${text(english.home.metaDescription)}`,
    `${text(english.home.intro)} ${text(english.footer.status)}`,
    `Each page link below is the Markdown version of a canonical English or German HTML page. Request any page URL with \`Accept: text/markdown\` to receive the same Markdown. robots.txt declares the Content Signals \`${CONTENT_SIGNAL}\`.`,
    "## English",
    PAGES.map((page) => entry("en", page)).join("\n"),
    "## Deutsch",
    PAGES.map((page) => entry("de", page)).join("\n"),
    "## Optional",
    list([
      `${link(english.markdown.appStoreLink, appStoreURL)}: ${text(english.footer.status)}`,
      `${link(english.nav.source, repositoryURL)}: ${text(english.openSourcePage.repoNote)}`,
    ]),
  ];
  return `${blocks.join("\n\n")}\n`;
}
