import { AGENT_SKILLS_SCHEMA, CONTENT_SIGNAL, LLMS_TXT_PATH, agentSkillPath, markdownPath } from "./agent-access.mjs";
import { appStoreURL, repositoryURL, siteContent } from "./content.mjs";

// Public Agent Skills for tasks the website and its public repository already
// support. Every quoted statement names its source; validation requires the
// quote in both the skill and that source, so a skill cannot drift from it.
export const SKILL_QUOTES = {
  account: { page: "support", text: "work without an account, backend, or cloud sync" },
  restore: { page: "support", text: "Choose a complete archive in Files to restore it" },
  drafts: { page: "support", text: "Save a draft as an entry before exporting if you want it in the archive" },
  cloudCopy: { page: "support", text: "The app keeps no cloud copy" },
  noCrisisCare: { page: "support", text: "not medical care, diagnosis, therapy, or crisis support" },
  browserPreference: { page: "privacy", text: "DNT and Global Privacy Control are always honored" },
  attribution: { file: "docs/legal/MEDIA_LICENSE.md", text: "Arrive Within media — Arrive Within contributors, CC BY 4.0" },
  guidedMedia: { file: "docs/legal/MEDIA_LICENSE.md", text: "`Content/guided/` scripts, transcripts, and approved original narration when present" },
  narrationExclusion: { file: "docs/legal/MEDIA_LICENSE.md", text: "generated narration or other media whose provenance ledger has not yet recorded redistribution approval" },
  proposal: { file: "CONTRIBUTING.md", text: "open a feature proposal before implementation" },
  privateReport: { file: "SECURITY.md", text: "Use the repository host's private vulnerability-reporting feature when it is enabled" },
  rootCheck: { file: "CONTRIBUTING.md", text: "Run `./scripts/check` before requesting review" },
};

const quote = (key) => `"${SKILL_QUOTES[key].text}"`;

function frontmatter(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${/^[A-Za-z0-9-]+$/.test(value) ? value : JSON.stringify(value)}`);
  return ["---", ...lines, "---"].join("\n");
}

function answersSkill({ baseURL, routeFor }) {
  const page = (locale, name) => `${baseURL}${markdownPath(routeFor(locale, name))}`;
  const support = siteContent.en.support;
  const topics = [
    ["home", "What the app is, practice modes, garden growth, a first practice"],
    ["support", "Accounts, backup and restore, deletion, feedback, medical questions"],
    ["privacy", "What the app stores, permissions, export, website activity counts"],
    ["openSource", "Source code, licenses, contributing"],
  ];
  return [
    "# Answer questions about Arrive Within",
    "Arrive Within is a meditation app for iPhone and iPad that keeps practice and reflections on the device. Its website is the public reference for product, privacy, and support answers. Use this skill to find the right page and to answer without overstating what the app or the website does.",
    "## Sources",
    "Each page has a Markdown version with the same text as its HTML page. Fetch the Markdown URL below, or request the page URL with `Accept: text/markdown`.",
    [
      "| Topic | English | German |",
      "| --- | --- | --- |",
      ...topics.map(([name, topic]) => `| ${topic} | ${page("en", name)} | ${page("de", name)} |`),
    ].join("\n"),
    `${baseURL}${LLMS_TXT_PATH} lists every page. The frontmatter of each Markdown file names the canonical page URL (\`url\`), the language, and the other-language version.`,
    "## Steps",
    [
      "1. Choose the page for the topic. Use the German page when the user writes in German.",
      "2. Fetch the current page. Do not answer from memory or from this skill alone, because the pages change when a release changes.",
      "3. Answer only from the page text. Quote or paraphrase closely, and cite the canonical page URL from the frontmatter.",
      "4. Keep every qualifier that the page states: the app version that a statement describes, the effective date of the privacy policy, and conditions such as a deliberate export.",
      "5. If no page answers the question, say so and do not guess. Point to the support page, or to the open-source page for technical questions.",
    ].join("\n"),
    "## Rules",
    [
      "- Release status: the pages separate the current App Store release from a release candidate. Never describe release-candidate behavior as available in the App Store.",
      `- Private data: the support page says that practice, garden progress, journal, journey, and reminders are stored locally and ${quote("account")}, and that ${quote("cloudCopy")}. Never ask a user for journal text, recordings, transcripts, or other personal data, and never promise to recover data.`,
      `- Website limits: the website does not run or save a practice session and has no contact form. The support page says: "${support.feedbackNote}" For help in the app, it says: "${support.feedbackLabel}".`,
      `- Health: Arrive Within is ${quote("noCrisisCare")}. If a user describes a crisis or an urgent health problem, tell them to contact local emergency services or a qualified professional.`,
      `- Website activity counts: the privacy page describes counts for the website only, not for the app. Its two controls set a preference for the browser that submits them, and ${quote("browserPreference")}. Show the user where the controls are; do not submit them for the user from another client.`,
      `- Downloads: link the App Store listing that the pages use: ${appStoreURL}`,
    ].join("\n"),
    "## Example",
    `Question: "Does Arrive Within need an account? How do I back up my journal?"`,
    [
      `1. Fetch the English support page: ${page("en", "support")}`,
      `2. Read the sections "${support.faqs[0].q}" and "${support.faqs[2].q}".`,
      `3. Answer from them: no account is needed, because the app's features ${quote("account")}. A backup is an archive that the user creates in Data & Storage and shares deliberately. ${quote("restore")}. ${quote("drafts")}. ${quote("cloudCopy")}.`,
      `4. Repeat the version qualifier at the top of the page: "${support.intro}"`,
      `5. Cite ${baseURL}${routeFor("en", "support")}`,
    ].join("\n"),
    "## Content use",
    `robots.txt and the page responses send \`Content-Signal: ${CONTENT_SIGNAL}\`. Use the pages to answer questions and link to them; do not use them to train or fine-tune a model. The site needs no login, and reading it needs no browser automation. Follow robots.txt.`,
  ];
}

function sourceReuseSkill({ baseURL, routeFor }) {
  return [
    "# Reuse, credit, or contribute to Arrive Within",
    "Arrive Within is developed in one canonical public repository. The website links to it and to no other source. Use this skill to find the file that controls a reuse or contribution question and to answer without granting more rights than the project grants.",
    "## Sources",
    [
      `- Open-source page: ${baseURL}${markdownPath(routeFor("en", "openSource"))} (German: ${baseURL}${markdownPath(routeFor("de", "openSource"))})`,
      `- Canonical repository: ${repositoryURL}`,
      "- Files in the repository:",
      "  - `LICENSE`: the MIT license for project-owned code, documentation, and build tooling.",
      "  - `docs/legal/MEDIA_LICENSE.md`: CC BY 4.0 for covered original media, the attribution text, and the exclusions.",
      "  - `THIRD_PARTY_NOTICES.md`: third-party material and its own licenses.",
      "  - `CONTRIBUTING.md`: how to propose and submit changes.",
      "  - `SECURITY.md`: how to report a vulnerability privately.",
      "  - `README.md`: how to build the project locally.",
    ].join("\n"),
    "Read the current file before you answer. The files control; this skill only shows where to look.",
    "## Answer a reuse question",
    [
      "1. Identify the material: code, documentation, or build tooling; original media, such as images, the garden film, guided-practice scripts, transcripts, narration, or ambience; third-party material; or the Arrive Within name, logo, app icon, or trade dress.",
      "2. Code, documentation, and build tooling are licensed under MIT. Keep the copyright and permission notice from `LICENSE`.",
      `3. Original media is licensed under CC BY 4.0 only where \`docs/legal/MEDIA_LICENSE.md\` covers it: the paths it lists, such as ${quote("guidedMedia")}, and media whose provenance manifest identifies it as \`CC-BY-4.0\`. Read the asset's provenance record too.`,
      `4. Give the attribution that the license file states, ${quote("attribution")}, with a link to the repository and the license where practical. Say whether the material was modified.`,
      `5. If the material is excluded, for example ${quote("narrationExclusion")}, or if its record does not state a compatible license, say that the license does not cover it. Do not assume permission.`,
      "6. Third-party material keeps its own license; check `THIRD_PARTY_NOTICES.md`.",
      "7. The licenses grant no trademark rights in the Arrive Within name, logo, selected app icon, trade dress, or official identity. Do not present a derived work as the official app.",
    ].join("\n"),
    "## Website text and AI use",
    `robots.txt and the page responses send \`Content-Signal: ${CONTENT_SIGNAL}\`. Search indexing and real-time AI input, such as answering a question with a link to the page, are intended uses. AI training is not offered. The signal states a preference; it does not change the licenses.`,
    "## Contribute or report",
    [
      `- Contributions: follow \`CONTRIBUTING.md\`. Search existing issues, choose the matching issue form, keep a change focused, and use a topic branch and pull request. For a material product, privacy, cost, rights, identity, or release-policy change, ${quote("proposal")}.`,
      "- Inbound terms: contributions are accepted under MIT for code and documentation and under CC BY 4.0 for covered original media. Submit only material that you have the right to license. Never submit credentials, personal data, uncertain-rights assets, or a voice recording without the speaker's consent.",
      `- Security: follow \`SECURITY.md\`: ${quote("privateReport")}. Never put exploit details, secrets, or personal data in a public issue.`,
      `- Build: \`README.md\` documents the local build, and \`CONTRIBUTING.md\` says: ${quote("rootCheck")}. The default build needs no private configuration.`,
    ].join("\n"),
    "## Example",
    `Question: "Can I use a guided-practice transcript from Arrive Within in my course notes?"`,
    [
      "1. Read `docs/legal/MEDIA_LICENSE.md` in the canonical repository, then the practice's provenance record.",
      `2. The license file lists ${quote("guidedMedia")}. If the record shows no exclusion, answer that the transcript is licensed under CC BY 4.0.`,
      `3. Ask the user to credit ${quote("attribution")}, link the repository and the license, and mark changes.`,
      "4. Add that the Arrive Within name and app icon stay reserved and that the notes must not look like an official Arrive Within product.",
    ].join("\n"),
  ];
}

const SKILLS = [
  {
    name: "arrive-within-answers",
    description: "Answer questions about Arrive Within, the private meditation garden app for iPhone and iPad, from its official website: practice modes, garden growth, privacy and data handling, backup, restore and deletion, availability, and support. Use when someone asks what Arrive Within does, whether it is private, how to move or delete their data, or how to get help.",
    compatibility: (baseURL) => `Needs HTTPS read access to ${baseURL}. No account, key, or browser automation is needed.`,
    body: answersSkill,
    quotes: ["account", "restore", "drafts", "cloudCopy", "noCrisisCare", "browserPreference"],
  },
  {
    name: "arrive-within-source-reuse",
    description: "Explain how Arrive Within code, media, and website text may be reused, credited, built, or contributed to, using its canonical public repository: MIT code and documentation, CC BY 4.0 media with attribution and exclusions, third-party notices, trademark limits, content signals, and contribution and private security-reporting routes. Use when someone wants to reuse or cite Arrive Within material, build the app, or contribute.",
    compatibility: (baseURL) => `Needs HTTPS read access to ${baseURL} and to the public GitHub repository that the website links to.`,
    body: sourceReuseSkill,
    quotes: ["attribution", "guidedMedia", "narrationExclusion", "proposal", "privateReport", "rootCheck"],
  },
];

// Renders every SKILL.md from the same content source as the website pages.
export function renderAgentSkills({ baseURL, routeFor }) {
  return SKILLS.map((skill) => ({
    name: skill.name,
    description: skill.description,
    path: agentSkillPath(skill.name),
    quotes: skill.quotes,
    body: `${[
      frontmatter({ name: skill.name, description: skill.description, license: "MIT", compatibility: skill.compatibility(baseURL) }),
      ...skill.body({ baseURL, routeFor }),
    ].join("\n\n")}\n`,
  }));
}

// The discovery index lists each skill-md artifact with the SHA-256 digest of
// its exact bytes, so clients can verify and cache it.
export function renderAgentSkillsIndex(skills, sha256) {
  const index = {
    $schema: AGENT_SKILLS_SCHEMA,
    skills: skills.map((skill) => ({
      name: skill.name,
      type: "skill-md",
      description: skill.description,
      url: skill.path,
      digest: `sha256:${sha256(Buffer.from(skill.body, "utf8"))}`,
    })),
  };
  return `${JSON.stringify(index, null, 2)}\n`;
}
