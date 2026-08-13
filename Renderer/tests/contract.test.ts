import fixture from "../../Shared/fixtures/garden-state-day-2.json";
import { describe, expect, it } from "vitest";
import { createRendererRequestID } from "../src/bridge";
import { decodeSnapshotEnvelope, GardenContractError, validateGardenState } from "../src/validation";

describe("GardenState contract", () => {
  it("accepts the exact shared Swift fixture", () => {
    const state = validateGardenState(fixture);
    expect(state.journeyDay).toBe(2);
    expect(state.activeCustomization).toEqual({ "1": "m01-a" });
  });

  it("rejects fields outside the public renderer contract", () => {
    const unsafe = { ...fixture, journalText: "must never cross this boundary" };
    expect(() => validateGardenState(unsafe)).toThrow(GardenContractError);
  });

  it("rejects seeds that JavaScript cannot represent exactly", () => {
    const unsafe = { ...fixture, gardenSeed: Number.MAX_SAFE_INTEGER + 1 };
    expect(() => validateGardenState(unsafe)).toThrow(GardenContractError);
  });

  it("accepts native day phases and rejects invented atmosphere phases", () => {
    expect(validateGardenState({ ...fixture, localDayPhase: "dawn" }).localDayPhase).toBe("dawn");
    expect(() => validateGardenState({ ...fixture, localDayPhase: "midnight-blue" })).toThrow(
      GardenContractError,
    );
  });

  it("requires a bounded typed bridge envelope", () => {
    const envelope = decodeSnapshotEnvelope({
      type: "state-snapshot",
      schemaVersion: 1,
      requestID: "60000000-0000-4000-8000-000000000001",
      payload: { state: fixture },
    });
    expect(envelope.payload.state.profileGenerationID).toBe(fixture.profileGenerationID);

    expect(() =>
      decodeSnapshotEnvelope({
        type: "state-delta",
        schemaVersion: 1,
        requestID: "60000000-0000-4000-8000-000000000001",
        payload: { state: fixture },
      }),
    ).toThrow(GardenContractError);
  });

  it("creates request IDs without secure-context-only browser APIs", () => {
    expect(createRendererRequestID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
