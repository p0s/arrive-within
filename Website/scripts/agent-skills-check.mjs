import { AGENT_SKILLS_INDEX_PATH, AGENT_SKILLS_SCHEMA, agentSkillPath } from "../src/agent-access.mjs";
import { SKILL_QUOTES } from "../src/agent-skills.mjs";
import { appStoreURL, repositoryURL } from "../src/content.mjs";
import { sha256 } from "./lib.mjs";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIGEST = /^sha256:([a-f0-9]{64})$/;
const ENTRY_KEYS = ["description", "digest", "name", "type", "url"];
const FRONTMATTER_KEYS = new Set(["name", "description", "license", "compatibility"]);
const MAX_SKILL_LINES = 500;
const MAX_SKILL_BYTES = 20_000;

function sameKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

// Parses the single-line `key: value` frontmatter that the build writes.
// Values are plain tokens or JSON strings, which are valid YAML scalars.
export function parseSkillFrontmatter(text) {
  if (!text.startsWith("---\n")) throw new Error("SKILL.md must start with YAML frontmatter");
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("SKILL.md frontmatter is not closed");
  const fields = {};
  for (const line of text.slice(4, end).split("\n")) {
    const match = line.match(/^([a-z-]+): (.+)$/);
    if (!match || !FRONTMATTER_KEYS.has(match[1]) || match[1] in fields) throw new Error(`SKILL.md has an unsupported frontmatter line: ${line.slice(0, 40)}`);
    const raw = match[2];
    fields[match[1]] = raw.startsWith('"') ? JSON.parse(raw) : raw;
    if (typeof fields[match[1]] !== "string" || (!raw.startsWith('"') && !/^[A-Za-z0-9-]+$/.test(raw))) throw new Error(`SKILL.md frontmatter ${match[1]} must be a string`);
  }
  return { fields, body: text.slice(end + 5) };
}

function assertSkillLinks(name, text, publicBaseURL, publicPaths) {
  if (/\bhttp:\/\//i.test(text)) throw new Error(`${name}: skill links must use HTTPS`);
  for (const [target] of text.matchAll(/https:\/\/[^\s)<>"`|]+/g)) {
    const url = target.replace(/[.,;:]+$/, "");
    if (url === repositoryURL || url === appStoreURL) continue;
    const parsed = new URL(url);
    if (parsed.origin !== publicBaseURL || parsed.search || parsed.hash || !publicPaths.has(parsed.pathname)) {
      throw new Error(`${name}: skill link does not resolve to a public website resource: ${url}`);
    }
  }
}

// Validates the published discovery index and every SKILL.md it lists against
// Agent Skills Discovery v0.2.0 and the agentskills.io SKILL.md format.
// `files` maps each output path under `.well-known/` to its exact bytes.
export function assertAgentSkillsOutput({ files, publicBaseURL, publicPaths, sourceText }) {
  const indexFile = AGENT_SKILLS_INDEX_PATH.slice(1);
  if (!files.has(indexFile)) throw new Error("Agent Skills index is missing");
  const index = JSON.parse(files.get(indexFile).toString("utf8"));
  if (!sameKeys(index, ["$schema", "skills"]) || index.$schema !== AGENT_SKILLS_SCHEMA) throw new Error("Agent Skills index must declare exactly the v0.2.0 $schema and skills");
  if (!Array.isArray(index.skills) || !index.skills.length) throw new Error("Agent Skills index must list at least one skill");
  const expectedFiles = new Set([indexFile]);
  const skillTexts = [];
  for (const entry of index.skills) {
    if (!sameKeys(entry, ENTRY_KEYS)) throw new Error("each Agent Skills entry must contain exactly name, type, description, url, and digest");
    const { name, type, description, url, digest } = entry;
    if (typeof name !== "string" || name.length > 64 || !NAME.test(name)) throw new Error(`invalid Agent Skill name: ${String(name).slice(0, 70)}`);
    if (expectedFiles.has(agentSkillPath(name).slice(1))) throw new Error(`duplicate Agent Skill name: ${name}`);
    if (type !== "skill-md") throw new Error(`${name}: only skill-md artifacts are published`);
    if (typeof description !== "string" || !description || description.length > 1024 || description !== description.trim() || /\n/.test(description)) throw new Error(`${name}: description must be one non-empty line of at most 1024 characters`);
    if (url !== agentSkillPath(name)) throw new Error(`${name}: url must be ${agentSkillPath(name)}`);
    const file = url.slice(1);
    expectedFiles.add(file);
    const bytes = files.get(file);
    if (!bytes) throw new Error(`${name}: SKILL.md is missing`);
    const hex = typeof digest === "string" ? digest.match(DIGEST)?.[1] : null;
    if (!hex || hex !== sha256(bytes)) throw new Error(`${name}: digest does not match the published SKILL.md bytes`);
    const text = bytes.toString("utf8");
    if (Buffer.from(text, "utf8").compare(bytes) !== 0) throw new Error(`${name}: SKILL.md must be UTF-8`);
    const { fields, body } = parseSkillFrontmatter(text);
    if (fields.name !== name || fields.description !== description) throw new Error(`${name}: frontmatter name and description must match the index`);
    if (fields.compatibility !== undefined && (!fields.compatibility || fields.compatibility.length > 500)) throw new Error(`${name}: compatibility must be 1 to 500 characters`);
    if (!body.trimStart().startsWith("# ") || text.split("\n").length > MAX_SKILL_LINES || bytes.byteLength > MAX_SKILL_BYTES) throw new Error(`${name}: SKILL.md body must start with a title and stay within ${MAX_SKILL_LINES} lines and ${MAX_SKILL_BYTES} bytes`);
    if (/<\/?[a-z][^>]*>/i.test(text)) throw new Error(`${name}: SKILL.md must not contain raw HTML`);
    assertSkillLinks(name, text, publicBaseURL, publicPaths);
    skillTexts.push(text);
  }
  for (const file of files.keys()) {
    if (!expectedFiles.has(file)) throw new Error(`unlisted file under .well-known: ${file}`);
  }
  // Each quoted claim must appear verbatim in a skill and in its named source.
  for (const [key, claim] of Object.entries(SKILL_QUOTES)) {
    if (!skillTexts.some((text) => text.includes(`"${claim.text}"`))) throw new Error(`skill quote ${key} is not used verbatim`);
    if (!sourceText(claim).includes(claim.text)) throw new Error(`skill quote ${key} is not in its source ${claim.page ?? claim.file}`);
  }
  return index.skills.map(({ name, digest }) => ({ name, digest }));
}
