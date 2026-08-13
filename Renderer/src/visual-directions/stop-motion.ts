import { createGardenStyleProfile, type GardenVisualDirection } from "../visual-design";

export const stopMotion: GardenVisualDirection = {
  id: "stop-motion",
  name: "Stop-motion",
  meaning: "A warmly lit handmade miniature whose quiet movement advances in deliberate frames.",
  foliageForm: "twilight-silhouette",
  palette: {
    skyTint: "#71818d", groundTint: "#55634c", foliageTint: "#617453",
    accentTint: "#d29457", detailTint: "#776d59", influence: 0.48,
    skyInfluence: 0.55, groundInfluence: 0.44, foliageInfluence: 0.4,
    accentInfluence: 0.62, trunk: "#5d4939",
  },
  lighting: {
    hemisphereSky: "#b9c5c6", hemisphereGround: "#475044", hemisphereIntensity: 1.88,
    sunTint: "#efbf7d", sunIntensityScale: 0.86, exposure: 1.05, fogNear: 13.5,
    fogFar: 31, fillColor: "#e2a05e", fillIntensity: 22, fillPosition: [3.5, 2.8, 5.2],
  },
  composition: {
    cameraDistanceScale: 1.16, cameraHeightOffset: 0.22, targetHeightOffset: 0.2,
    groundLayers: 2, canopyScale: [0.96, 1.12, 0.74], particleSize: 0.058,
    particleOpacity: 0.58, waterOpacity: 0.74,
  },
  motion: { canopyAmplitude: 0.5, particleSpeed: 0.64, framesPerSecond: 8 },
  material: {
    treatment: "miniature-stop-motion", roughness: 0.92, flatShading: true, textureScale: 1.7,
  },
  styleProfile: createGardenStyleProfile({
    surfacePattern: "miniature-paper-set",
    edgeMode: "faceted-edge",
    shadingBands: 2,
    geometryTreatment: "faceted-miniature",
    detailDensity: 0.9,
    motionCadence: { framesPerSecond: 8, propJitter: 0.012, inkWobble: 0, squashStretch: 0 },
    skyAccents: { horizonTint: "#b1b8b2", celestialTint: "#d9a066", strength: 0.42 },
    waterAccents: { tint: "#4d747a", opacity: 0.9, rippleScale: 0.94 },
    seeds: { texture: 0x72f19, motion: 0x2f6a1, geometry: 0x4c29d },
    materialRoles: {
      canopy: { roughness: 0.96, flatShading: true, textureScale: 1.55, textureOpacity: 0.78 },
      trunk: { roughness: 0.96, flatShading: true, textureScale: 1.4, textureOpacity: 0.76 },
      ground: { roughness: 0.98, flatShading: true, textureScale: 1.8, textureOpacity: 0.74 },
      grass: { roughness: 0.98, flatShading: true, textureScale: 1.8, textureOpacity: 0.66 },
      water: { roughness: 0.62, flatShading: true, textureScale: 1.3, textureOpacity: 0.48 },
      pavilion: { roughness: 0.94, flatShading: true, textureScale: 1.45, textureOpacity: 0.76 },
      path: { roughness: 0.98, flatShading: true, textureScale: 1.8, textureOpacity: 0.74 },
      rock: { roughness: 0.98, flatShading: true, textureScale: 1.35, textureOpacity: 0.72 },
      wildlife: { roughness: 0.94, flatShading: true, textureScale: 1.5, textureOpacity: 0.72 },
      celestial: { roughness: 1, flatShading: true, textureScale: 1, textureOpacity: 0 },
    },
  }),
  detailOverrides: { stream: "#557f81", pond: "#4d7478", "warm-light": "#e0a45f", blossoms: "#b87362" },
};
