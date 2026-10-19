export const CAPTURE_STATUS_BAR_PROFILE =
  "Actual visible system status from every exact simulator attachment and physical screenshot; Garden-day time matches the unmodified SGT clock; no synthetic status-bar overlay.";

// Native CoreDevice productType for the supported physical 13-inch iPad route.
export const PHYSICAL_IPAD_PRODUCT_TYPE = "iPad16,5";

export function assertPhysicalCaptureClock(value: unknown): void {
  if (!value || typeof value !== "object") throw new Error("physical capture clock is missing");
  const report = value as Record<string, unknown>;
  const timestamp = report.startedAt;
  const zone = report.timezone;
  if (typeof timestamp !== "string" || typeof zone !== "string" || zone.length > 128 || !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(zone)) {
    throw new Error("physical capture timestamp or timezone is invalid");
  }
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) throw new Error("physical capture timestamp must include an ISO-8601 offset");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const calendarCheck = new Date(0);
  calendarCheck.setUTCFullYear(year, month - 1, day);
  calendarCheck.setUTCHours(hour, minute, second, 0);
  if (
    calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1 ||
    calendarCheck.getUTCDate() !== day || calendarCheck.getUTCHours() !== hour ||
    calendarCheck.getUTCMinutes() !== minute || calendarCheck.getUTCSeconds() !== second
  ) throw new Error("physical capture timestamp has an invalid calendar date or time");
  const instant = new Date(timestamp);
  if (!Number.isFinite(instant.getTime())) throw new Error("physical capture timestamp is invalid");
  const clock = (timeZone: string) => {
    let parts: Intl.DateTimeFormatPart[];
    try {
      parts = new Intl.DateTimeFormat("en-GB", {
        timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "longOffset",
      }).formatToParts(instant);
    } catch {
      throw new Error("physical capture timezone is invalid");
    }
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
    return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}`, offset: part("timeZoneName") };
  };
  const observed = clock(zone);
  const singapore = clock("Asia/Singapore");
  if (observed.offset !== singapore.offset || observed.date !== singapore.date || observed.time !== singapore.time) {
    throw new Error("physical capture timezone must match Asia/Singapore at the capture instant");
  }
  if (report.captureLocalDate !== observed.date || report.visibleStatusTime !== observed.time) {
    throw new Error("reported date and visible time must match the unmodified capture clock");
  }
}

export function assertCaptureStatusBarProfile(value: unknown): asserts value is typeof CAPTURE_STATUS_BAR_PROFILE {
  if (value !== CAPTURE_STATUS_BAR_PROFILE) {
    throw new Error("truthful status-bar capture provenance is missing or inconsistent");
  }
}
