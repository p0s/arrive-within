import type { GardenVisualDirection } from "./visual-design";
import { claymation } from "./visual-directions/claymation";
import { crochet } from "./visual-directions/crochet";
import { handDrawn } from "./visual-directions/hand-drawn";
import { stopMotion } from "./visual-directions/stop-motion";
import { twilightRefuge } from "./visual-directions/twilight-refuge";

export type GardenRenderStyleID = "twilight" | "hand-drawn" | "stop-motion" | "crochet" | "claymation";

export const gardenRenderStyles: Readonly<Record<GardenRenderStyleID, GardenVisualDirection>> = {
  twilight: twilightRefuge,
  "hand-drawn": handDrawn,
  "stop-motion": stopMotion,
  crochet,
  claymation,
};

export function resolveGardenRenderStyle(id: string): GardenVisualDirection {
  return isGardenRenderStyleID(id) ? gardenRenderStyles[id] : twilightRefuge;
}

export function isGardenRenderStyleID(value: string): value is GardenRenderStyleID {
  return Object.hasOwn(gardenRenderStyles, value);
}
