import type { GardenVisualDirection } from "../visual-design";

export const handDrawn: GardenVisualDirection = {
  id: "hand-drawn",
  name: "Hand-drawn",
  meaning: "Soft ink, paper grain, and imperfect contour marks drawn over the same living Garden.",
  foliageForm: "twilight-silhouette",
  palette: {
    skyTint: "#9aa8a2", groundTint: "#6f7460", foliageTint: "#647760",
    accentTint: "#bd8258", detailTint: "#807b67", influence: 0.58,
    skyInfluence: 0.62, groundInfluence: 0.52, foliageInfluence: 0.46,
    accentInfluence: 0.58, trunk: "#675344",
  },
  lighting: {
    hemisphereSky: "#e3dfd0", hemisphereGround: "#5f6254", hemisphereIntensity: 1.95,
    sunTint: "#e7bd83", sunIntensityScale: 0.82, exposure: 1.03, fogNear: 14,
    fogFar: 33, fillColor: "#d79a68", fillIntensity: 16, fillPosition: [3.5, 2.8, 5.2],
  },
  composition: {
    cameraDistanceScale: 1.16, cameraHeightOffset: 0.22, targetHeightOffset: 0.2,
    groundLayers: 2, canopyScale: [0.96, 1.12, 0.74], particleSize: 0.052,
    particleOpacity: 0.48, waterOpacity: 0.7,
  },
  motion: { canopyAmplitude: 0.48, particleSpeed: 0.62 },
  material: {
    treatment: "inked-paper", roughness: 1, flatShading: true, textureScale: 2.4,
    outlineColor: "#3f423b", outlineScale: 1.025,
  },
  detailOverrides: { stream: "#718d8d", pond: "#6a8585", blossoms: "#b77868", clouds: "#d2cfc2" },
};
