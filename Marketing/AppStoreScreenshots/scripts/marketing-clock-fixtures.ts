import { readFileSync } from "node:fs";
import path from "node:path";

import { ROOT } from "./contracts";

export type MarketingClockFixture = {
  id: "day-v1" | "dusk-v1";
  epoch: number;
  instant: string;
  timezone: "Asia/Singapore";
  local_date: string;
  local_time: string;
  garden_phase: "day" | "dusk";
};

export const MARKETING_STATUS_BAR_DECLARATION =
  "Simulator system status captured as rendered; no status-bar override.";

const EXPECTED_FIXTURES: MarketingClockFixture[] = [
  {
    id: "day-v1",
    epoch: 1785548460,
    instant: "2026-08-01T01:41:00Z",
    timezone: "Asia/Singapore",
    local_date: "2026-08-01",
    local_time: "09:41",
    garden_phase: "day",
  },
  {
    id: "dusk-v1",
    epoch: 1785577260,
    instant: "2026-08-01T09:41:00Z",
    timezone: "Asia/Singapore",
    local_date: "2026-08-01",
    local_time: "17:41",
    garden_phase: "dusk",
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[], context: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${context}: expected exactly keys ${wanted.join(", ")}`);
  }
}

function localDateAndTime(epoch: number, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epoch * 1000));
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)?.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function loadFixtures(): Map<MarketingClockFixture["id"], MarketingClockFixture> {
  const filename = path.resolve(ROOT, "../..", "Apps/ArriveWithin/Resources/MarketingCaptureClockFixtures.json");
  const value: unknown = JSON.parse(readFileSync(filename, "utf8"));
  if (!isRecord(value)) throw new Error("marketing clock fixture document must be an object");
  exactKeys(value, ["schema_version", "fixtures"], "marketing clock fixture document");
  if (
    value.schema_version !== 1 ||
    !Array.isArray(value.fixtures) || value.fixtures.length !== EXPECTED_FIXTURES.length
  ) throw new Error("marketing clock fixture document is not the reviewed version 1 contract");

  const loaded = new Map<MarketingClockFixture["id"], MarketingClockFixture>();
  for (const [index, candidate] of value.fixtures.entries()) {
    const expected = EXPECTED_FIXTURES[index];
    if (!isRecord(candidate)) throw new Error(`marketing clock fixture ${index} must be an object`);
    exactKeys(candidate, ["id", "epoch", "instant", "timezone", "local_date", "local_time", "garden_phase"], `marketing clock fixture ${index}`);
    if (
      candidate.id !== expected.id || candidate.epoch !== expected.epoch || candidate.instant !== expected.instant ||
      candidate.timezone !== expected.timezone || candidate.local_date !== expected.local_date ||
      candidate.local_time !== expected.local_time || candidate.garden_phase !== expected.garden_phase ||
      new Date(expected.instant).getTime() !== expected.epoch * 1000 ||
      new Date(expected.epoch * 1000).toISOString().replace(/\.000Z$/, "Z") !== expected.instant
    ) throw new Error(`marketing clock fixture ${expected.id} differs from its pinned identity`);
    const derived = localDateAndTime(expected.epoch, expected.timezone);
    if (derived.date !== expected.local_date || derived.time !== expected.local_time) {
      throw new Error(`marketing clock fixture ${expected.id} has an invalid local date or time`);
    }
    loaded.set(expected.id, expected);
  }
  return loaded;
}

const FIXTURES = loadFixtures();

export function marketingClockFixture(id: unknown): MarketingClockFixture {
  if (typeof id !== "string" || !FIXTURES.has(id as MarketingClockFixture["id"])) {
    throw new Error("capture proof has an unknown clock fixture");
  }
  return FIXTURES.get(id as MarketingClockFixture["id"])!;
}

export function expectedClockFixtureID(role: "selected" | "garden-day"): MarketingClockFixture["id"] {
  return role === "selected" ? "dusk-v1" : "day-v1";
}

export function expectedClockFixtureIDForCapture(captureID: string): MarketingClockFixture["id"] {
  return captureID === "garden-day" ? "day-v1" : "dusk-v1";
}
