import assert from "node:assert/strict";

import {
  assertCaptureSetSourceBinding,
  SELECTED_CAPTURE_IDS,
  type CurrentCaptureSourceBinding,
} from "./capture-set-provenance";
import type { CaptureSet } from "./contracts";

const current: CurrentCaptureSourceBinding = {
  source_revision: "1".repeat(64),
  source_manifest_path: "capture-source-manifest-v1.0.2-build-19.json",
  source_manifest_sha256: "2".repeat(64),
};

function currentSet(device: "iphone-6.9" | "ipad-13") {
  return {
    device,
    capture_source: {
      state: "current" as const,
      ...current,
      app_version: "1.0.2",
      build_number: "19",
      bound_capture_ids: [...SELECTED_CAPTURE_IDS],
      missing_capture_ids: [],
    },
  };
}

const currentPhone = currentSet("iphone-6.9");
const currentIpad13 = currentSet("ipad-13");

assert.doesNotThrow(() => assertCaptureSetSourceBinding(currentPhone, current));
assert.doesNotThrow(() => assertCaptureSetSourceBinding(currentIpad13, current));
assert.throws(
  () => assertCaptureSetSourceBinding({
    ...currentIpad13,
    capture_source: { ...currentIpad13.capture_source, source_revision: "0".repeat(64) },
  }, current),
  /not bound to the current/,
  "an old iPad source revision must not satisfy the required current capture set",
);
assert.throws(
  () => assertCaptureSetSourceBinding({
    ...currentIpad13,
    capture_source: {
      ...currentIpad13.capture_source,
      bound_capture_ids: SELECTED_CAPTURE_IDS.filter((id) => id !== "garden-day"),
    },
  }, current),
  /not bound to the current/,
  "the required iPad set must bind the real Garden-day capture",
);
const staleIpad13 = {
  ...currentIpad13,
  capture_source: {
    ...currentIpad13.capture_source,
    state: "stale-incomplete" as const,
    app_version: null,
    build_number: null,
  },
} as unknown as Pick<CaptureSet, "device" | "capture_source">;
assert.throws(
  () => assertCaptureSetSourceBinding(staleIpad13, current),
  /not bound to the current/,
  "the required 13-inch iPad set cannot silently use stale provenance",
);

process.stdout.write("Per-set capture provenance passed: current iPhone/iPad 13 bindings and stale-source negative controls.\n");
