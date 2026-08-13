import type { GardenVisualDirection } from "../visual-design";

export const claymation: GardenVisualDirection = {
  id: "claymation",
  name: "Claymation",
  meaning: "A gently moulded clay Garden with soft fingerprints and rounded studio light.",
  foliageForm: "twilight-silhouette",
  palette: {
    skyTint: "#778797", groundTint: "#596454", foliageTint: "#65755d",
    accentTint: "#cf8b5c", detailTint: "#746b62", influence: 0.5,
    skyInfluence: 0.56, groundInfluence: 0.48, foliageInfluence: 0.44,
    accentInfluence: 0.66, trunk: "#655044",
  },
  lighting: {
    hemisphereSky: "#bac7cb", hemisphereGround: "#485348", hemisphereIntensity: 1.96,
    sunTint: "#efbd86", sunIntensityScale: 0.88, exposure: 1.06, fogNear: 13.5,
    fogFar: 32, fillColor: "#e09d68", fillIntensity: 20, fillPosition: [3.5, 2.8, 5.2],
  },
  composition: {
    cameraDistanceScale: 1.16, cameraHeightOffset: 0.22, targetHeightOffset: 0.2,
    groundLayers: 2, canopyScale: [0.96, 1.12, 0.74], particleSize: 0.056,
    particleOpacity: 0.54, waterOpacity: 0.76,
  },
  motion: { canopyAmplitude: 0.46, particleSpeed: 0.58 },
  material: { treatment: "clay", roughness: 0.82, flatShading: false, textureScale: 1.5 },
  detailOverrides: { stream: "#5e8486", pond: "#55797d", "warm-light": "#dfa067", blossoms: "#bd776a" },
};
