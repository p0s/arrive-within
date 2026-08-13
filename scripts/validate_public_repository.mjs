import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listProspectivePublicFiles } from "./lib/prospective-public-files.mjs";
import {
  detectPublicPrivacySignatures,
  publicRepositoryURL,
} from "./lib/public-repository-link-policy.mjs";

const MODULE_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(MODULE_PATH), "..");
const REPORT_JSON = path.join(ROOT, ".evidence", "privacy", "public-repository-validation.json");
const REPORT_TEXT = path.join(ROOT, ".evidence", "privacy", "public-repository-validation.txt");
const PRIVATE_REPORT = path.join(ROOT, ".evidence", "privacy", "public-boundary-full.json");

const REQUIRED_DOCS = [
  "README.md",
  "docs/architecture/OVERVIEW.md",
  "docs/contributing/ART_DIRECTION.md",
  "docs/contributing/CONTENT_GUIDE.md",
  "docs/contributing/ASSET_POLICY.md",
  "docs/legal/MEDIA_LICENSE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "LICENSE",
];
const ISSUE_FORMS = [
  "bug.yml",
  "renderer-performance.yml",
  "guided-content.yml",
  "localization.yml",
  "accessibility.yml",
  "feature.yml",
];
const TEXT_EXTENSIONS = new Set([
  "", ".css", ".html", ".js", ".json", ".md", ".mjs", ".pbxproj", ".plist", ".py",
  ".sh", ".strings", ".swift", ".ts", ".tsx", ".txt", ".xcconfig", ".xcscheme", ".xml", ".yaml", ".yml",
]);
const PRIVATE_EXACT = new Set(["SPEC.md", "AGENTS.md", "GOAL.md"]);
const PRIVATE_PREFIXES = [
  ".asc/", ".codex/", ".evidence/", "Private/", "Local/", "Models/", "ModelCache/", "VoiceSources/", "References/", "ReferenceAssets/",
  "StudyAssets/", "PrivateAssets/", "Art/private/", "Art/references/", "Content/private/", "ContentProduction/private/",
  "ContentProduction/auditions/", "ContentProduction/model-cache/", "ContentProduction/production-candidates/", "Signing/", "AppStoreConnect/", "CloudKit/Private/",
  "CloudKit/Local/", "Evidence/", "Artifacts/", "BuildArtifacts/", "TestResults/", "docs/evidence/local/",
];
const GENERATED_SEGMENTS = new Set([".build", ".git", ".next", ".pnpm-store", ".swiftpm", ".venv", ".vercel", "__pycache__", "DerivedData", "node_modules", "xcuserdata"]);
const BINARY_EXTENSIONS = new Set([".aac", ".aiff", ".app", ".cer", ".der", ".gif", ".heic", ".ipa", ".jpeg", ".jpg", ".m4a", ".mobileprovision", ".mov", ".mp3", ".mp4", ".p12", ".pdf", ".png", ".wav", ".xcarchive", ".xcresult", ".zip"]);
const DEFAULT_ARCHIVE_SCAN_LIMITS = Object.freeze({
  maxDepth: 3,
  maxTopLevelArchives: 64,
  maxEntries: 2_048,
  maxEntryBytes: 60_000_000,
  maxExpandedBytes: 180_000_000,
  maxListingBytes: 20_000_000,
  subprocessTimeoutMilliseconds: 15_000,
  maxWallMilliseconds: 60_000,
});
const GENERATED_CANDIDATE_ROOTS = [
  ["website-dist", "Website/dist"],
  ["app-store-screenshot-exports", "Marketing/AppStoreScreenshots/exports"],
  ["public-media-output", "Marketing/PublicMedia/output"],
  ["renderer-visual-output", "Marketing/RendererVisualMatrix/output"],
];
const permittedThirdPartyLicenseEmail = ["floatdrop", "gmail.com"].join("@");

const checks = [];
const failures = [];
function check(id, condition, detail) {
  checks.push({ id, status: condition ? "passed" : "failed", detail });
  if (!condition) failures.push(`${id}: ${detail}`);
}

function normalized(relative) {
  return relative.split(path.sep).join("/");
}

function isPrivateOrGenerated(relative) {
  const file = normalized(relative);
  const basename = path.posix.basename(file);
  const segments = file.split("/");
  if (PRIVATE_EXACT.has(file) || PRIVATE_PREFIXES.some((prefix) => file.startsWith(prefix))) return true;
  if (segments.some((segment) => GENERATED_SEGMENTS.has(segment))) return true;
  if (file === "Renderer/dist" || file.startsWith("Renderer/dist/") || file === "Website/dist" || file.startsWith("Website/dist/")) return true;
  if (basename === ".DS_Store" || basename.startsWith("LOCAL_") || basename.startsWith("PRIVATE_")) return true;
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if (/\.(?:log|profdata|trace|xcresult)$/.test(basename)) return true;
  if (/\.(?:p8|p12|mobileprovision|provisionprofile|cer|der|key|pem)$/.test(basename)) return true;
  if (/^(?:AuthKey_|credentials\.|secrets\.)/.test(basename)) return true;
  if (/^(?:Local|Private|Signing|OfficialCloudKit)\.xcconfig$/.test(basename)) return true;
  return false;
}

async function collectPublicFiles() {
  try {
    return (await listProspectivePublicFiles(ROOT)).map((candidate) => candidate.relative);
  } catch (error) {
    failures.push(`public-enumeration: ${error.message}`);
    return [];
  }
}

async function collectCandidateFiles(directory, label, prefix = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = normalized(path.join(prefix, entry.name));
    const absolute = path.join(directory, entry.name);
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      failures.push(`generated-candidate-symlink:${label}`);
      continue;
    }
    if (entry.isDirectory()) files.push(...await collectCandidateFiles(absolute, label, relative));
    else if (entry.isFile()) files.push({ label, relative, absolute });
  }
  return files;
}

function printableMetadata(buffer, minimumLength = 4) {
  const sequences = [];
  let current = [];
  for (const byte of buffer) {
    if (byte >= 0x20 && byte <= 0x7e) current.push(byte);
    else {
      if (current.length >= minimumLength) sequences.push(Buffer.from(current).toString("ascii"));
      current = [];
    }
  }
  if (current.length >= minimumLength) sequences.push(Buffer.from(current).toString("ascii"));
  return sequences.join("\n");
}

function pngMetadata(buffer) {
  if (buffer.length < 8 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return printableMetadata(buffer);
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (end > buffer.length) break;
    if (["tEXt", "iTXt", "zTXt", "eXIf"].includes(type)) chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset = end;
    if (type === "IEND") break;
  }
  return chunks.map((chunk) => printableMetadata(chunk, 3)).join("\n");
}

function jpegMetadata(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return printableMetadata(buffer);
  const segments = [];
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) segments.push(buffer.subarray(offset + 4, offset + 2 + length));
    offset += 2 + length;
  }
  return segments.map((segment) => printableMetadata(segment, 3)).join("\n");
}

function isoBaseMediaMetadata(buffer) {
  if (buffer.length < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") return printableMetadata(buffer);
  const metadata = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > buffer.length) break;
      const extendedSize = buffer.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }
    if (size < headerSize || offset + size > buffer.length) break;
    if (type !== "mdat") metadata.push(buffer.subarray(offset, offset + size));
    offset += size;
  }
  return metadata.map((atom) => printableMetadata(atom, 3)).join("\n");
}

function scannableSource(buffer, displayPath) {
  const extension = path.extname(displayPath.split("!").at(-1)).toLowerCase();
  if (extension === ".zip") return "";
  if (extension === ".png") return pngMetadata(buffer);
  if ([".jpg", ".jpeg"].includes(extension)) return jpegMetadata(buffer);
  if ([".m4a", ".mov", ".mp4"].includes(extension)) return isoBaseMediaMetadata(buffer);
  if (BINARY_EXTENSIONS.has(extension)) return printableMetadata(buffer);
  return buffer.toString("utf8");
}

function hasZipStructure(buffer) {
  if (buffer.length < 4) return false;
  const signature = buffer.subarray(0, 4).toString("hex");
  if (signature === "504b0304" || signature === "504b0506" || signature === "504b0708") {
    return true;
  }
  const endOfCentralDirectory = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  return endOfCentralDirectory >= Math.max(0, buffer.length - 65_557);
}

function scanBuffer(buffer, displayPath, scope, hits) {
  const source = scannableSource(buffer, displayPath);
  for (const signature of detectPublicPrivacySignatures(source, displayPath)) {
    hits.push({ scope, file: displayPath, pattern: signature });
  }
  const emailPattern = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
  for (const match of source.matchAll(emailPattern)) {
    if (displayPath === "THIRD_PARTY_NOTICES.md" && match[0].toLowerCase() === permittedThirdPartyLicenseEmail) continue;
    const domain = match[1].toLowerCase();
    if (!["example.com", "example.net", "example.org"].includes(domain)) {
      hits.push({ scope, file: displayPath, pattern: "non-synthetic-email" });
      break;
    }
  }
}

function scanZipArchive(absolute, displayPath, hits, requestedLimits = {}) {
  const limits = { ...DEFAULT_ARCHIVE_SCAN_LIMITS, ...requestedLimits };
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "arrive-within-archive-scan-"));
  const state = {
    entries: 0,
    expandedBytes: 0,
    nestedSequence: 0,
    limits,
    temporaryRoot,
    deadline: Date.now() + limits.maxWallMilliseconds,
  };
  try {
    return scanZipArchiveFile(absolute, displayPath, hits, state, 0);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function scanZipArchiveFile(absolute, displayPath, hits, state, depth) {
  const { limits } = state;
  if (Date.now() >= state.deadline) {
    hits.push({ scope: "release-archive", file: displayPath, pattern: "archive-time-limit-exceeded" });
    return 0;
  }
  const listing = spawnSync("/usr/bin/unzip", ["-Z1", absolute], {
    encoding: "utf8",
    maxBuffer: limits.maxListingBytes,
    timeout: Math.max(
      1,
      Math.min(limits.subprocessTimeoutMilliseconds, state.deadline - Date.now()),
    ),
  });
  if (Date.now() >= state.deadline || listing.error?.code === "ETIMEDOUT") {
    hits.push({ scope: "release-archive", file: displayPath, pattern: "archive-time-limit-exceeded" });
    return 0;
  }
  if (listing.status !== 0) {
    hits.push({ scope: "release-archive", file: displayPath, pattern: "unreadable-archive" });
    return 0;
  }
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
  if (state.entries + entries.length > limits.maxEntries) {
    hits.push({ scope: "release-archive", file: displayPath, pattern: "archive-entry-limit-exceeded" });
    return 0;
  }
  let scannedEntries = 0;
  for (const entry of entries) {
    if (Date.now() >= state.deadline) {
      hits.push({ scope: "release-archive", file: displayPath, pattern: "archive-time-limit-exceeded" });
      return scannedEntries;
    }
    state.entries += 1;
    scannedEntries += 1;
    const entryDisplayPath = `${displayPath}!${entry}`;
    scanBuffer(Buffer.from(entry, "utf8"), entryDisplayPath, "release-archive-name", hits);
    const extracted = spawnSync("/usr/bin/unzip", ["-p", absolute, entry], {
      encoding: null,
      maxBuffer: limits.maxEntryBytes + 1,
      timeout: Math.max(
        1,
        Math.min(limits.subprocessTimeoutMilliseconds, state.deadline - Date.now()),
      ),
    });
    if (Date.now() >= state.deadline || extracted.error?.code === "ETIMEDOUT") {
      hits.push({ scope: "release-archive", file: entryDisplayPath, pattern: "archive-time-limit-exceeded" });
      return scannedEntries;
    }
    if (extracted.status !== 0) {
      hits.push({ scope: "release-archive", file: entryDisplayPath, pattern: "unreadable-entry" });
      continue;
    }
    if (!Buffer.isBuffer(extracted.stdout) || extracted.stdout.length > limits.maxEntryBytes) {
      hits.push({ scope: "release-archive", file: entryDisplayPath, pattern: "archive-entry-size-limit-exceeded" });
      continue;
    }
    if (state.expandedBytes + extracted.stdout.length > limits.maxExpandedBytes) {
      hits.push({ scope: "release-archive", file: entryDisplayPath, pattern: "archive-expanded-size-limit-exceeded" });
      return scannedEntries;
    }
    state.expandedBytes += extracted.stdout.length;

    const namedAsZip = path.extname(entry).toLowerCase() === ".zip";
    const containsZip = hasZipStructure(extracted.stdout);
    if (namedAsZip || containsZip) {
      if (!containsZip) {
        hits.push({ scope: "release-archive", file: entryDisplayPath, pattern: "invalid-nested-archive" });
        continue;
      }
      if (depth >= limits.maxDepth) {
        hits.push({ scope: "release-archive", file: entryDisplayPath, pattern: "archive-depth-limit-exceeded" });
        continue;
      }
      const nestedPath = path.join(
        state.temporaryRoot,
        `nested-${String(state.nestedSequence).padStart(4, "0")}.zip`,
      );
      state.nestedSequence += 1;
      try {
        writeFileSync(nestedPath, extracted.stdout, { flag: "wx", mode: 0o600 });
        scannedEntries += scanZipArchiveFile(
          nestedPath,
          entryDisplayPath,
          hits,
          state,
          depth + 1,
        );
      } finally {
        rmSync(nestedPath, { force: true });
      }
      continue;
    }
    scanBuffer(extracted.stdout, entryDisplayPath, "release-archive-content", hits);
  }
  return scannedEntries;
}

async function sha256File(absolute) {
  return createHash("sha256").update(await readFile(absolute)).digest("hex");
}

async function hashPublicTree(files) {
  const hash = createHash("sha256");
  for (const relative of files) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await sha256File(path.join(ROOT, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function requireText(relative) {
  return readFile(path.join(ROOT, relative), "utf8");
}

async function main() {
  const publicFiles = await collectPublicFiles();
  const publicSet = new Set(publicFiles);

  for (const document of REQUIRED_DOCS) check(`required-doc:${document}`, publicSet.has(document), `${document} must exist in the public tree`);
  for (const form of ISSUE_FORMS) {
    const relative = `.github/ISSUE_TEMPLATE/${form}`;
    check(`issue-form:${form}`, publicSet.has(relative), `${relative} must exist`);
    if (publicSet.has(relative)) {
      const source = await requireText(relative);
      check(`issue-form-structure:${form}`, /\nbody:\n/.test(source) && /\nname: /.test(`\n${source}`) && /\ndescription: /.test(`\n${source}`), `${form} must declare name, description, and body`);
    }
  }
  check("pr-template", publicSet.has(".github/pull_request_template.md"), "pull-request template must exist");
  check("issue-config", publicSet.has(".github/ISSUE_TEMPLATE/config.yml"), "issue-template config must exist");
  check(
    "github-actions-disabled",
    !publicFiles.some((file) => file.startsWith(".github/workflows/")),
    "the initial public repository must not contain an active GitHub Actions workflow",
  );

  const ignore = await requireText(".gitignore");
  for (const entry of ["/SPEC.md", "/AGENTS.md", "/GOAL.md", "/.codex/", "/.evidence/", "/LOCAL_*.md", "/PRIVATE_*.md", ".env*", "*.p8", "*.p12", "*.mobileprovision", "*.ipa", "*.xcarchive", "/ArriveWithin.xcodeproj/", "/ContentProduction/auditions/", "/ContentProduction/model-cache/", "/ContentProduction/production-candidates/", "/Marketing/SoundDesignLab/output/", "/docs/qa/public-repository-validation.json", "/docs/qa/public-repository-validation.txt", "/References/", "/Evidence/"]) {
    check(`ignore:${entry}`, ignore.split(/\r?\n/).includes(entry), `.gitignore must contain exact entry ${entry}`);
  }
  for (const entry of ["!/Content/guided/**/audio.*.m4a", "!/Content/guided/**/transcript.*.vtt", "!/Content/guided/**/provenance.*.json"]) {
    check(`public-shipping-audio:${entry}`, ignore.split(/\r?\n/).includes(entry), `.gitignore must explicitly preserve promoted shipping narration source ${entry}`);
  }

  const readme = await requireText("README.md");
  check("readme-pre-release-truth", readme.includes("active pre-release verification") && readme.includes("does **not** claim App Store"), "README must keep release evidence bounded");
  check("readme-public-repository", readme.includes(publicRepositoryURL), "README must document the exact canonical public repository");
  check("readme-root-check", readme.includes("./scripts/check"), "README must document the root gate");
  check("readme-media", readme.includes("01-growth-arrive-en-us-iphone-6.9-1320x2868.png") && readme.includes("02-growth-take-root-en-us-iphone-6.9-1320x2868.png") && readme.includes("garden-growth-v1.mp4"), "README must lead with two selected actual-app screenshots and retain the canonical garden film");
  check("minimal-root-docs", ["CODE_OF_CONDUCT.md", "GOAL.md", "PRIVACY.md", "TRADEMARKS.md", "LICENSE-MEDIA.md", "ARCHITECTURE.md", "ART_DIRECTION.md", "CONTENT_GUIDE.md", "ASSET_POLICY.md"].every((file) => !publicSet.has(file)), "redundant or focused project documents must stay out of the public root");

  const license = await requireText("LICENSE");
  check("mit-license", license.includes("MIT License") && license.includes("Copyright (c) 2026 Philipp Seifert") && license.includes("Permission is hereby granted, free of charge") && license.includes("THE SOFTWARE IS PROVIDED \"AS IS\""), "LICENSE must contain the unmodified MIT legal text and owner copyright notice");
  const mediaLicense = await requireText("docs/legal/MEDIA_LICENSE.md");
  check("media-license", mediaLicense.includes("Creative Commons Attribution 4.0 International Public License") && mediaLicense.includes("CC-BY-4.0"), "media license must identify CC BY 4.0 and its legal code");
  const notices = await requireText("THIRD_PARTY_NOTICES.md");
  for (const anchor of ["Ajv | 8.18.0 | MIT", "Three.js | 0.184.0 | MIT", "fast-deep-equal | 3.1.3 | MIT", "fast-uri | 3.1.5 | BSD-3-Clause", "json-schema-traverse | 1.0.0 | MIT", "require-from-string | 2.0.2 | MIT", "Playwright | 1.61.1 | Apache-2.0", "Sharp | 0.35.3 | Apache-2.0", "Chatterbox", "Mulberry32"]) {
    check(`notice:${anchor.split(" |")[0]}`, notices.includes(anchor), `third-party notice must include ${anchor}`);
  }
  check("bundled-notice-license-texts", notices.includes("Copyright © 2010-2026 three.js authors") && notices.includes("Copyright (c) 2015-2021 Evgeny Poberezkin") && notices.includes("Copyright (c) 2011-2021, Gary Court") && notices.includes("Redistribution and use in source and binary forms"), "bundled dependency copyright and license texts must be reproduced");
  const project = await requireText("project.yml");
  check("bundled-third-party-notices", project.includes("- path: THIRD_PARTY_NOTICES.md") && project.includes("buildPhase: resources"), "the app distribution must package the bundled dependency notices");

  const rendererPackage = JSON.parse(await requireText("Renderer/package.json"));
  check("renderer-direct-dependencies", rendererPackage.dependencies.ajv === "8.18.0" && rendererPackage.dependencies.three === "0.184.0", "renderer direct versions must agree with notices");
  const marketingPackage = JSON.parse(await requireText("Marketing/AppStoreScreenshots/package.json"));
  check("marketing-tool-versions", marketingPackage.devDependencies.playwright === "1.61.1" && marketingPackage.dependencies.next === "16.3.0" && marketingPackage.dependencies.sharp === "0.35.3", "marketing tool versions must agree with notices");
  const publicMedia = JSON.parse(await requireText("Marketing/PublicMedia/output/manifest.json"));
  check("public-media-license", publicMedia.rights?.media_license === "CC-BY-4.0" && publicMedia.rights?.third_party_visual_assets?.length === 0, "public-media manifest must record CC BY 4.0 and no third-party visuals");
  const rendererVisualMatrix = JSON.parse(await requireText("Marketing/RendererVisualMatrix/output/manifest.json"));
  check("renderer-visual-matrix-coverage", rendererVisualMatrix.coverage?.milestone_count === 15 && rendererVisualMatrix.coverage?.authored_variant_count === 30 && rendererVisualMatrix.capture?.frames?.length === 30, "renderer matrix must cover all 15 milestone A/B pairs");
  check("renderer-visual-matrix-rights", rendererVisualMatrix.rights?.media_license === "CC-BY-4.0" && rendererVisualMatrix.rights?.third_party_visual_assets?.length === 0, "renderer matrix must contain only public-safe original product visuals");
  check("renderer-visual-matrix-boundary", rendererVisualMatrix.human_review?.state === "pending" && rendererVisualMatrix.claim_boundary?.includes("does not prove owner art approval"), "renderer matrix must preserve owner-review and release boundaries");
  const audioManifest = JSON.parse(await requireText("Apps/ArriveWithin/Resources/Audio/audio-assets.json"));
  check("procedural-audio-rights", typeof audioManifest.rights === "string" && audioManifest.rights.includes("no samples"), "bundled audio must record original deterministic synthesis");
  const soundSelection = JSON.parse(await requireText("Marketing/SoundDesignLab/selection.json"));
  const audioByID = new Map(audioManifest.assets.map((asset) => [asset.id, asset]));
  const selectedAudio = [
    soundSelection.ambience_selection,
    soundSelection.bell_family_selection?.opening,
    soundSelection.bell_family_selection?.closing_and_interval,
  ];
  check(
    "procedural-audio-owner-selection",
    soundSelection.status === "owner-selected-bundled-baseline-remastered-after-device-failure"
      && soundSelection.selection_date === "2026-08-13"
      && selectedAudio.every((selected) => {
        const bundled = audioByID.get(selected?.id);
        return bundled?.path === selected?.path && bundled?.sha256 === selected?.sha256;
      })
      && soundSelection.unselected_lab_candidate_ids?.length === 6
      && soundSelection.physical_qa?.includes("requires exact-candidate"),
    "sound selection must bind the exact three bundled hashes, exclude all lab alternatives, and preserve physical QA truth",
  );
  const websiteProvenance = JSON.parse(await requireText("Website/src/assets/provenance.json"));
  const websiteBrandProvenance = JSON.parse(await requireText("Website/src/assets/brand-provenance.json"));
  check(
    "website-provenance",
    websiteProvenance.assets?.length === 11
      && websiteProvenance.assets.every((item) => /^[a-f0-9]{64}$/.test(item.sha256))
      && websiteBrandProvenance.selection === "B — Quiet Threshold"
      && websiteBrandProvenance.canonical_source === "Apps/ArriveWithin/Resources/AppIcon.icon"
      && websiteBrandProvenance.assets?.length === 2
      && websiteBrandProvenance.assets.every((item) => /^[a-f0-9]{64}$/.test(item.sha256) && item.alpha === false)
      && websiteBrandProvenance.rights?.includes("trademark rights remain reserved"),
    "website product media and selected identity assets must have complete bounded hash, rights, and trademark provenance",
  );
  const websiteContent = await requireText("Website/src/content.mjs");
  check("website-public-repository", websiteContent.includes(publicRepositoryURL), "website source must link only to the exact canonical public repository");

  const privacyHits = [];
  const publicArchives = [];
  let textFilesScanned = 0;
  let binaryFilesScanned = 0;
  for (const relative of publicFiles) {
    const extension = path.posix.extname(relative);
    const absolute = path.join(ROOT, relative);
    const stat = await lstat(absolute);
    if (stat.size > 60_000_000) {
      privacyHits.push({ scope: "public-source", file: relative, pattern: "oversized-unscanned-file" });
      continue;
    }
    const bytes = await readFile(absolute);
    scanBuffer(bytes, relative, "public-source", privacyHits);
    if (extension.toLowerCase() === ".zip" || hasZipStructure(bytes)) {
      publicArchives.push({ relative, absolute });
    }
    if (BINARY_EXTENSIONS.has(extension) || !TEXT_EXTENSIONS.has(extension)) binaryFilesScanned += 1;
    else textFilesScanned += 1;
  }

  const generatedCandidates = [];
  for (const [label, relativeRoot] of GENERATED_CANDIDATE_ROOTS) {
    generatedCandidates.push(...await collectCandidateFiles(path.join(ROOT, relativeRoot), label));
  }
  let generatedFilesScanned = 0;
  let archivesScanned = 0;
  let archiveEntriesScanned = 0;
  const scannedArchivePaths = new Set();
  for (const candidate of generatedCandidates) {
    const displayPath = `${candidate.label}/${candidate.relative}`;
    const stat = await lstat(candidate.absolute);
    if (stat.size > 60_000_000) {
      privacyHits.push({ scope: "generated-candidate", file: displayPath, pattern: "oversized-unscanned-file" });
      continue;
    }
    const bytes = await readFile(candidate.absolute);
    scanBuffer(bytes, displayPath, "generated-candidate", privacyHits);
    generatedFilesScanned += 1;
    if (path.extname(candidate.absolute).toLowerCase() === ".zip" || hasZipStructure(bytes)) {
      if (archivesScanned >= DEFAULT_ARCHIVE_SCAN_LIMITS.maxTopLevelArchives) {
        privacyHits.push({ scope: "release-archive", file: displayPath, pattern: "archive-count-limit-exceeded" });
        continue;
      }
      archivesScanned += 1;
      archiveEntriesScanned += scanZipArchive(candidate.absolute, displayPath, privacyHits);
      scannedArchivePaths.add(candidate.absolute);
    }
  }
  for (const archive of publicArchives) {
    if (scannedArchivePaths.has(archive.absolute)) continue;
    if (archivesScanned >= DEFAULT_ARCHIVE_SCAN_LIMITS.maxTopLevelArchives) {
      privacyHits.push({ scope: "release-archive", file: archive.relative, pattern: "archive-count-limit-exceeded" });
      continue;
    }
    archivesScanned += 1;
    archiveEntriesScanned += scanZipArchive(archive.absolute, archive.relative, privacyHits);
  }
  check("public-safe-source-bytes", privacyHits.filter((hit) => hit.scope === "public-source").length === 0, privacyHits.length ? "forbidden public-byte findings are recorded only in the ignored private report" : `${textFilesScanned} text and ${binaryFilesScanned} binary source files contain no forbidden private signatures`);
  check("public-safe-generated-candidates", privacyHits.filter((hit) => hit.scope.startsWith("generated-candidate")).length === 0, `${generatedFilesScanned} generated website/marketing/release-candidate files scanned`);
  check("public-safe-release-archives", privacyHits.filter((hit) => hit.scope.startsWith("release-archive")).length === 0, `${archivesScanned} archives and ${archiveEntriesScanned} archive entries scanned; absent archives are reported as absent, not release proof`);
  check("forbidden-private-paths-excluded", !publicFiles.some((file) => isPrivateOrGenerated(file)), "simulated public tree must exclude every private/generated path");

  let gitBoundary = {
    status: "not-available",
    reason: "repository has no local Git lineage; initialization/commit remains unauthorized",
    prospective_author_identity: "unresolved-owner-decision-required",
    remote_location_inherent_visibility: "must-be-acknowledged-before-first-publication",
  };
  try {
    const gitStat = await lstat(path.join(ROOT, ".git"));
    if (gitStat.isDirectory() || gitStat.isFile()) {
      const result = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr.trim() || "git ls-files failed");
      const tracked = result.stdout.split("\0").filter(Boolean);
      const forbiddenTracked = tracked.filter((file) => isPrivateOrGenerated(file));
      check("git-tracked-private-boundary", forbiddenTracked.length === 0, forbiddenTracked.length ? forbiddenTracked.join(", ") : `${tracked.length} tracked paths checked`);
      gitBoundary = { status: forbiddenTracked.length ? "failed" : "passed", tracked_files: tracked.length, forbidden_tracked: forbiddenTracked };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const publicTreeSha256 = await hashPublicTree(publicFiles);
  await mkdir(path.dirname(PRIVATE_REPORT), { recursive: true });
  const privateReport = {
    schema_version: 1,
    status: privacyHits.length ? "failed" : "passed",
    public_source_files: publicFiles.length,
    generated_candidate_files: generatedFilesScanned,
    archives_scanned: archivesScanned,
    archive_entries_scanned: archiveEntriesScanned,
    findings: privacyHits,
    note: "Ignored local report. Never stage, archive, publish, or copy into public evidence.",
  };
  await writeFile(PRIVATE_REPORT, `${JSON.stringify(privateReport, null, 2)}\n`, { mode: 0o600 });
  const report = {
    schema_version: 1,
    status: failures.length ? "failed" : "passed",
    release_ready: false,
    generated_at: null,
    generation_time_policy: "omitted-for-byte-reproducibility",
    public_tree_simulation: {
      status: failures.length ? "failed" : "passed",
      files: publicFiles.length,
      sha256: publicTreeSha256,
      text_files_scanned: textFilesScanned,
      binary_files_scanned: binaryFilesScanned,
      private_and_generated_paths_excluded: true,
    },
    generated_and_release_candidates: {
      status: privacyHits.length ? "failed" : "passed",
      files_scanned: generatedFilesScanned,
      archives_scanned: archivesScanned,
      archive_entries_scanned: archiveEntriesScanned,
      private_findings_report: "ignored-local-only",
    },
    git_history_and_tracking: gitBoundary,
    checks_total: checks.length,
    checks_passed: checks.filter((item) => item.status === "passed").length,
    checks_failed: failures.length,
    checks,
    failures,
    claim_boundary: "This validates a simulated public-safe source tree and every currently present generated website/marketing/release candidate. It records archive absence honestly. It does not prove Git tracking/history, future author identity, a clean public clone, repository visibility, branch protection, CI execution, a release archive, or publication while Git and external mutations remain unauthorized.",
  };
  await mkdir(path.dirname(REPORT_JSON), { recursive: true });
  await writeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await writeFile(REPORT_TEXT, `${report.status.toUpperCase()} ${report.checks_passed}/${report.checks_total} public-boundary checks; simulated source files ${publicFiles.length}; generated candidates ${generatedFilesScanned}; archives ${archivesScanned}; Git boundary ${gitBoundary.status}; release ready false.\n`, { mode: 0o600 });
  if (failures.length) throw new Error(`public repository validation failed (${failures.length}): ${failures.join("; ")}`);
  process.stdout.write(`Public repository validation passed: ${report.checks_passed}/${report.checks_total} checks across ${publicFiles.length} simulated public files; Git/history gate ${gitBoundary.status}.\n`);
}

export { DEFAULT_ARCHIVE_SCAN_LIMITS, scanZipArchive };

if (process.argv[1] && path.resolve(process.argv[1]) === MODULE_PATH) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
