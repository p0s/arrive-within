import fixture from "../../Shared/fixtures/garden-state-day-2.json";
import { describe, expect, it } from "vitest";
import { gardenVisualSignature } from "../src/scene";
import { directionEvidence, resolveVisualModel } from "../src/visual-design";
import {
  shippingGardenVisualDirection,
  shippingGardenVisualSelection,
} from "../src/shipping-visual";
import { paperSanctuary } from "../src/visual-directions/paper-sanctuary";
import { twilightRefuge } from "../src/visual-directions/twilight-refuge";
import { verdantAtelier } from "../src/visual-directions/verdant-atelier";
import { deriveWorldModel } from "../src/world-model";
import { validateGardenState } from "../src/validation";

const directions = [verdantAtelier, paperSanctuary, twilightRefuge] as const;
const state = validateGardenState(fixture);

describe("selectable visual directions", () => {
  it("ships the owner-selected Twilight Refuge through one compile-time authority", () => {
    expect(shippingGardenVisualSelection).toEqual({
      state: "owner-selected",
      direction: "twilight-refuge",
    });
    expect(shippingGardenVisualDirection).toBe(twilightRefuge);
  });

  it("keeps Twilight's camera-aligned warm fill subordinate to its ambient light", () => {
    const [fillX, , fillZ] = twilightRefuge.lighting.fillPosition;
    const horizontalDistanceSquared = fillX ** 2 + fillZ ** 2;
    const centerFillContribution = twilightRefuge.lighting.fillIntensity / horizontalDistanceSquared;

    expect(twilightRefuge.lighting.fillIntensity).toBe(26);
    expect(centerFillContribution).toBeLessThanOrEqual(
      twilightRefuge.lighting.hemisphereIntensity * 0.36,
    );
  });

  it("resolves four materially distinct local atmosphere phases", () => {
    const models = (["dawn", "day", "dusk", "night"] as const).map((phase) =>
      resolveVisualModel(
        deriveWorldModel({ ...state, localDayPhase: phase }),
        twilightRefuge,
      ),
    );

    expect(new Set(models.map((model) => model.skyTopColor)).size).toBe(4);
    expect(new Set(models.map((model) => model.skyColor)).size).toBe(4);
    expect(models[1]?.sunIntensity).toBeGreaterThan(models[3]?.sunIntensity ?? Infinity);
    expect(models[3]?.starOpacity).toBeGreaterThan(models[2]?.starOpacity ?? Infinity);
    expect(models[1]?.starOpacity).toBe(0);
  });

  it("provides three distinct original production compositions", () => {
    expect(directions.map((direction) => direction.id)).toEqual([
      "verdant-atelier",
      "paper-sanctuary",
      "twilight-refuge",
    ]);
    expect(new Set(directions.map((direction) => direction.foliageForm)).size).toBe(3);
    expect(new Set(directions.map((direction) => resolveVisualModel(deriveWorldModel(state), direction).skyColor)).size).toBe(3);
  });

  it("keeps one GardenState and the same complete milestone matrix across every skin", () => {
    for (const direction of directions) {
      for (let milestone = 0; milestone <= 15; milestone += 1) {
        const model = deriveWorldModel({
          ...state,
          journeyDay: milestone * 2,
          highestMilestone: milestone,
          unlockedVariants: Array.from({ length: milestone }, (_, index) => {
            const id = String(index + 1).padStart(2, "0");
            return [`m${id}-a`, `m${id}-b`];
          }).flat(),
        });
        expect(model.features).toHaveLength(milestone);
        expect(resolveVisualModel(model, direction).foliageColors).toHaveLength(model.foliage.length);
      }
    }
  });

  it("publishes public-safe decision evidence without adding renderer authority", () => {
    for (const direction of directions) {
      expect(directionEvidence(direction)).toMatchObject({
        id: direction.id,
        bridgeAuthority: "unchanged-garden-state-v1",
        reducedMotionBehavior: "static-state-with-direct-update",
      });
    }
  });

  it("does not rebuild geometry for repeated or motion-preference-only snapshots", () => {
    expect(gardenVisualSignature(state)).toBe(gardenVisualSignature(structuredClone(state)));
    expect(gardenVisualSignature(state)).toBe(
      gardenVisualSignature({ ...state, reduceMotion: !state.reduceMotion }),
    );
    expect(gardenVisualSignature(state)).not.toBe(
      gardenVisualSignature({ ...state, microGrowthOrdinal: state.microGrowthOrdinal + 1 }),
    );
    expect(gardenVisualSignature(state)).not.toBe(
      gardenVisualSignature({ ...state, localDayPhase: "day" }),
    );
  });

  it("recreates the selected deterministic plan twenty times without state drift", () => {
    const expected = resolveVisualModel(deriveWorldModel(state), shippingGardenVisualDirection);
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const recreatedState = validateGardenState(structuredClone(state));
      expect(
        resolveVisualModel(
          deriveWorldModel(recreatedState),
          shippingGardenVisualDirection,
        ),
      ).toEqual(expected);
      expect(recreatedState).toEqual(state);
    }
  });
});
