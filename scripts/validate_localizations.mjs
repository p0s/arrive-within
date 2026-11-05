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

function formatArguments(value) {
  const found = [];
  let position = 0;
  for (const match of value.matchAll(/%(?:(\d+)\$)?(lld|ld|d|@|\.\d+f|f|%)/gu)) {
    if (match[2] === "%") continue;
    position = match[1] ? Number(match[1]) : position + 1;
    found.push(`${position}:${match[2]}`);
  }
  return found.sort().join(",");
}

for (const [key, value] of Object.entries(enStrings)) {
  if (formatArguments(value) !== formatArguments(deStrings[key])) {
    fail(`English and German format arguments differ for ${key}`);
  }
}

// Siri and Shortcuts (ADR-0015): phrases, catalog titles, and intent keys.
const enShortcutsPath = "Apps/ArriveWithin/Resources/en.lproj/AppShortcuts.strings";
const deShortcutsPath = "Apps/ArriveWithin/Resources/de.lproj/AppShortcuts.strings";
const enShortcuts = loadPropertyList(enShortcutsPath);
const deShortcuts = loadPropertyList(deShortcutsPath);
assertUniqueStringKeys(enShortcutsPath, enShortcuts);
assertUniqueStringKeys(deShortcutsPath, deShortcuts);
assertParity("App Shortcut phrase", enShortcuts, deShortcuts);
assertNonempty("English App Shortcut phrases", enShortcuts);
assertNonempty("German App Shortcut phrases", deShortcuts);

function placeholders(value) {
  return [...value.matchAll(/\$\{([A-Za-z]+)\}/gu)].map((match) => match[1]).sort().join(",");
}

for (const [phrase, english] of Object.entries(enShortcuts)) {
  if ([...phrase.matchAll(/\$\{applicationName\}/gu)].length !== 1) {
    fail(`App Shortcut phrase "${phrase}" must name the app exactly once`);
  }
  for (const [locale, value] of [["English", english], ["German", deShortcuts[phrase]]]) {
    if (placeholders(value) !== placeholders(phrase)) {
      fail(`${locale} App Shortcut phrase for "${phrase}" changes its placeholders`);
    }
  }
}

const catalog = JSON.parse(readFileSync(resolve(projectRoot, "Content/guided/catalog.json"), "utf8"));
for (const practice of catalog.practices) {
  const englishTitle = practice.localized.en.title;
  if (enStrings[englishTitle] !== englishTitle || deStrings[englishTitle] !== practice.localized.de.title) {
    fail(`the Siri title for ${practice.id} does not match the guided catalogue in English and German`);
  }
}

const intentSourcePath = "Apps/ArriveWithin/Sources/PracticeAppIntents.swift";
let intentKeyCount = 0;
for (const line of readFileSync(resolve(projectRoot, intentSourcePath), "utf8").split(/\r?\n/u)) {
  const code = line.trim();
  if (code.startsWith("//") || code.includes("systemImageName:") || code.includes("defaultValue:")) continue;
  for (const match of code.matchAll(/"((?:[^"\\]|\\.)*)"/gu)) {
    const literal = match[1];
    if (literal.includes("\\(.applicationName)")) {
      const phrase = literal
        .replaceAll("\\(.applicationName)", "${applicationName}")
        .replace(/\\\(\\\.\$(\w+)\)/gu, "${$1}");
      if (!(phrase in enShortcuts)) fail(`App Shortcut phrase "${phrase}" has no localized entry`);
      continue;
    }
    const key = literal.replace(/\\\(minutes\)/gu, "%lld").replace(/\\\((?:title|purpose)\)/gu, "%@");
    if (key.includes("\\(")) fail(`${intentSourcePath} interpolates an unmapped value in "${literal}"`);
    if (!(key in enStrings) || !(key in deStrings)) {
      fail(`${intentSourcePath} key "${key}" lacks an English or German value`);
    }
    intentKeyCount += 1;
  }
}
if (intentKeyCount < 60) fail(`${intentSourcePath} unexpectedly exposes only ${intentKeyCount} localized keys`);

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
  `Localization gate passed: ${Object.keys(enStrings).length} UI keys, ${Object.keys(enInfo).length} Info.plist keys, and ${Object.keys(enShortcuts).length} App Shortcut phrases per locale; ${intentKeyCount} Siri intent strings resolved.\n`,
);
