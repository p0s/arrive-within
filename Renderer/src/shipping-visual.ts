import type { GardenVisualDirection } from "./visual-design";
import { twilightRefuge } from "./visual-directions/twilight-refuge";

/**
 * The only visual composition reachable from the shipping renderer entry.
 *
 * A and B remain available as public design-lab references, but are unreachable
 * from this entry and therefore cannot enter the selected release bundle.
 */
export const shippingGardenVisualDirection: GardenVisualDirection = twilightRefuge;

export const shippingGardenVisualSelection = {
  state: "owner-selected",
  direction: "twilight-refuge",
} as const;
