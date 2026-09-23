import assert from "node:assert/strict";

import {
  detectPublicPrivacySignatures,
  isIntentionalPublicRepositorySurface,
  maskIntentionalPublicRepositoryURLs,
  publicAnalyticsOptOutCookie,
  publicRepositoryURL,
  repositoryOwnerHandle,
} from "./lib/public-repository-link-policy.mjs";

assert.equal(isIntentionalPublicRepositorySurface("README.md"), true);
assert.equal(isIntentionalPublicRepositorySurface("Website/src/content.mjs"), true);
assert.equal(isIntentionalPublicRepositorySurface("website-dist/de/open-source/index.html"), true);
assert.equal(isIntentionalPublicRepositorySurface("Apps/ArriveWithin/Sources/App.swift"), false);
assert.equal(isIntentionalPublicRepositorySurface("docs/evidence/INDEX.md"), false);

assert.equal(maskIntentionalPublicRepositoryURLs(publicRepositoryURL, "README.md"), "");
assert.equal(maskIntentionalPublicRepositoryURLs(publicRepositoryURL, "Website/src/content.mjs"), "");
assert.equal(maskIntentionalPublicRepositoryURLs(publicRepositoryURL, "website-dist/index.html"), "");
assert.deepEqual(detectPublicPrivacySignatures(publicRepositoryURL, "README.md"), []);
assert.deepEqual(detectPublicPrivacySignatures(publicRepositoryURL, "Website/src/content.mjs"), []);
assert.deepEqual(detectPublicPrivacySignatures(publicRepositoryURL, "website-dist/index.html"), []);
assert.equal(
  maskIntentionalPublicRepositoryURLs(publicRepositoryURL, "Apps/ArriveWithin/Sources/App.swift"),
  publicRepositoryURL,
);
assert.equal(detectPublicPrivacySignatures(publicRepositoryURL, "Apps/ArriveWithin/Sources/App.swift").includes("owner-handle"), true);
assert.equal(detectPublicPrivacySignatures(publicRepositoryURL, "docs/evidence/INDEX.md").includes("repository-owner-location"), true);
assert.equal(
  maskIntentionalPublicRepositoryURLs(publicRepositoryURL, "docs/evidence/INDEX.md"),
  publicRepositoryURL,
);

for (const nearMatch of [
  `${publicRepositoryURL}-fork`,
  `${publicRepositoryURL}/`,
  `${publicRepositoryURL}?ref=source`,
  `https://github.com/${repositoryOwnerHandle}/another-project`,
]) {
  assert.equal(maskIntentionalPublicRepositoryURLs(nearMatch, "README.md"), nearMatch);
  assert.equal(detectPublicPrivacySignatures(nearMatch, "README.md").includes("owner-handle"), true);
}

const blueprintVariable = `${repositoryOwnerHandle.toUpperCase()}_IOS_BLUEPRINT_ROOT`;
for (const surface of ["scripts/verify", "docs/qa/VERIFICATION.md"]) {
  assert.deepEqual(detectPublicPrivacySignatures(blueprintVariable, surface), []);
  for (const forbidden of [repositoryOwnerHandle, `${blueprintVariable}_OTHER`, blueprintVariable.toLowerCase()]) {
    assert.equal(detectPublicPrivacySignatures(forbidden, surface).includes("owner-handle"), true);
  }
}
assert.equal(detectPublicPrivacySignatures(blueprintVariable, "Apps/ArriveWithin/Sources/App.swift").includes("owner-handle"), true);

assert.deepEqual(detectPublicPrivacySignatures(publicAnalyticsOptOutCookie, "Website/src/analytics.mjs"), []);
assert.equal(
  detectPublicPrivacySignatures(`${publicAnalyticsOptOutCookie}_extra`, "Website/src/analytics.mjs").includes("owner-handle"),
  true,
);
assert.equal(
  detectPublicPrivacySignatures(publicAnalyticsOptOutCookie, "docs/example.md").includes("owner-handle"),
  true,
);
const githubSecretFixture = `ghp_${"A".repeat(36)}`;
assert.equal(
  detectPublicPrivacySignatures(`${publicAnalyticsOptOutCookie} ${githubSecretFixture}`, "Website/src/analytics.mjs").includes("github-token"),
  true,
);

for (const [forbiddenControl, expectedSignature] of [
  [repositoryOwnerHandle, "owner-handle"],
  [["", "Users", "example", "private.txt"].join("/"), "personal-home"],
  [`${["DEVELOPMENT", "TEAM"].join("_")} = ${["ABCDE", "12345"].join("")}`, "development-team-id"],
  [String.fromCharCode(112, 112, 97, 100), "device-alias"],
]) {
  assert.equal(detectPublicPrivacySignatures(forbiddenControl, "README.md").includes(expectedSignature), true);
}

process.stdout.write("Public repository link policy tests passed: exact allowlisted surfaces only; near matches, arbitrary files, personal paths, devices, and account values remain rejected.\n");
