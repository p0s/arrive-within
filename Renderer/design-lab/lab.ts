import { createGardenScene, type GardenRendererDiagnostics } from "../src/scene";
import { resolveGardenRenderStyle } from "../src/render-style";
import type { GardenDayPhase, GardenQualityHint, GardenState } from "../src/types";
import type { GardenVisualDirection, GardenVisualDirectionID } from "../src/visual-design";
import { paperSanctuary } from "../src/visual-directions/paper-sanctuary";
import { twilightRefuge } from "../src/visual-directions/twilight-refuge";
import { verdantAtelier } from "../src/visual-directions/verdant-atelier";

type LabPreset =
  | "empty"
  | "first-growth"
  | "pre-milestone"
  | "micro-growth"
  | "milestone-reveal"
  | "mature";

declare global {
  interface Window {
    arriveWithinGardenDesignLab?: {
      setPreset(preset: LabPreset): void;
      setMilestone(milestone: number): void;
      setDayPhase(phase: GardenDayPhase): void;
      setStyle(style: string): void;
      setQuality(quality: GardenQualityHint): void;
      setReduceMotion(reduced: boolean): void;
      resetView(): void;
      diagnostics(): GardenRendererDiagnostics;
      ready: boolean;
    };
  }
}

const directions: Record<GardenVisualDirectionID, GardenVisualDirection> = {
  "verdant-atelier": verdantAtelier,
  "paper-sanctuary": paperSanctuary,
  "twilight-refuge": twilightRefuge,
};
const query = new URLSearchParams(location.search);
const requestedDirection = query.get("direction") as GardenVisualDirectionID | null;
const requestedStyle = query.get("style");
const direction = requestedStyle === null
  ? requestedDirection === null ? verdantAtelier : directions[requestedDirection]
  : resolveGardenRenderStyle(requestedStyle);
if (direction === undefined) throw new Error("Unknown Garden design direction.");
let reduceMotion = query.get("reduceMotion") === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
const initialPreset = parsePreset(query.get("preset"));
let localDayPhase = parseDayPhase(query.get("phase"));
let qualityHint = parseQuality(query.get("quality"));
document.documentElement.dataset.theme = query.get("theme") === "light" ? "light" : "dark";

const canvas = required("garden-canvas", HTMLCanvasElement);
const directionName = required("direction-name", HTMLHeadingElement);
const directionMeaning = required("direction-meaning", HTMLParagraphElement);
const stateName = required("state-name", HTMLParagraphElement);
directionName.textContent = direction.name;
directionMeaning.textContent = direction.meaning;

let currentState = makeState(initialPreset, reduceMotion);
const scene = createGardenScene(canvas, currentState, {
  contextLost(): void { document.body.dataset.context = "lost"; },
  contextRestored(): void { document.body.dataset.context = "available"; },
  interaction(kind): void { document.body.dataset.interaction = kind; },
  performance(milliseconds): void { document.body.dataset.frameMilliseconds = milliseconds.toFixed(2); },
}, direction);

const api = {
  ready: true,
  setPreset(preset: LabPreset): void {
    currentState = makeState(preset, reduceMotion);
    stateName.textContent = label(preset);
    scene.update(currentState);
  },
  setMilestone(milestone: number): void {
    if (!Number.isInteger(milestone) || milestone < 1 || milestone > 15) {
      throw new Error("Design-lab milestone must be an integer from 1 through 15.");
    }
    currentState = makeMilestoneState(milestone, reduceMotion);
    stateName.textContent = `milestone ${milestone}`;
    scene.update(currentState);
  },
  setDayPhase(phase: GardenDayPhase): void {
    localDayPhase = phase;
    currentState = { ...currentState, localDayPhase };
    scene.update(currentState);
  },
  setStyle(style: string): void {
    scene.setVisualDirection(resolveGardenRenderStyle(style));
  },
  setQuality(quality: GardenQualityHint): void {
    qualityHint = quality;
    currentState = { ...currentState, qualityHint };
    scene.update(currentState);
  },
  setReduceMotion(reduced: boolean): void {
    reduceMotion = reduced;
    currentState = { ...currentState, reduceMotion };
    scene.update(currentState);
  },
  resetView(): void { scene.resetView(); },
  diagnostics(): GardenRendererDiagnostics { return scene.diagnostics(); },
};
window.arriveWithinGardenDesignLab = api;
api.setPreset(initialPreset);
window.addEventListener("pagehide", () => scene.dispose(), { once: true });

function makeState(preset: LabPreset, reduced: boolean): GardenState {
  const values: Record<LabPreset, { day: number; milestone: number; ordinal: number }> = {
    empty: { day: 0, milestone: 0, ordinal: 0 },
    "first-growth": { day: 1, milestone: 0, ordinal: 1 },
    "pre-milestone": { day: 12, milestone: 6, ordinal: 17 },
    "micro-growth": { day: 30, milestone: 15, ordinal: 39 },
    "milestone-reveal": { day: 14, milestone: 7, ordinal: 18 },
    mature: { day: 30, milestone: 15, ordinal: 38 },
  };
  const value = values[preset];
  const unlocked = Array.from({ length: value.milestone }, (_, index) => {
    const id = String(index + 1).padStart(2, "0");
    return [`m${id}-a`, `m${id}-b`];
  }).flat();
  return {
    schemaVersion: 1,
    gardenID: "10000000-0000-4000-8000-000000000001",
    gardenSeed: 283_641,
    profileGenerationID: "10000000-0000-4000-8000-000000000002",
    qualifyingSessionCount: value.ordinal,
    totalQualifyingSeconds: value.ordinal * 360,
    journeyDay: value.day,
    highestMilestone: value.milestone,
    unlockedVariants: unlocked,
    activeCustomization: Object.fromEntries(
      Array.from({ length: value.milestone }, (_, index) => [String(index + 1), `m${String(index + 1).padStart(2, "0")}-a`]),
    ),
    microGrowthOrdinal: value.ordinal,
    localTimePresentation: null,
    localDayPhase,
    latestGrowthEvent: null,
    reduceMotion: reduced,
    qualityHint,
  };
}

function makeMilestoneState(milestone: number, reduced: boolean): GardenState {
  const day = milestone * 2;
  const unlocked = Array.from({ length: milestone }, (_, index) => {
    const id = String(index + 1).padStart(2, "0");
    return [`m${id}-a`, `m${id}-b`];
  }).flat();
  return {
    schemaVersion: 1,
    gardenID: "10000000-0000-4000-8000-000000000001",
    gardenSeed: 283_641,
    profileGenerationID: "10000000-0000-4000-8000-000000000002",
    qualifyingSessionCount: day,
    totalQualifyingSeconds: day * 360,
    journeyDay: day,
    highestMilestone: milestone,
    unlockedVariants: unlocked,
    activeCustomization: Object.fromEntries(
      Array.from({ length: milestone }, (_, index) => [String(index + 1), `m${String(index + 1).padStart(2, "0")}-a`]),
    ),
    microGrowthOrdinal: day,
    localTimePresentation: null,
    localDayPhase,
    latestGrowthEvent: null,
    reduceMotion: reduced,
    qualityHint: "high",
  };
}

function parsePreset(value: string | null): LabPreset {
  if (value === "empty" || value === "first-growth" || value === "pre-milestone" || value === "micro-growth" || value === "milestone-reveal" || value === "mature") return value;
  return "mature";
}

function parseDayPhase(value: string | null): GardenDayPhase {
  if (value === "dawn" || value === "day" || value === "dusk" || value === "night") {
    return value;
  }
  return "night";
}

function parseQuality(value: string | null): GardenQualityHint {
  if (value === "low" || value === "balanced" || value === "high") return value;
  return "high";
}

function label(preset: LabPreset): string {
  return preset.replaceAll("-", " ");
}

function required<T extends HTMLElement>(id: string, constructor: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`Missing design-lab element #${id}.`);
  return element;
}
