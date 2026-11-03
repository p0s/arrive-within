# ADR-0014: Publish Agent Skills for the website's real public tasks

## Status

Accepted.

## Context

ADR-0013 made the public website agent-readable. Agents can now read every page, but they still guess how to use them. Two tasks recur and are easy to get wrong: answering questions about the app (release status, privacy, backup, deletion, support) and reusing or contributing to the project (licenses, attribution, trademarks, private security reports). Both tasks already work with public pages and public repository files. No backend, account, or new data flow is needed to support them.

Each candidate standard below was checked against its primary source on 3 November 2026 and against what the site really offers.

## Decision

The build publishes an [Agent Skills Discovery v0.2.0](https://github.com/cloudflare/agent-skills-discovery-rfc) index at `/.well-known/agent-skills/index.json` with two `skill-md` skills in the [Agent Skills format](https://agentskills.io/specification):

- `arrive-within-answers` tells an agent which English or German Markdown page answers which question, and how to keep release-status, date, and privacy qualifiers.
- `arrive-within-source-reuse` tells an agent which repository file controls a reuse, attribution, contribution, or security-reporting question.

`Website/src/agent-skills.mjs` renders both skills from the same content source as the pages. The index records the SHA-256 digest of each file's exact bytes. `llms.txt` lists the index and both skills. The Worker serves the index as `application/json` and each skill as `text/markdown; charset=utf-8`, with `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=0, must-revalidate`, and the site's Content Signals. Unknown skill paths keep the normal 404. Skill files are not HTML document views, so website activity counts exclude them.

Validation rejects a skill whose index entry, frontmatter, digest, name, link, or size breaks the specifications, and any unlisted file under `/.well-known/`. Every quoted claim in a skill names its page or repository file; validation fails when the quote is no longer in that source.

| Category | Primary sources | What the site has | Verdict | Scanner check and real use | Cost, privacy, upkeep | Revisit when |
| --- | --- | --- | --- | --- | --- | --- |
| Agent Skills | [Discovery RFC v0.2.0](https://github.com/cloudflare/agent-skills-discovery-rfc) (draft, 12 Mar 2026); [SKILL.md format](https://agentskills.io/specification) | Public pages and repository files that answer the two tasks above | Implement two skills and the index | `agentSkills` should pass; the scanner lists it among its Level 4 requirements. Real use: agents get tested steps for real tasks | Static build output; no backend, telemetry, or personal data; drift checks in validation | A page, license file, or supported task changes |
| API catalog, OpenAPI, downloads | [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727) (Jun 2025), for servers that publish APIs; [RFC 9264](https://www.rfc-editor.org/rfc/rfc9264) | No public API. The Worker's endpoints are browser privacy controls and first-party measurement. Downloads are pages, Markdown, `llms.txt`, and the sitemap | Not applicable | `apiCatalog` stays failing. A catalog of non-APIs would be false | None | The site publishes a public read-only API or dataset with an OpenAPI description and cleared content rights |
| MCP and A2A | [MCP Server Cards, SEP-2127](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127) (merged 6 Oct 2026); [A2A discovery](https://a2a-protocol.org/latest/topics/agent-discovery/) | No MCP server and no agent. Static content is already readable as Markdown | Defer | `mcpServerCard` and `a2aAgentCard` stay failing. A card needs a real service | A server would duplicate Markdown and add a backend, abuse, and maintenance surface | Agents need tools the pages cannot give, such as search across many practices; then a read-only MCP server on the existing Worker with a true card |
| OAuth, protected resources, auth.md | [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414); [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) (Apr 2025); [auth.md](https://workos.com/auth-md) | No accounts and no protected resources; the app promises no account | Not applicable | `oauthDiscovery`, `oauthProtectedResource`, and `authMd` stay failing | Metadata would invent an authorization server | A protected API is approved, which would change the privacy architecture first |
| DNS-AID, ARD, Personal Agent Protocol | [DNS-AID drafts](https://datatracker.ietf.org/doc/draft-mozleywilliams-dnsop-dnsaid/) (-02, May 2026); [ARD v0.91](https://agenticresourcediscovery.org/spec/); [Personal Agent Protocol draft 0.3](https://personalagentprotocol.org/docs/spec) | DNS-AID names agent endpoints: none exist. ARD can list skills. PAP needs sessions, sign-in, or company channels | DNS-AID and PAP not applicable; ARD defer | `dnsAid` and `ard` stay failing; PAP is informational | DNS records need DNS authority and DNSSEC. PAP session joining would link agent sessions to website activity, a new data flow. ARD moved its path to `/.well-known/ard.json` in this revision while the scanner probes the older `ai-catalog.json` | ARD is stable and a registry that the audience uses reads `ard.json`; then generate it from the same skills source |
| WebMCP | [WebMCP](https://webmachinelearning.github.io/webmcp/) (W3C community group draft, 2 Nov 2026, not standards track) | The only controls are the two no-JavaScript preference forms on the privacy pages | Defer | `webMcp` stays failing; it looks for tools at home-page load, and a tool there would be invented | New attributes and validator rules for an experimental browser API | Browsers ship WebMCP by default and the site has a real in-page task; then declarative `toolname` and `tooldescription` on the preference forms without `toolautosubmit`, so the user confirms |
| Web Bot Auth | [IETF webbotauth](https://datatracker.ietf.org/wg/webbotauth/about/) | The site sends no bot traffic of its own | Not applicable | Neutral and informational | None | The project runs its own crawler or agent that signs requests |
| Commerce | [x402](https://www.x402.org/), [MPP](https://mpp.dev/), [UCP](https://ucp.dev/), [ACP](https://www.agenticcommerce.dev/), [AP2](https://ap2-protocol.org/) | The website sells nothing. The app's only purchase is an optional one-time App Store in-app purchase | Not applicable | Neutral: the scanner reports no commerce site and does not score these checks | None | The website itself sells something directly |

The scanner's level is a gate over several checks. Its Level 4 requirement list names MCP Server Card, A2A Agent Card, Agent Skills, and API Catalog. Individual diagnostics such as DNS-AID or WebMCP can stay failing at a higher level. A level is claimed only from a live scan.

## Consequences

- Agents can find, verify, and follow two task instructions without an account, key, or browser automation.
- A content or license change that breaks a quoted claim fails website validation until the skill is updated.
- The skills describe only public pages and public repository files. They add no API, server, card, DNS record, or payment endpoint, and the paths for those standards keep returning HTTP 404.
