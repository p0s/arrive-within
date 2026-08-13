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
    birdCount: 2,
    groundAnimalCount: 2,
    shadowMapSize: 1_024,
  },
  high: {
    pixelRatioLimit: 2,
    backgroundVegetationCount: 48,
    particleCount: 18,
    birdCount: 3,
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

  const crownAnchors = [
    { x: 0, y: 1, z: 0.08, scale: 0.92 },
    { x: -0.68, y: 0.86, z: 0.1, scale: 1.05 },
    { x: 0.7, y: 0.84, z: -0.08, scale: 0.98 },
    { x: -0.98, y: 0.64, z: 0.18, scale: 1.02 },
    { x: 0.98, y: 0.61, z: 0.2, scale: 1.04 },
    { x: -0.42, y: 0.54, z: -0.42, scale: 0.92 },
    { x: 0.44, y: 0.5, z: -0.46, scale: 0.9 },
    { x: -1.17, y: 0.38, z: -0.12, scale: 0.84 },
    { x: 1.15, y: 0.36, z: -0.16, scale: 0.86 },
    { x: 0.02, y: 0.69, z: 0.44, scale: 0.94 },
  ] as const;
  const crownWidth = 0.3 + maturity * 1.34;
  const clusterJitter = 0.035 + maturity * 0.11;

  for (let index = 0; index < clusterCount; index += 1) {
    const anchor = crownAnchors[index % crownAnchors.length]!;
    const layer = Math.floor(index / crownAnchors.length);
    foliage.push({
      x: anchor.x * crownWidth + random.signed(clusterJitter * (1 + layer * 0.12)),
      y: trunkHeight * (0.48 + anchor.y * 0.52) + random.signed(clusterJitter * 0.7),
      z: anchor.z * crownWidth + random.signed(clusterJitter * 0.72),
      scale: (0.27 + maturity * 0.31 + random.range(0.015, 0.11)) * canopyGrowth * anchor.scale,
      rotation: random.range(0, Math.PI * 2),
      color: palette.foliage[index % palette.foliage.length]!,
    });
  }

  const groundPlants: GroundPlant[] = [];
  const backgroundVegetationCount = Math.round(
    quality.backgroundVegetationCount * (0.08 + maturity * 0.92),
  );
  const plantedEdgeAnchors = [
    { x: -4.7, z: 0.55 },
    { x: -3.8, z: 2.35 },
    { x: -2.15, z: 3.15 },
    { x: 0.15, z: 3.45 },
    { x: 2.55, z: 3.05 },
    { x: 4.15, z: 2.05 },
    { x: 4.85, z: 0.15 },
    { x: 4.05, z: -2.45 },
    { x: 1.45, z: -3.25 },
    { x: -1.3, z: -3.15 },
  ] as const;
  for (let index = 0; index < backgroundVegetationCount; index += 1) {
    const anchor = plantedEdgeAnchors[index % plantedEdgeAnchors.length]!;
    groundPlants.push({
      x: anchor.x + random.signed(0.58),
      z: anchor.z + random.signed(0.44),
      scale: random.range(0.18, 0.52),
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

  const addAuthored = (
    kind: GardenFeature,
    placements: ReadonlyArray<{
      x: number;
      z: number;
      scale: number;
      rotation?: number;
      y?: number;
    }>,
    color: string,
  ): void => {
    if (!features.includes(kind) || placements.length === 0) return;
    const milestone = milestoneFeatures.indexOf(kind) + 1;
    const selectedVariant = state.activeCustomization[String(milestone)] ?? `m${String(milestone).padStart(2, "0")}-a`;
    const random = makeDeterministicRandom(state.gardenSeed, `authored-${kind}-${selectedVariant}`);
    const resolvedCount = placements.length === 1
      ? 1
      : Math.max(1, Math.round(placements.length * density));
    for (let index = 0; index < resolvedCount; index += 1) {
      const sourceIndex = resolvedCount === 1
        ? Math.floor((placements.length - 1) / 2)
        : Math.round(index * (placements.length - 1) / (resolvedCount - 1));
      const placement = placements[sourceIndex]!;
      details.push({
        kind,
        x: placement.x + random.signed(0.07),
        y: placement.y ?? 0.08,
        z: placement.z + random.signed(0.055),
        scale: placement.scale * random.range(0.94, 1.06),
        rotation: (placement.rotation ?? 0) + random.signed(0.08),
        color,
      });
    }
  };

  addRadial("roots", 7, 0.65, 2.15, "#79583e", 0.78, 1.3, 0.04);
  addAuthored("stones", [
    { x: 4.65, z: 1.9, scale: 0.66, rotation: -0.16 },
    { x: 3.65, z: 1.52, scale: 0.52, rotation: 0.16 },
    { x: 2.7, z: 1.14, scale: 0.58, rotation: -0.08 },
    { x: 1.78, z: 0.65, scale: 0.46, rotation: 0.22 },
    { x: 0.92, z: 0.05, scale: 0.48, rotation: -0.18 },
    { x: -0.18, z: -0.54, scale: 0.42, rotation: 0.1 },
    { x: -1.35, z: -0.93, scale: 0.52, rotation: -0.08 },
    { x: -2.5, z: -1.28, scale: 0.57, rotation: 0.16 },
    { x: -3.55, z: -1.55, scale: 0.48, rotation: -0.12 },
  ], "#999b91");
  addAuthored("undergrowth", [
    { x: -4.65, z: 0.5, scale: 0.62 },
    { x: -3.9, z: 2.25, scale: 0.78 },
    { x: -2.45, z: 2.92, scale: 0.54 },
    { x: -0.65, z: 3.3, scale: 0.68 },
    { x: 1.25, z: 3.24, scale: 0.46 },
    { x: 2.85, z: 2.88, scale: 0.72 },
    { x: 4.18, z: 2.08, scale: 0.58 },
    { x: 4.78, z: 0.4, scale: 0.74 },
    { x: 4.02, z: -2.42, scale: 0.52 },
    { x: 1.5, z: -3.08, scale: 0.66 },
    { x: -1.1, z: -3.02, scale: 0.48 },
  ], "#5d8158");
  addAuthored("stream", [{ x: 0, z: 0, scale: 1, y: 0.035 }], "#75a9a2");
  addAuthored("pond", [{ x: 3.58, z: -1.52, scale: 1.08, y: 0.028 }], "#6e9e9b");
  addAuthored("ripples", [
    { x: 3.32, z: -1.63, scale: 0.64, y: 0.045 },
    { x: 3.79, z: -1.42, scale: 0.42, y: 0.045 },
    { x: 3.62, z: -1.73, scale: 0.86, y: 0.044 },
  ], "#b7d4c8");
  addAuthored("warm-light", [
    { x: -3.25, z: -1.48, scale: 0.82 },
    { x: 0.86, z: -0.5, scale: 0.7 },
    { x: 2.7, z: -1.08, scale: 0.9 },
  ], "#f3bd71");
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
  addAuthored("wind", [
    { x: -4.1, z: -1.6, scale: 0.88, rotation: 0.08, y: 2.25 },
    { x: -1.1, z: -2.9, scale: 0.72, rotation: -0.12, y: 3.1 },
    { x: 3.95, z: -1.75, scale: 0.82, rotation: 0.18, y: 2.65 },
  ], "#d6e2cf");
  addRadial("drifting-life", 5, 2.1, 5.1, "#91895f", 0.08, 0.19, 2.5);
  if (features.includes("clouds")) {
    const selectedVariant = state.activeCustomization["12"] ?? "m12-a";
    const random = makeDeterministicRandom(state.gardenSeed, `air-iii-cloud-banks-${selectedVariant}`);
    const resolvedCount = Math.max(2, Math.round(4 * density));
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
      x: selectedVariant.endsWith("-b") ? -3.35 : -3.62,
      y: 0.02,
      z: selectedVariant.endsWith("-b") ? -2.08 : -1.82,
      scale: selectedVariant.endsWith("-b") ? 0.88 : 0.92,
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
      { x: 2.06, z: -0.58, rotation: -1.02, pose: "seated" as const },
      { x: -1.52, z: 1.18, rotation: 1.22, pose: "grazing" as const },
    ];
    for (const position of positions.slice(0, quality.groundAnimalCount)) {
      groundAnimals.push({
        kind: "hare",
        pose: position.pose,
        x: position.x + random.signed(0.16),
        z: position.z + random.signed(0.14),
        scale: random.range(0.43, 0.53),
        rotation: position.rotation + random.signed(0.1),
        color: random.next() > 0.5 ? "#77736a" : "#666b64",
      });
    }
  }
  return { birds, groundAnimals };
}
