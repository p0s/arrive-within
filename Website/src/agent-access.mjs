// Content Signals for public first-party pages: search and real-time AI input
// are intended uses; AI training is not offered.
export const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=no";
export const LLMS_TXT_PATH = "/llms.txt";
// Agent Skills Discovery v0.2.0 (https://github.com/cloudflare/agent-skills-discovery-rfc).
export const AGENT_SKILLS_INDEX_PATH = "/.well-known/agent-skills/index.json";
export const AGENT_SKILLS_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
export const AGENT_SKILL_FILE = /^\/\.well-known\/agent-skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/;

export function markdownPath(route) {
  return route === "/" ? "/index.md" : `${route}/index.md`;
}

export function agentSkillPath(name) {
  return `/.well-known/agent-skills/${name}/SKILL.md`;
}

export function robotsTxt(baseURL) {
  return `# Content Signals (https://contentsignals.org/) for public pages:
# search=yes: build a search index and link to these pages.
# ai-input=yes: use as real-time AI input, such as retrieval or grounding.
# ai-train=no: do not use to train or fine-tune AI models.
User-agent: *
Content-Signal: ${CONTENT_SIGNAL}
Allow: /
Sitemap: ${baseURL}/sitemap.xml
`;
}
