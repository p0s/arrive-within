export type GardenQualityHint = "low" | "balanced" | "high";
export type GardenDayPhase = "dawn" | "day" | "dusk" | "night";

export interface GardenGrowthEvent {
  practiceEventID: string;
  sessionID: string;
  beforeMicroGrowthOrdinal: number;
  afterMicroGrowthOrdinal: number;
  beforeJourneyDay: number;
  afterJourneyDay: number;
}

export interface GardenState {
  schemaVersion: 1;
  gardenID: string;
  gardenSeed: number;
  profileGenerationID: string;
  qualifyingSessionCount: number;
  totalQualifyingSeconds: number;
  journeyDay: number;
  highestMilestone: number;
  unlockedVariants: string[];
  activeCustomization: Record<string, string>;
  microGrowthOrdinal: number;
  localTimePresentation?: string | null;
  localDayPhase?: GardenDayPhase;
  latestGrowthEvent?: GardenGrowthEvent | null;
  reduceMotion: boolean;
  qualityHint: GardenQualityHint;
}

export interface GardenSnapshotPayload {
  state: GardenState;
}

export interface GardenSnapshotEnvelope {
  type: "state-snapshot";
  schemaVersion: 1;
  requestID: string;
  payload: GardenSnapshotPayload;
}

export type RendererEventType =
  | "ready"
  | "interaction"
  | "performance"
  | "selected-quality"
  | "inventory"
  | "diagnostic"
  | "error";

export interface RendererEventEnvelope {
  type: RendererEventType;
  schemaVersion: 1;
  requestID: string;
  payload: Record<string, boolean | number | string | null>;
}
