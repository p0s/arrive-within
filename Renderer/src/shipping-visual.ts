import type { GardenVisualDirection } from "./visual-design";
import { twilightRefuge } from "./visual-directions/twilight-refuge";

/**
 * The free default and only authoritative Garden composition.
 *
 * Premium material profiles may recolor and texture this composition at runtime.
 * The older A and B composition experiments remain unreachable design-lab source.
 */
export const shippingGardenVisualDirection: GardenVisualDirection = twilightRefuge;

export const shippingGardenVisualSelection = {
  state: "owner-selected",
  direction: "twilight-refuge",
} as const;
