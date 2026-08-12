import { makeDeterministicRandom } from "./seeded";
import type { GardenQualityHint, GardenState } from "./types";

export interface QualityProfile {
  pixelRatioLimit: number;
  backgroundVegetationCount: number;
  particleCount: number;
  shadowMapSize: number;
}

export interface FoliageCluster {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  color: string;
}

export interface GroundPlant {
  x: number;
  z: number;
  scale: number;
  color: string;
}

export type GardenFeature =
  | "roots"
  | "stones"
  | "undergrowth"
  | "stream"
  | "pond"
  | "ripples"
  | "warm-light"
  | "fireflies"
  | "blossoms"
  | "wind"
  | "drifting-life"
  | "clouds"
  | "twilight-stars"
  | "moon"
  | "sanctuary";

export interface GardenDetail {
  kind: GardenFeature;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  color: string;
}

export interface GardenWorldModel {
  trunkHeight: number;
  trunkRadius: number;
  foliage: FoliageCluster[];
  groundPlants: GroundPlant[];
  features: GardenFeature[];
  details: GardenDetail[];
  quality: QualityProfile;
  skyColor: string;
  groundColor: string;
  accentColor: string;
  sunColor: string;
  sunIntensity: number;
  windStrength: number;
}

const qualityProfiles: Record<GardenQualityHint, QualityProfile> = {
  low: {
    pixelRatioLimit: 1,
    backgroundVegetationCount: 12,
    particleCount: 0,
    shadowMapSize: 512,
  },
  balanced: {
    pixelRatioLimit: 1.5,
    backgroundVegetationCount: 28,
    particleCount: 8,
    shadowMapSize: 1_024,
  },
  high: {
    pixelRatioLimit: 2,
    backgroundVegetationCount: 48,
    particleCount: 18,
    shadowMapSize: 2_048,
  },
};

const palettes = [
  { sky: "#bfdac7", ground: "#587553", accent: "#dfb968", foliage: ["#4d7954", "#6d945f", "#91aa71"] },
  { sky: "#c5d8c0", ground: "#617050", accent: "#cfaa62", foliage: ["#4b7453", "#789461", "#9dad74"] },
  { sky: "#c7d4bd", ground: "#687154", accent: "#c79f5f", foliage: ["#476b50", "#71885b", "#a1a46e"] },
  { sky: "#c4d4c9", ground: "#546e59", accent: "#c69c69", foliage: ["#406a58", "#668b68", "#90a874"] },
  { sky: "#718093", ground: "#405247", accent: "#ddb777", foliage: ["#315348", "#496556", "#718066"] },
];

const milestoneFeatures: GardenFeature[] = [
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

export function qualityProfile(hint: GardenQualityHint): QualityProfile {
  return { ...qualityProfiles[hint] };
}

export function deriveWorldModel(state: GardenState): GardenWorldModel {
  const random = makeDeterministicRandom(state.gardenSeed, "persistent-tree-form-v1");
  const baseQuality = qualityProfile(state.qualityHint);
  const features = milestoneFeatures.slice(0, state.highestMilestone);
  const quality = {
    ...baseQuality,
    particleCount: features.includes("fireflies") ? baseQuality.particleCount : 0,
  };
  const palette = palettes[Math.min(4, Math.floor(state.highestMilestone / 3))] ?? palettes[0]!;
  const maturity = Math.min(1, state.journeyDay / 30);
  const durationGrowth = Math.atan(state.totalQualifyingSeconds / 36_000) / (Math.PI / 2);
  const sessionGrowth = Math.atan(state.microGrowthOrdinal / 80) / (Math.PI / 2);
  const firstGrowth = Math.min(1, state.microGrowthOrdinal);
  const trunkHeight = 0.52 + firstGrowth * 0.42 + maturity * 3.18 + durationGrowth * 0.08;
  const trunkRadius = 0.075 + firstGrowth * 0.035 + maturity * 0.22 + sessionGrowth * 0.035;
  const clusterCount = 1 + firstGrowth + state.highestMilestone + Math.min(28, Math.floor(Math.sqrt(state.microGrowthOrdinal) * 1.65));
  const canopyGrowth = 1 + sessionGrowth * 0.11 + durationGrowth * 0.04;
  const foliage: FoliageCluster[] = [];

  for (let index = 0; index < clusterCount; index += 1) {
    const t = clusterCount === 1 ? 0 : index / (clusterCount - 1);
    const angle = index * 2.399963 + random.signed(0.24);
    const radius = (0.3 + maturity * 1.22) * (0.45 + Math.sin(Math.PI * t) * 0.65);
    foliage.push({
      x: Math.cos(angle) * radius + random.signed(0.14),
      y: trunkHeight * (0.5 + t * 0.52) + random.signed(0.14),
      z: Math.sin(angle) * radius * 0.68 + random.signed(0.12),
      scale: (0.3 + maturity * 0.29 + random.range(0, 0.14)) * canopyGrowth,
      rotation: random.range(0, Math.PI * 2),
      color: palette.foliage[index % palette.foliage.length]!,
    });
  }

  const groundPlants: GroundPlant[] = [];
  const backgroundVegetationCount = Math.round(
    quality.backgroundVegetationCount * (0.08 + maturity * 0.92),
  );
  for (let index = 0; index < backgroundVegetationCount; index += 1) {
    const angle = random.range(0, Math.PI * 2);
    const radius = random.range(2.25, 5.2);
    groundPlants.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius * 0.7,
      scale: random.range(0.22, 0.64),
      color: palette.foliage[(index + 1) % palette.foliage.length]!,
    });
  }

  const details = deriveDetails(state, features, quality);
  const warm = features.includes("warm-light");
  const variantBCount = Object.values(state.activeCustomization).filter((id) => id.endsWith("-b")).length;

  return {
    trunkHeight,
    trunkRadius,
    foliage,
    groundPlants,
    features,
    details,
    quality,
    skyColor: palette.sky,
    groundColor: palette.ground,
    accentColor: variantBCount % 2 === 1 ? "#d6a66e" : palette.accent,
    sunColor: warm ? "#ffd59a" : "#ffe6ad",
    sunIntensity: warm ? 3.8 : 3.4,
    windStrength: features.includes("wind") ? 0.022 : 0.006,
  };
}

function deriveDetails(
  state: GardenState,
  features: GardenFeature[],
  quality: QualityProfile,
): GardenDetail[] {
  const details: GardenDetail[] = [];
  const density = state.qualityHint === "low" ? 0.55 : state.qualityHint === "high" ? 1 : 0.78;

  const addRadial = (
    kind: GardenFeature,
    count: number,
    minimumRadius: number,
    maximumRadius: number,
    color: string,
    minimumScale: number,
    maximumScale: number,
    y = 0.08,
  ): void => {
    if (!features.includes(kind)) return;
    const milestone = milestoneFeatures.indexOf(kind) + 1;
    const selectedVariant = state.activeCustomization[String(milestone)] ?? `m${String(milestone).padStart(2, "0")}-a`;
    const random = makeDeterministicRandom(state.gardenSeed, `${kind}-${selectedVariant}`);
    const resolvedCount = Math.max(1, Math.round(count * density));
    for (let index = 0; index < resolvedCount; index += 1) {
      const angle = random.range(0, Math.PI * 2);
      const radius = random.range(minimumRadius, maximumRadius);
      details.push({
        kind,
        x: Math.cos(angle) * radius,
        y,
        z: Math.sin(angle) * radius * 0.72,
        scale: random.range(minimumScale, maximumScale),
        rotation: angle + random.signed(0.28),
        color,
      });
    }
  };

  addRadial("roots", 7, 0.65, 2.15, "#79583e", 0.78, 1.3, 0.04);
  addRadial("stones", 10, 2.1, 4.8, "#8f9384", 0.32, 0.68, 0.12);
  addRadial("undergrowth", 20, 1.55, 5.1, "#5d8158", 0.32, 0.9, 0.14);
  addRadial("stream", 1, 2.7, 2.7, "#75a9a2", 1, 1, 0.035);
  addRadial("pond", 1, 3.8, 3.8, "#6e9e9b", 1.15, 1.15, 0.028);
  addRadial("ripples", 4, 3.55, 4.05, "#b7d4c8", 0.45, 0.92, 0.045);
  addRadial("warm-light", 3, 2.4, 4.4, "#f3bd71", 0.75, 1.25, 1.2);
  addRadial("fireflies", quality.particleCount, 1.2, 4.7, "#f3d47a", 0.035, 0.07, 1.1);
  addRadial("blossoms", 16, 0.55, 2.05, "#e3a778", 0.08, 0.17, 2.7);
  addRadial("wind", 4, 2.4, 5.2, "#d6e2cf", 0.6, 1.15, 1.6);
  addRadial("drifting-life", 9, 2.1, 5.1, "#c9b86f", 0.08, 0.24, 2.5);
  addRadial("clouds", 7, 5.2, 7.4, "#d8e1d7", 0.65, 1.25, 5.6);
  addRadial("twilight-stars", 22, 5.8, 9.2, "#f2e8c4", 0.025, 0.065, 6.1);
  addRadial("moon", 1, 7.2, 7.2, "#efe2bd", 0.62, 0.62, 6.8);
  addRadial("sanctuary", 12, 2.3, 5.4, "#d2b479", 0.16, 0.42, 0.18);
  return details;
}
