import type { GardenVisualDirection } from "../visual-design";

export const crochet: GardenVisualDirection = {
  id: "crochet",
  name: "Crochet",
  meaning: "A soft-sculpture Garden shaped from calm yarn loops and muted natural fibres.",
  foliageForm: "twilight-silhouette",
  palette: {
    skyTint: "#7d879b", groundTint: "#586753", foliageTint: "#687b61",
    accentTint: "#d39b69", detailTint: "#766f67", influence: 0.54,
    skyInfluence: 0.56, groundInfluence: 0.5, foliageInfluence: 0.48,
    accentInfluence: 0.62, trunk: "#665247",
  },
  lighting: {
    hemisphereSky: "#c6ccce", hemisphereGround: "#49564b", hemisphereIntensity: 2,
    sunTint: "#ecc393", sunIntensityScale: 0.84, exposure: 1.04, fogNear: 13.5,
    fogFar: 32, fillColor: "#dca36f", fillIntensity: 19, fillPosition: [3.5, 2.8, 5.2],
  },
  composition: {
    cameraDistanceScale: 1.16, cameraHeightOffset: 0.22, targetHeightOffset: 0.2,
    groundLayers: 2, canopyScale: [0.96, 1.12, 0.74], particleSize: 0.06,
    particleOpacity: 0.52, waterOpacity: 0.7,
  },
  motion: { canopyAmplitude: 0.4, particleSpeed: 0.52 },
  material: { treatment: "crochet-yarn", roughness: 1, flatShading: false, textureScale: 3.2 },
  detailOverrides: { stream: "#64868a", pond: "#5b7d83", blossoms: "#c77f78", clouds: "#d5d1cb" },
};
