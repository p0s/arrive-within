import assert from "node:assert/strict";
import { assertPhysicalCaptureClock } from "./physical-capture-provenance";

const report = {
  startedAt: "2026-09-30T00:06:30.899Z", timezone: "Asia/Shanghai",
  captureLocalDate: "2026-09-30", visibleStatusTime: "08:06",
};
assertPhysicalCaptureClock(report);
assertPhysicalCaptureClock({ ...report, timezone: "Asia/Singapore" });
assert.equal(report.timezone, "Asia/Shanghai");
for (const patch of [
  { timezone: "UTC" }, { timezone: "Mars/Olympus" }, { timezone: "+08:00" },
  { captureLocalDate: "2026-10-01" }, { visibleStatusTime: "08:07" },
  { startedAt: "2026-09-30T00:06:30" }, { startedAt: "2026-02-30T00:06:30Z" },
]) assert.throws(() => assertPhysicalCaptureClock({ ...report, ...patch }));

assert.throws(() => assertPhysicalCaptureClock({
  ...report, startedAt: "1991-07-01T00:00:00Z", captureLocalDate: "1991-07-01", visibleStatusTime: "08:00",
}), /must match Asia\/Singapore/);
const midnight = { ...report, startedAt: "2026-09-25T16:01:00Z", captureLocalDate: "2026-09-26", visibleStatusTime: "00:01" };
assertPhysicalCaptureClock(midnight);
assert.throws(() => assertPhysicalCaptureClock({ ...midnight, captureLocalDate: "2026-09-25" }), /unmodified capture clock/);
process.stdout.write("Physical clock controls passed: observed timezone, exact minute/date, midnight, invalid ISO and historical DST.\n");
