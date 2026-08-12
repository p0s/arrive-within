import type { GardenFeature, GardenWorldModel } from "./world-model";

export type GardenVisualDirectionID =
  | "verdant-atelier"
  | "paper-sanctuary"
  | "twilight-refuge";

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
  };
  detailOverrides: Partial<Record<GardenFeature, string>>;
}

export interface ResolvedVisualModel {
  skyColor: string;
  groundColor: string;
  accentColor: string;
  foliageColors: string[];
  sunColor: string;
  sunIntensity: number;
}

export function resolveVisualModel(
  model: GardenWorldModel,
  direction: GardenVisualDirection,
): ResolvedVisualModel {
  const influence = clamp(direction.palette.influence, 0, 1);
  return {
    skyColor: mixHex(
      model.skyColor,
      direction.palette.skyTint,
      clamp(direction.palette.skyInfluence ?? influence, 0, 1),
    ),
    groundColor: mixHex(
      model.groundColor,
      direction.palette.groundTint,
      clamp(direction.palette.groundInfluence ?? influence, 0, 1),
    ),
    accentColor: mixHex(
      model.accentColor,
      direction.palette.accentTint,
      clamp(direction.palette.accentInfluence ?? influence, 0, 1),
    ),
    foliageColors: model.foliage.map((cluster) =>
      mixHex(
        cluster.color,
        direction.palette.foliageTint,
        clamp(direction.palette.foliageInfluence ?? influence, 0, 1),
      ),
    ),
    sunColor: mixHex(model.sunColor, direction.lighting.sunTint, influence),
    sunIntensity: model.sunIntensity * direction.lighting.sunIntensityScale,
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

export function directionEvidence(direction: GardenVisualDirection): Record<string, unknown> {
  return {
    id: direction.id,
    meaning: direction.meaning,
    foliageForm: direction.foliageForm,
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
