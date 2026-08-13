import { makeDeterministicRandom } from "./seeded";
import type { GardenDayPhase, GardenQualityHint, GardenState } from "./types";

export interface QualityProfile {
  pixelRatioLimit: number;
  backgroundVegetationCount: number;
  particleCount: number;
  birdCount: number;
  groundAnimalCount: number;
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

export interface GardenBird {
  pathRadius: number;
  pathDepth: number;
  height: number;
  phase: number;
  speed: number;
  scale: number;
  color: string;
}

export interface GardenGroundAnimal {
  kind: "hare";
  pose: "seated" | "grazing";
  x: number;
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
  birds: GardenBird[];
  groundAnimals: GardenGroundAnimal[];
  quality: QualityProfile;
  dayPhase: GardenDayPhase;
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
    birdCount: 1,
    groundAnimalCount: 1,
    shadowMapSize: 512,
  },
  balanced: {
    pixelRatioLimit: 1.5,
    backgroundVegetationCount: 28,
    particleCount: 8,
    birdCount: 3,
    groundAnimalCount: 2,
    shadowMapSize: 1_024,
  },
  high: {
    pixelRatioLimit: 2,
    backgroundVegetationCount: 48,
    particleCount: 18,
    birdCount: 5,
    groundAnimalCount: 2,
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

  const details = deriveDetails(state, features, quality, foliage);
  const { birds, groundAnimals } = deriveWildlife(state, features, quality);
  const warm = features.includes("warm-light");
  const variantBCount = Object.values(state.activeCustomization).filter((id) => id.endsWith("-b")).length;

  return {
    trunkHeight,
    trunkRadius,
    foliage,
    groundPlants,
    features,
    details,
    birds,
    groundAnimals,
    quality,
    dayPhase: state.localDayPhase ?? "day",
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
  foliage: FoliageCluster[],
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
  if (features.includes("blossoms")) {
    const selectedVariant = state.activeCustomization["9"] ?? "m09-a";
    const random = makeDeterministicRandom(state.gardenSeed, `canopy-blossoms-${selectedVariant}`);
    const resolvedCount = Math.max(1, Math.round(18 * density));
    for (let index = 0; index < resolvedCount; index += 1) {
      const cluster = foliage[(index * 7) % foliage.length];
      if (cluster === undefined) continue;
      details.push({
        kind: "blossoms",
        x: cluster.x + random.signed(cluster.scale * 0.42),
        y: cluster.y + random.signed(cluster.scale * 0.34),
        z: cluster.z + random.signed(cluster.scale * 0.35),
        scale: random.range(0.035, 0.072),
        rotation: random.range(0, Math.PI * 2),
        color: selectedVariant.endsWith("-b") ? "#d5a383" : "#c98576",
      });
    }
  }
  addRadial("wind", 4, 2.4, 5.2, "#d6e2cf", 0.6, 1.15, 1.6);
  addRadial("drifting-life", 5, 2.1, 5.1, "#91895f", 0.08, 0.19, 2.5);
  if (features.includes("clouds")) {
    const selectedVariant = state.activeCustomization["12"] ?? "m12-a";
    const random = makeDeterministicRandom(state.gardenSeed, `air-iii-cloud-banks-${selectedVariant}`);
    const resolvedCount = Math.max(2, Math.round(5 * density));
    for (let index = 0; index < resolvedCount; index += 1) {
      const horizontal = random.range(-6.2, 6.2);
      details.push({
        kind: "clouds",
        x: -4.7 + horizontal * 0.83 + random.signed(0.3),
        y: random.range(4.8, 6.6),
        z: -7.4 - horizontal * 0.55 + random.signed(0.28),
        scale: random.range(0.56, 0.88),
        rotation: random.range(-0.28, 0.28),
        color: selectedVariant.endsWith("-b") ? "#c8d2d0" : "#d8e1d7",
      });
    }
  }
  if (features.includes("twilight-stars")) {
    const selectedVariant = state.activeCustomization["13"] ?? "m13-a";
    const random = makeDeterministicRandom(state.gardenSeed, `space-i-stars-${selectedVariant}`);
    const resolvedCount = Math.max(1, Math.round(48 * density));
    for (let index = 0; index < resolvedCount; index += 1) {
      const horizontal = random.range(-7.4, 7.4);
      details.push({
        kind: "twilight-stars",
        x: -5.4 + horizontal * 0.83 + random.signed(0.45),
        y: random.range(4.4, 9.6),
        z: -8.3 - horizontal * 0.55 + random.signed(0.4),
        scale: random.range(0.01, 0.026),
        rotation: random.range(0, Math.PI * 2),
        color: selectedVariant.endsWith("-b") && index % 5 === 0 ? "#d8d7c7" : "#f2e8c4",
      });
    }
  }
  if (features.includes("moon")) {
    const selectedVariant = state.activeCustomization["14"] ?? "m14-a";
    details.push({
      kind: "moon",
      x: selectedVariant.endsWith("-b") ? 6.1 : -5.8,
      y: 7.35,
      z: -5.4,
      scale: selectedVariant.endsWith("-b") ? 0.46 : 0.52,
      rotation: selectedVariant.endsWith("-b") ? 0.24 : -0.2,
      color: "#efe2bd",
    });
  }
  if (features.includes("sanctuary")) {
    const selectedVariant = state.activeCustomization["15"] ?? "m15-a";
    details.push({
      kind: "sanctuary",
      x: selectedVariant.endsWith("-b") ? -3.55 : -3.95,
      y: 0.02,
      z: selectedVariant.endsWith("-b") ? -2.15 : -1.7,
      scale: selectedVariant.endsWith("-b") ? 0.94 : 1,
      rotation: selectedVariant.endsWith("-b") ? -0.08 : 0.1,
      color: "#9a7252",
    });
  }
  return details;
}

function deriveWildlife(
  state: GardenState,
  features: GardenFeature[],
  quality: QualityProfile,
): { birds: GardenBird[]; groundAnimals: GardenGroundAnimal[] } {
  const birds: GardenBird[] = [];
  if (features.includes("drifting-life")) {
    const random = makeDeterministicRandom(state.gardenSeed, "air-ii-bird-flock-v1");
    for (let index = 0; index < quality.birdCount; index += 1) {
      birds.push({
        pathRadius: random.range(3.3, 5.1),
        pathDepth: random.range(1.9, 3.3),
        height: random.range(3.25, 5.1),
        phase: random.range(0, Math.PI * 2),
        speed: random.range(0.74, 1.08),
        scale: random.range(0.16, 0.23),
        color: index % 2 === 0 ? "#283e43" : "#50625f",
      });
    }
  }

  const groundAnimals: GardenGroundAnimal[] = [];
  if (features.includes("sanctuary")) {
    const random = makeDeterministicRandom(state.gardenSeed, "space-iii-grass-hares-v1");
    const positions = [
      { x: 1.82, z: -0.84, rotation: -1.08, pose: "seated" as const },
      { x: -1.62, z: 0.9, rotation: 1.14, pose: "grazing" as const },
    ];
    for (const position of positions.slice(0, quality.groundAnimalCount)) {
      groundAnimals.push({
        kind: "hare",
        pose: position.pose,
        x: position.x + random.signed(0.16),
        z: position.z + random.signed(0.14),
        scale: random.range(0.48, 0.6),
        rotation: position.rotation + random.signed(0.1),
        color: random.next() > 0.5 ? "#77736a" : "#666b64",
      });
    }
  }
  return { birds, groundAnimals };
}
