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
    expect(low.birdCount).toBeLessThan(balanced.birdCount);
    expect(balanced.birdCount).toBeLessThan(high.birdCount);
    expect(low.groundAnimalCount).toBeLessThan(balanced.groundAnimalCount);
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

  it("keeps Fire II variants visibly authored as low and high fireflies", () => {
    const fireState = {
      ...state,
      journeyDay: 16,
      highestMilestone: 8,
      qualityHint: "high" as const,
    };
    const low = deriveWorldModel({ ...fireState, activeCustomization: { "8": "m08-a" } });
    const high = deriveWorldModel({ ...fireState, activeCustomization: { "8": "m08-b" } });
    const averageHeight = (model: ReturnType<typeof deriveWorldModel>) => {
      const fireflies = model.details.filter((detail) => detail.kind === "fireflies");
      return fireflies.reduce((sum, detail) => sum + detail.y, 0) / fireflies.length;
    };

    expect(averageHeight(high)).toBeGreaterThan(averageHeight(low) + 0.8);
    expect(low.foliage).toEqual(high.foliage);
    expect(low.trunkHeight).toBe(high.trunkHeight);
  });

  it("treats birds, pavilion, and grass hares as milestone ecology", () => {
    const beforeAirTwo = deriveWorldModel({
      ...state,
      journeyDay: 20,
      highestMilestone: 10,
      qualityHint: "balanced",
    });
    const airTwo = deriveWorldModel({
      ...state,
      journeyDay: 22,
      highestMilestone: 11,
      qualityHint: "balanced",
    });
    const beforeSpaceThree = deriveWorldModel({
      ...state,
      journeyDay: 28,
      highestMilestone: 14,
      qualityHint: "balanced",
    });
    const completeWorld = deriveWorldModel({
      ...state,
      journeyDay: 30,
      highestMilestone: 15,
      qualityHint: "balanced",
    });

    expect(beforeAirTwo.birds).toHaveLength(0);
    expect(airTwo.birds).toHaveLength(2);
    expect(beforeSpaceThree.groundAnimals).toHaveLength(0);
    expect(beforeSpaceThree.details.some((detail) => detail.kind === "sanctuary")).toBe(false);
    expect(completeWorld.groundAnimals.map((animal) => animal.kind)).toEqual(["hare", "hare"]);
    expect(completeWorld.details.filter((detail) => detail.kind === "sanctuary")).toHaveLength(1);
  });

  it("composes one connected water garden instead of unrelated radial symbols", () => {
    const mature = deriveWorldModel({
      ...state,
      journeyDay: 30,
      highestMilestone: 15,
      qualityHint: "high",
    });
    const pond = mature.details.find((detail) => detail.kind === "pond");
    const ripples = mature.details.filter((detail) => detail.kind === "ripples");
    const stones = mature.details.filter((detail) => detail.kind === "stones");

    expect(pond).toBeDefined();
    expect(ripples.length).toBeGreaterThanOrEqual(2);
    expect(ripples.every((ripple) =>
      Math.hypot(ripple.x - (pond?.x ?? 0), ripple.z - (pond?.z ?? 0)) < 0.85
    )).toBe(true);
    expect(stones[0]?.x).toBeGreaterThan(stones.at(-1)?.x ?? Infinity);
    expect(stones.some((stone) => Math.hypot(stone.x, stone.z) < 1.4)).toBe(true);
  });

  it("keeps local time presentational rather than changing permanent growth", () => {
    const day = deriveWorldModel({ ...state, localDayPhase: "day" });
    const night = deriveWorldModel({ ...state, localDayPhase: "night" });

    expect(day.dayPhase).toBe("day");
    expect(night.dayPhase).toBe("night");
    expect(day.trunkHeight).toBe(night.trunkHeight);
    expect(day.foliage).toEqual(night.foliage);
    expect(day.details).toEqual(night.details);
    expect(day.birds).toEqual(night.birds);
    expect(day.groundAnimals).toEqual(night.groundAnimals);
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
