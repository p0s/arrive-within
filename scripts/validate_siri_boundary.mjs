#!/usr/bin/env node

// ADR-0015 static boundary: exactly three shipping App Intents that return only
// minimal status, no finishing or private-data entry point, a DEBUG-only
// inspection intent, and Siri AI tool exposure only in the beta SiriPreview
// configuration.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function read(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), "utf8");
}

function swiftSources(relativeDirectory) {
  return readdirSync(resolve(projectRoot, relativeDirectory))
    .filter((name) => name.endsWith(".swift"))
    .sort()
    .map((name) => ({ name, source: read(join(relativeDirectory, name)) }));
}

function sameSet(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function wrappedBy(source, condition) {
  const lines = source.trim().split(/\r?\n/u);
  return lines[0] === `#if ${condition}` && lines.at(-1) === "#endif"
    && lines.filter((line) => /^\s*#if\b/u.test(line)).length === 1;
}

const appSources = swiftSources("Apps/ArriveWithin/Sources");
const shippingIntents = ["StartSilentPracticeIntent", "StartGuidedPracticeIntent", "SetPracticePausedIntent"];
const declaredIntents = appSources.flatMap(({ name, source }) =>
  [...source.matchAll(/\bstruct\s+(\w+)\s*:\s*AppIntent\b/gu)].map((match) => ({ name, type: match[1] })),
);
check(
  sameSet(declaredIntents.map(({ type }) => type), [...shippingIntents, "InspectPracticeForVerificationIntent"]),
  `app sources declare unexpected App Intents: ${declaredIntents.map(({ type }) => type).join(", ")}`,
);
check(
  declaredIntents.filter(({ name }) => name !== "PracticeAppIntents.swift").every(({ type, name }) =>
    type === "InspectPracticeForVerificationIntent" && name === "PracticeVerificationIntent.swift"),
  "shipping App Intents must live in PracticeAppIntents.swift",
);

const verificationSource = read("Apps/ArriveWithin/Sources/PracticeVerificationIntent.swift");
check(wrappedBy(verificationSource, "DEBUG"), "the inspection intent must be compiled only in DEBUG");
check(/static let isDiscoverable = false/u.test(verificationSource), "the inspection intent must stay hidden from Shortcuts");

const toolFiles = appSources.filter(({ source }) => /\bToolIntent\b/u.test(source)).map(({ name }) => name);
check(sameSet(toolFiles, ["PracticeToolIntents.swift"]), `ToolIntent appears outside the preview file: ${toolFiles.join(", ")}`);
const toolSource = read("Apps/ArriveWithin/Sources/PracticeToolIntents.swift");
check(wrappedBy(toolSource, "ARRIVE_WITHIN_SIRI_TOOLS_PREVIEW"), "tool conformances must sit behind the preview compilation condition");
const tools = [...toolSource.matchAll(/extension\s+(\w+)\s*:\s*ToolIntent\s*\{\}/gu)].map((match) => match[1]);
check(sameSet(tools, shippingIntents), `preview tools differ from the three practice actions: ${tools.join(", ")}`);
check(
  [...toolSource.matchAll(/@available\(iOS 27\.3, \*\)/gu)].length === shippingIntents.length,
  "each preview tool conformance must require iOS 27.3",
);

const extensionSources = swiftSources("Apps/ArriveWithinLiveActivity/Sources");
check(
  extensionSources.every(({ source }) => !/\b(?:import\s+AppIntents|AppIntent|ToolIntent)\b/u.test(source)),
  "the Live Activity extension must not contain App Intents",
);

const intentSource = read("Apps/ArriveWithin/Sources/PracticeAppIntents.swift");
const controllerSource = read("Apps/ArriveWithin/Sources/PracticeIntentController.swift");
const forbiddenModelEntryPoints = [
  "finishPractice", "completeActiveSession", "discardRecoveredSession", "confirmRecovery",
  "journalEntries", "saveJournalEntry", "journeyProjection", "gardenState", "favoriteGuidedPracticeIDs",
  "toggleFavorite", "productDataCounts", "exportAllProductData", "restoreProductData",
  "resetGardenAndPrivateHistory", "deleteAllProductData", "weeklyReminderSchedules", "saveWeeklyReminder",
  "purchasePremiumGardenStyles", "restorePremiumGardenStyles", "saveTimerPreferences", "beginTimerPractice",
];
for (const identifier of forbiddenModelEntryPoints) {
  const pattern = new RegExp(`\\b${identifier}\\b`, "u");
  check(!pattern.test(intentSource) && !pattern.test(controllerSource), `Siri sources must not reach ${identifier}`);
}

function propertiesOf(source, typeName) {
  const start = source.indexOf(`struct ${typeName}:`);
  if (start < 0) return null;
  const next = source.indexOf("\nstruct ", start + 1);
  const body = source.slice(start, next < 0 ? undefined : next);
  return [...body.matchAll(/@Property\([^)]*\)\s*var\s+(\w+)/gu)].map((match) => match[1]);
}

const statusProperties = propertiesOf(intentSource, "PracticeStatusEntity");
check(sameSet(statusProperties ?? [], ["mode", "state", "plannedMinutes"]), "practice status must expose only mode, state, and planned minutes");
const practiceProperties = propertiesOf(intentSource, "GuidedPracticeEntity");
check(sameSet(practiceProperties ?? [], ["purpose", "minutes"]), "guided practice entities must expose only purpose and minutes");
check(
  /static var supportedModes: IntentModes \{ \.background \}/u.test(intentSource.slice(intentSource.indexOf("struct SetPracticePausedIntent"))),
  "pause and resume must run without opening the app",
);
check(
  [...intentSource.matchAll(/static var allowedExecutionTargets: IntentExecutionTargets \{ \.main \}/gu)].length === shippingIntents.length,
  "each practice action must be limited to the main app on iOS 27",
);

const project = read("project.yml").split(/\r?\n/u);
function configKeyAbove(lineIndex) {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const match = project[index].match(/^\s+(Debug|Release|SiriPreview):\s*$/u);
    if (match) return match[1];
  }
  return null;
}
const flagLines = project.flatMap((line, index) => (line.includes("ARRIVE_WITHIN_SIRI_TOOLS_PREVIEW") ? [index] : []));
check(
  flagLines.length > 0 && flagLines.every((index) => configKeyAbove(index) === "SiriPreview"),
  "only the SiriPreview configuration may define the preview condition",
);
check(
  wrappedBy(read("Apps/ArriveWithin/Tests/ArriveWithinSiriEvaluations/ArriveWithinSiriEvaluations.swift"), "ARRIVE_WITHIN_SIRI_TOOLS_PREVIEW"),
  "Siri AI evaluations must compile only behind the preview condition",
);
const projectText = project.join("\n");
const defaultScheme = projectText.slice(
  projectText.indexOf("\n  ArriveWithin:\n    build:"),
  projectText.indexOf("\n  ArriveWithinMarketingCaptures:"),
);
check(
  defaultScheme.length > 0 && !defaultScheme.includes("ArriveWithinSiriEvaluations"),
  "the default ArriveWithin scheme must not build the beta-only evaluations",
);
const exclusionLines = project.flatMap((line, index) =>
  (line.includes("EXCLUDED_SOURCE_FILE_NAMES") && line.includes("PracticeToolIntents.swift") ? [index] : []));
check(
  sameSet(exclusionLines.map(configKeyAbove), ["Debug", "Release"]),
  "Debug and Release must both exclude the preview tool file",
);
check(project.some((line) => /^\s+SiriPreview: release\s*$/u.test(line)), "project.yml must declare the release-based SiriPreview configuration");

if (failures.length) {
  for (const failure of failures) process.stderr.write(`Siri boundary failed: ${failure}\n`);
  process.exit(1);
}
process.stdout.write(
  `Siri boundary passed: ${shippingIntents.length} shipping App Intents, ${tools.length} preview-only tools, DEBUG-only inspection, ${forbiddenModelEntryPoints.length} forbidden entry points absent.\n`,
);
