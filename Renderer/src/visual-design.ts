import type { GardenDayPhase } from "./types";
import type { GardenFeature, GardenWorldModel } from "./world-model";

export type GardenVisualDirectionID =
  | "verdant-atelier"
  | "paper-sanctuary"
  | "twilight-refuge"
  | "hand-drawn"
  | "stop-motion"
  | "crochet"
  | "claymation";

export type GardenMaterialTreatment =
  | "natural"
  | "inked-paper"
  | "miniature-stop-motion"
  | "crochet-yarn"
  | "clay";

export type GardenMaterialRole =
  | "canopy"
  | "trunk"
  | "ground"
  | "grass"
  | "water"
  | "pavilion"
  | "path"
  | "rock"
  | "wildlife"
  | "celestial";

export type GardenSurfacePattern =
  | "natural-grain"
  | "paper-hatch"
  | "miniature-paper-set"
  | "braided-yarn"
  | "fingerprint-clay";

export type GardenEdgeMode = "none" | "ink-outline" | "faceted-edge";

export type GardenGeometryTreatment =
  | "organic"
  | "cel-stepped"
  | "faceted-miniature"
  | "rounded-inflated"
  | "moulded-clay";

export interface GardenMaterialRoleProfile {
  roughness: number;
  flatShading: boolean;
  textureScale: number;
  textureOpacity: number;
}

export interface GardenStyleProfile {
  surfacePattern: GardenSurfacePattern;
  edgeMode: GardenEdgeMode;
  shadingBands: number;
  geometryTreatment: GardenGeometryTreatment;
  detailDensity: number;
  motionCadence: {
    framesPerSecond: number;
    propJitter: number;
    inkWobble: number;
    squashStretch: number;
  };
  skyAccents: {
    horizonTint: string;
    celestialTint: string;
    strength: number;
  };
  waterAccents: {
    tint: string;
    opacity: number;
    rippleScale: number;
  };
  seeds: {
    texture: number;
    motion: number;
    geometry: number;
  };
  materialRoles: Record<GardenMaterialRole, GardenMaterialRoleProfile>;
}

export interface GardenStyleProfileOptions {
  surfacePattern: GardenSurfacePattern;
  edgeMode: GardenEdgeMode;
  shadingBands: number;
  geometryTreatment: GardenGeometryTreatment;
  detailDensity: number;
  motionCadence: GardenStyleProfile["motionCadence"];
  skyAccents: GardenStyleProfile["skyAccents"];
  waterAccents: GardenStyleProfile["waterAccents"];
  seeds: GardenStyleProfile["seeds"];
  materialRoles?: Partial<Record<GardenMaterialRole, Partial<GardenMaterialRoleProfile>>>;
}

export type FoliageForm = "painted-botanical" | "paper-relief" | "twilight-silhouette";

export interface GardenVisualDirection {
  id: GardenVisualDirectionID;
  name: string;
  meaning: string;
  foliageForm: FoliageForm;
  palette: {
    skyTint: string;
    groundTint: string;
    foliageTint: string;
    accentTint: string;
    detailTint: string;
    influence: number;
    skyInfluence?: number;
    groundInfluence?: number;
    foliageInfluence?: number;
    accentInfluence?: number;
    trunk: string;
  };
  lighting: {
    hemisphereSky: string;
    hemisphereGround: string;
    hemisphereIntensity: number;
    sunTint: string;
    sunIntensityScale: number;
    exposure: number;
    fogNear: number;
    fogFar: number;
    fillColor: string;
    fillIntensity: number;
    fillPosition: readonly [number, number, number];
  };
  composition: {
    cameraDistanceScale: number;
    cameraHeightOffset: number;
    targetHeightOffset: number;
    groundLayers: number;
    canopyScale: readonly [number, number, number];
    particleSize: number;
    particleOpacity: number;
    waterOpacity: number;
  };
  motion: {
    canopyAmplitude: number;
    particleSpeed: number;
    framesPerSecond?: number;
  };
  material?: {
    treatment: GardenMaterialTreatment;
    roughness: number;
    flatShading: boolean;
    textureScale: number;
    outlineColor?: string;
    outlineScale?: number;
  };
  styleProfile?: GardenStyleProfile;
  detailOverrides: Partial<Record<GardenFeature, string>>;
}

export interface ResolvedVisualModel {
  dayPhase: GardenDayPhase;
  skyTopColor: string;
  skyColor: string;
  skyLowerColor: string;
  fogColor: string;
  celestialGlowColor: string;
  celestialGlowStrength: number;
  starOpacity: number;
  moonOpacity: number;
  groundColor: string;
  accentColor: string;
  foliageColors: string[];
  hemisphereSkyColor: string;
  hemisphereGroundColor: string;
  hemisphereIntensity: number;
  sunColor: string;
  sunIntensity: number;
  fillColor: string;
  fillIntensity: number;
  exposure: number;
}

interface GardenPhasePalette {
  skyTop: string;
  skyHorizon: string;
  skyLower: string;
  fog: string;
  glow: string;
  illuminationScale: number;
  ambientScale: number;
  fillScale: number;
  exposureScale: number;
  celestialOpacity: number;
  groundTarget: string;
  groundBlend: number;
  foliageTarget: string;
  foliageBlend: number;
}

const gardenPhasePalettes: Record<GardenDayPhase, GardenPhasePalette> = {
  dawn: {
    skyTop: "#4d6080",
    skyHorizon: "#7f7d87",
    skyLower: "#536c70",
    fog: "#68787a",
    glow: "#edb37d",
    illuminationScale: 0.82,
    ambientScale: 0.82,
    fillScale: 0.68,
    exposureScale: 0.96,
    celestialOpacity: 0.14,
    groundTarget: "#657567",
    groundBlend: 0.18,
    foliageTarget: "#6f8268",
    foliageBlend: 0.12,
  },
  day: {
    skyTop: "#91bbc5",
    skyHorizon: "#b3c8c0",
    skyLower: "#829d93",
    fog: "#98aaa5",
    glow: "#ead19a",
    illuminationScale: 1.34,
    ambientScale: 1.28,
    fillScale: 0.24,
    exposureScale: 1.14,
    celestialOpacity: 0,
    groundTarget: "#748a72",
    groundBlend: 0.34,
    foliageTarget: "#7b997b",
    foliageBlend: 0.26,
  },
  dusk: {
    skyTop: "#26335b",
    skyHorizon: "#595870",
    skyLower: "#374754",
    fog: "#474f5d",
    glow: "#efad69",
    illuminationScale: 0.7,
    ambientScale: 0.74,
    fillScale: 0.78,
    exposureScale: 0.96,
    celestialOpacity: 0.46,
    groundTarget: "#45554b",
    groundBlend: 0.14,
    foliageTarget: "#5b6d59",
    foliageBlend: 0.1,
  },
  night: {
    skyTop: "#111936",
    skyHorizon: "#334258",
    skyLower: "#22363d",
    fog: "#2c3d47",
    glow: "#d9a16a",
    illuminationScale: 0.42,
    ambientScale: 0.7,
    fillScale: 1,
    exposureScale: 0.96,
    celestialOpacity: 0.92,
    groundTarget: "#304b46",
    groundBlend: 0.24,
    foliageTarget: "#4b6351",
    foliageBlend: 0.2,
  },
};

export function resolveVisualModel(
  model: GardenWorldModel,
  direction: GardenVisualDirection,
): ResolvedVisualModel {
  const influence = clamp(direction.palette.influence, 0, 1);
  const profile = styleProfileFor(direction);
  const phase = gardenPhasePalettes[model.dayPhase];
  const baseSkyColor = mixHex(
    model.skyColor,
    direction.palette.skyTint,
    clamp(direction.palette.skyInfluence ?? influence, 0, 1),
  );
  const phaseInfluence = model.dayPhase === "day" ? 0.86 : 0.88;
  const baseSunColor = mixHex(model.sunColor, direction.lighting.sunTint, influence);
  const baseGroundColor = mixHex(
    model.groundColor,
    direction.palette.groundTint,
    clamp(direction.palette.groundInfluence ?? influence, 0, 1),
  );
  const skyAccentStrength = clamp(profile.skyAccents.strength, 0, 1);
  return {
    dayPhase: model.dayPhase,
    skyTopColor: mixHex(
      mixHex(direction.lighting.hemisphereSky, profile.skyAccents.horizonTint, skyAccentStrength * 0.16),
      phase.skyTop,
      phaseInfluence,
    ),
    skyColor: mixHex(
      mixHex(baseSkyColor, profile.skyAccents.horizonTint, skyAccentStrength * 0.18),
      phase.skyHorizon,
      phaseInfluence,
    ),
    skyLowerColor: mixHex(direction.lighting.hemisphereGround, phase.skyLower, phaseInfluence),
    fogColor: mixHex(baseSkyColor, phase.fog, 0.82),
    celestialGlowColor: mixHex(phase.glow, profile.skyAccents.celestialTint, skyAccentStrength * 0.72),
    celestialGlowStrength: (model.dayPhase === "day" ? 0.26 : model.dayPhase === "night" ? 0.1 : 0.2)
      * (1 + skyAccentStrength * 0.08),
    starOpacity: phase.celestialOpacity,
    moonOpacity: Math.max(model.dayPhase === "day" ? 0.025 : 0.18, phase.celestialOpacity),
    groundColor: mixHex(baseGroundColor, phase.groundTarget, phase.groundBlend),
    accentColor: mixHex(
      model.accentColor,
      direction.palette.accentTint,
      clamp(direction.palette.accentInfluence ?? influence, 0, 1),
    ),
    foliageColors: model.foliage.map((cluster) => {
      const base = mixHex(
        cluster.color,
        direction.palette.foliageTint,
        clamp(direction.palette.foliageInfluence ?? influence, 0, 1),
      );
      return mixHex(base, phase.foliageTarget, phase.foliageBlend);
    }),
    hemisphereSkyColor: mixHex(direction.lighting.hemisphereSky, phase.skyTop, 0.48),
    hemisphereGroundColor: mixHex(direction.lighting.hemisphereGround, phase.skyLower, 0.42),
    hemisphereIntensity: direction.lighting.hemisphereIntensity * phase.ambientScale,
    sunColor: mixHex(baseSunColor, phase.glow, 0.34),
    sunIntensity: model.sunIntensity * direction.lighting.sunIntensityScale * phase.illuminationScale,
    fillColor: mixHex(direction.lighting.fillColor, phase.glow, 0.28),
    fillIntensity: direction.lighting.fillIntensity * phase.fillScale,
    exposure: direction.lighting.exposure * phase.exposureScale,
  };
}

export function resolveDetailColor(
  original: string,
  kind: GardenFeature,
  direction: GardenVisualDirection,
): string {
  const target = direction.detailOverrides[kind] ?? direction.palette.detailTint;
  return mixHex(original, target, clamp(direction.palette.influence * 0.72, 0, 1));
}

const defaultMaterialRoleProfile: GardenMaterialRoleProfile = {
  roughness: 0.96,
  flatShading: true,
  textureScale: 1.8,
  textureOpacity: 0.72,
};

export function createGardenStyleProfile(
  options: GardenStyleProfileOptions,
): GardenStyleProfile {
  const materialRoles = Object.fromEntries(
    (Object.keys(defaultMaterialRoles) as GardenMaterialRole[]).map((role) => [
      role,
      {
        ...defaultMaterialRoleProfile,
        ...defaultMaterialRoles[role],
        ...options.materialRoles?.[role],
      },
    ]),
  ) as Record<GardenMaterialRole, GardenMaterialRoleProfile>;
  return {
    ...options,
    materialRoles,
  };
}

export function styleProfileFor(direction: GardenVisualDirection): GardenStyleProfile {
  return direction.styleProfile ?? createGardenStyleProfile({
    surfacePattern: direction.material?.treatment === "inked-paper"
      ? "paper-hatch"
      : direction.material?.treatment === "miniature-stop-motion"
      ? "miniature-paper-set"
      : direction.material?.treatment === "crochet-yarn"
      ? "braided-yarn"
      : direction.material?.treatment === "clay"
      ? "fingerprint-clay"
      : "natural-grain",
    edgeMode: direction.material?.outlineColor === undefined ? "none" : "ink-outline",
    shadingBands: direction.material?.flatShading === false ? 1 : 2,
    geometryTreatment: direction.material?.treatment === "inked-paper"
      ? "cel-stepped"
      : direction.material?.treatment === "miniature-stop-motion"
      ? "faceted-miniature"
      : direction.material?.treatment === "crochet-yarn"
      ? "rounded-inflated"
      : direction.material?.treatment === "clay"
      ? "moulded-clay"
      : "organic",
    detailDensity: 1,
    motionCadence: {
      framesPerSecond: direction.motion.framesPerSecond ?? 60,
      propJitter: 0,
      inkWobble: 0,
      squashStretch: 0,
    },
    skyAccents: { horizonTint: direction.palette.skyTint, celestialTint: direction.palette.accentTint, strength: 0 },
    waterAccents: { tint: direction.palette.detailTint, opacity: 1, rippleScale: 1 },
    seeds: { texture: 0x51c3d, motion: 0x72f19, geometry: 0xa41e7 },
  });
}

const defaultMaterialRoles: Record<GardenMaterialRole, Partial<GardenMaterialRoleProfile>> = {
  canopy: {},
  trunk: {},
  ground: {},
  grass: {},
  water: { roughness: 0.3, flatShading: false, textureScale: 1.4 },
  pavilion: { roughness: 0.92 },
  path: {},
  rock: {},
  wildlife: { roughness: 0.9, flatShading: false },
  celestial: { roughness: 1, textureOpacity: 0 },
};

export function directionEvidence(direction: GardenVisualDirection): Record<string, unknown> {
  const profile = styleProfileFor(direction);
  return {
    id: direction.id,
    meaning: direction.meaning,
    foliageForm: direction.foliageForm,
    materialTreatment: direction.material?.treatment ?? "natural",
    motionFramesPerSecond: direction.motion.framesPerSecond ?? 60,
    surfacePattern: profile.surfacePattern,
    edgeMode: profile.edgeMode,
    shadingBands: profile.shadingBands,
    geometryTreatment: profile.geometryTreatment,
    detailDensity: profile.detailDensity,
    styleSeeds: profile.seeds,
    groundLayers: direction.composition.groundLayers,
    reducedMotionBehavior: "static-state-with-direct-update",
    bridgeAuthority: "unchanged-garden-state-v1",
  };
}

function mixHex(from: string, to: string, amount: number): string {
  const fromRGB = parseHex(from);
  const toRGB = parseHex(to);
  const channel = (start: number, end: number): string =>
    Math.round(start + (end - start) * amount).toString(16).padStart(2, "0");
  return `#${channel(fromRGB[0], toRGB[0])}${channel(fromRGB[1], toRGB[1])}${channel(fromRGB[2], toRGB[2])}`;
}

function parseHex(value: string): readonly [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Unsupported visual color: ${value}`);
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
