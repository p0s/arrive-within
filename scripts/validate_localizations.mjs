#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resourceRoot = resolve(projectRoot, "Apps/ArriveWithin/Resources");

function fail(message) {
  process.stderr.write(`Localization gate failed: ${message}\n`);
  process.exit(1);
}

function loadPropertyList(relativePath) {
  const absolutePath = resolve(projectRoot, relativePath);
  const result = spawnSync(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", absolutePath],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    fail(`${relativePath} is not a valid property list: ${result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout);
}

function assertUniqueStringKeys(relativePath, parsed) {
  const source = readFileSync(resolve(projectRoot, relativePath), "utf8");
  const seen = new Set();
  let declarationCount = 0;
  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*=/u);
    if (!match) continue;
    declarationCount += 1;
    const key = match[1];
    if (seen.has(key)) fail(`${relativePath} declares ${key} more than once`);
    seen.add(key);
  }
  if (declarationCount !== Object.keys(parsed).length) {
    fail(`${relativePath} contains an unparsed or duplicate string declaration`);
  }
}

function assertParity(name, left, right) {
  const leftKeys = new Set(Object.keys(left));
  const rightKeys = new Set(Object.keys(right));
  const missingRight = [...leftKeys].filter((key) => !rightKeys.has(key)).sort();
  const missingLeft = [...rightKeys].filter((key) => !leftKeys.has(key)).sort();
  if (missingRight.length || missingLeft.length) {
    fail(
      `${name} parity differs; missing de=[${missingRight.join(", ")}], missing en=[${missingLeft.join(", ")}]`,
    );
  }
}

function assertNonempty(name, dictionary) {
  for (const [key, value] of Object.entries(dictionary)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      fail(`${name} has an empty or non-string value for ${key}`);
    }
  }
}

const enStringsPath = "Apps/ArriveWithin/Resources/en.lproj/Localizable.strings";
const deStringsPath = "Apps/ArriveWithin/Resources/de.lproj/Localizable.strings";
const enInfoPath = "Apps/ArriveWithin/Resources/en.lproj/InfoPlist.strings";
const deInfoPath = "Apps/ArriveWithin/Resources/de.lproj/InfoPlist.strings";

const enStrings = loadPropertyList(enStringsPath);
const deStrings = loadPropertyList(deStringsPath);
const enInfo = loadPropertyList(enInfoPath);
const deInfo = loadPropertyList(deInfoPath);
const info = loadPropertyList("Apps/ArriveWithin/Resources/Info.plist");
const privacy = loadPropertyList("Apps/ArriveWithin/Resources/PrivacyInfo.xcprivacy");

assertUniqueStringKeys(enStringsPath, enStrings);
assertUniqueStringKeys(deStringsPath, deStrings);
assertUniqueStringKeys(enInfoPath, enInfo);
assertUniqueStringKeys(deInfoPath, deInfo);
assertParity("UI string", enStrings, deStrings);
assertParity("Info.plist string", enInfo, deInfo);
assertNonempty("English UI strings", enStrings);
assertNonempty("German UI strings", deStrings);
assertNonempty("English Info.plist strings", enInfo);
assertNonempty("German Info.plist strings", deInfo);

if (Object.keys(enStrings).length < 310) fail("the UI catalogue unexpectedly lost keys");

const requiredInfoKeys = new Set([
  "CFBundleDisplayName",
  "NSMicrophoneUsageDescription",
  "NSSpeechRecognitionUsageDescription",
]);
const actualInfoKeys = new Set(Object.keys(enInfo));
if (
  actualInfoKeys.size !== requiredInfoKeys.size
  || [...requiredInfoKeys].some((key) => !actualInfoKeys.has(key))
) {
  fail("localized Info.plist keys do not match the declared permission/display-name surface");
}

const declaredLocales = new Set(info.CFBundleLocalizations ?? []);
if (info.CFBundleDevelopmentRegion !== "en" || !declaredLocales.has("en") || !declaredLocales.has("de")) {
  fail("Info.plist must declare English development plus English/German localizations");
}

if (
  privacy.NSPrivacyTracking !== false
  || (privacy.NSPrivacyTrackingDomains ?? []).length !== 0
) {
  fail("PrivacyInfo.xcprivacy no longer declares tracking absence");
}

process.stdout.write(
  `Localization gate passed: ${Object.keys(enStrings).length} UI keys and ${Object.keys(enInfo).length} Info.plist keys per locale.\n`,
);
