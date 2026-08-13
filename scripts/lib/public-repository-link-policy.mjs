const ownerHandle = String.fromCharCode(112, 48, 115);
const deviceAliases = [
  String.fromCharCode(112, 115, 97, 110),
  String.fromCharCode(112, 112, 97, 100),
];

export const publicRepositoryURL = ["https://github.com", ownerHandle, "arrive-within"].join("/");
export const repositoryOwnerFragment = [ownerHandle, "arrive-within"].join("/");
export const repositoryOwnerHandle = ownerHandle;

const exactSourceSurfaces = new Set([
  "README.md",
  "Website/README.md",
  "Website/src/content.mjs",
  "docs/release/metadata/de-DE.json",
  "docs/release/metadata/en-US.json",
]);

export function isIntentionalPublicRepositorySurface(displayPath) {
  return exactSourceSurfaces.has(displayPath)
    || /^website-dist\/(?:[^/]+\/)*[^/]+\.html$/.test(displayPath);
}

export function maskIntentionalPublicRepositoryURLs(source, displayPath) {
  if (!isIntentionalPublicRepositorySurface(displayPath)) return source;
  const escaped = publicRepositoryURL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactURL = new RegExp(`${escaped}(?=$|[\\s\"'<>\\)\\],.;\x60])`, "g");
  return source.replace(exactURL, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function privacyPatterns() {
  const personalHome = ["", "(?:Users|home)", "[A-Za-z0-9._-]+", ""].join("/");
  const privateRoot = ["", "private", ""].join("/");
  const temporaryRoot = ["", "tmp", ""].join("/");
  const fileScheme = ["file", ":", "//"].join("");
  const teamIdentifierKey = String.fromCharCode(84, 101, 97, 109, 73, 100, 101, 110, 116, 105, 102, 105, 101, 114);
  const prefixIdentifierKey = String.fromCharCode(65, 112, 112, 108, 105, 99, 97, 116, 105, 111, 110, 73, 100, 101, 110, 116, 105, 102, 105, 101, 114, 80, 114, 101, 102, 105, 120);
  return [
    { id: "owner-handle", pattern: new RegExp(escapeRegExp(repositoryOwnerHandle), "i") },
    { id: "device-alias", pattern: new RegExp(`\\b(?:${deviceAliases.map(escapeRegExp).join("|")})\\b`, "i") },
    { id: "personal-home", pattern: new RegExp(personalHome) },
    { id: "private-absolute-path", pattern: new RegExp(`(?:^|[\\s\"'=])${escapeRegExp(privateRoot)}`) },
    { id: "temporary-absolute-path", pattern: new RegExp(`(?:^|[\\s\"'=])${escapeRegExp(temporaryRoot)}`) },
    { id: "file-scheme", pattern: new RegExp(escapeRegExp(fileScheme), "i") },
    { id: "repository-owner-location", pattern: new RegExp(escapeRegExp(repositoryOwnerFragment), "i") },
    { id: "private-key", pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ },
    { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
    { id: "openai-token", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
    { id: "aws-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
    { id: "development-team-id", pattern: new RegExp(["DEVELOPMENT_TEAM", "\\s*=\\s*", "[A-Z0-9]{10}", "\\b"].join("")) },
    { id: "provisioning-identifier", pattern: new RegExp([`(?:${teamIdentifierKey}|${prefixIdentifierKey}|com\\.apple\\.developer\\.team-identifier)`, "[^\\n]{0,80}", "(?:<string>|=|:)\\s*", "[A-Z0-9]{10}", "\\b"].join(""), "i") },
    { id: "device-identifier-evidence", pattern: new RegExp(["(?:UDID|device[_ -]?identifier)", "[^\\n]{0,80}", "[0-9A-F]{8}-[0-9A-F-]{27,}"].join(""), "i") },
  ];
}

export function detectPublicPrivacySignatures(source, displayPath) {
  const maskedSource = maskIntentionalPublicRepositoryURLs(source, displayPath);
  return privacyPatterns()
    .filter(({ pattern }) => pattern.test(maskedSource) || pattern.test(displayPath))
    .map(({ id }) => id);
}
