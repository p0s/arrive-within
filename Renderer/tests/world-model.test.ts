import fixture from "../../Shared/fixtures/garden-state-day-2.json";
import { describe, expect, it } from "vitest";
import type { GardenState } from "../src/types";
import { deriveWorldModel, qualityProfile } from "../src/world-model";
import { validateGardenState } from "../src/validation";

const state: GardenState = validateGardenState(fixture);

describe("deterministic authored world model", () => {
  it("rebuilds the exact same geometry plan from the same state", () => {
    expect(deriveWorldModel(state)).toEqual(deriveWorldModel(structuredClone(state)));
  });

  it("changes permanent tree form when the journey advances", () => {
    const dayTwo = deriveWorldModel(state);
    const dayThirty = deriveWorldModel(
      validateGardenState({
        ...state,
        journeyDay: 30,
        highestMilestone: 15,
        microGrowthOrdinal: 38,
        qualifyingSessionCount: 38,
        unlockedVariants: Array.from({ length: 15 }, (_, index) => {
          const milestone = String(index + 1).padStart(2, "0");
          return [`m${milestone}-a`, `m${milestone}-b`];
        }).flat(),
      }),
    );
    expect(dayThirty.trunkHeight).toBeGreaterThan(dayTwo.trunkHeight);
    expect(dayThirty.foliage.length).toBeGreaterThan(dayTwo.foliage.length);
  });

  it("reduces background cost before central-tree quality", () => {
    const low = qualityProfile("low");
    const balanced = qualityProfile("balanced");
    const high = qualityProfile("high");
    expect(low.backgroundVegetationCount).toBeLessThan(balanced.backgroundVegetationCount);
    expect(balanced.backgroundVegetationCount).toBeLessThan(high.backgroundVegetationCount);
    expect(low.shadowMapSize).toBeLessThan(high.shadowMapSize);
    expect(deriveWorldModel({ ...state, qualityHint: "low" }).trunkHeight).toBe(
      deriveWorldModel({ ...state, qualityHint: "high" }).trunkHeight,
    );
  });

  it("adds one authored world system at each of the fifteen exact milestones", () => {
    const expected = [
      "roots",
      "stones",
      "undergrowth",
      "stream",
      "pond",
      "ripples",
      "warm-light",
      "fireflies",
      "blossoms",
      "wind",
      "drifting-life",
      "clouds",
      "twilight-stars",
      "moon",
      "sanctuary",
    ];
    for (let milestone = 1; milestone <= 15; milestone += 1) {
      const unlockedVariants = Array.from({ length: milestone }, (_, index) => {
        const identifier = String(index + 1).padStart(2, "0");
        return [`m${identifier}-a`, `m${identifier}-b`];
      }).flat();
      const model = deriveWorldModel({
        ...state,
        journeyDay: milestone * 2,
        highestMilestone: milestone,
        unlockedVariants,
      });
      expect(model.features).toEqual(expected.slice(0, milestone));
      expect(new Set(model.details.map((detail) => detail.kind))).toEqual(
        new Set(expected.slice(0, milestone)),
      );
    }
  });

  it("changes an authored milestone detail without replacing the persistent tree", () => {
    const variantA = deriveWorldModel({ ...state, activeCustomization: { "1": "m01-a" } });
    const variantB = deriveWorldModel({ ...state, activeCustomization: { "1": "m01-b" } });

    expect(variantA.details).not.toEqual(variantB.details);
    expect(variantA.foliage).toEqual(variantB.foliage);
    expect(variantA.trunkHeight).toBe(variantB.trunkHeight);
  });

  it("keeps post-day-thirty growth bounded, permanent, and recognizable", () => {
    const mature = {
      ...state,
      journeyDay: 30,
      highestMilestone: 15,
      qualifyingSessionCount: 38,
      microGrowthOrdinal: 38,
      totalQualifyingSeconds: 15_200,
      unlockedVariants: Array.from({ length: 15 }, (_, index) => {
        const milestone = String(index + 1).padStart(2, "0");
        return [`m${milestone}-a`, `m${milestone}-b`];
      }).flat(),
    } satisfies GardenState;
    const before = deriveWorldModel(mature);
    const after = deriveWorldModel({
      ...mature,
      qualifyingSessionCount: 39,
      microGrowthOrdinal: 39,
      totalQualifyingSeconds: 15_440,
    });

    expect(after.trunkRadius).toBeGreaterThan(before.trunkRadius);
    expect(after.foliage[0]?.scale).toBeGreaterThan(before.foliage[0]?.scale ?? 0);
    expect(after.foliage[0]?.x).toBe(before.foliage[0]?.x);
    expect(after.foliage[0]?.z).toBe(before.foliage[0]?.z);
  });
});
