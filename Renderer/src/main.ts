import { installGardenBridge } from "./bridge";
import { AdaptiveQualityController, WebGLContextRecoveryState } from "./resilience";
import { createGardenScene, type GardenSceneController } from "./scene";
import { shippingGardenVisualDirection } from "./shipping-visual";
import type { GardenState } from "./types";
import { validateGardenState } from "./validation";

const canvas = requireElement("garden-canvas", HTMLCanvasElement);
const status = requireElement("renderer-status", HTMLParagraphElement);

const initialState: GardenState = validateGardenState({
  schemaVersion: 1,
  gardenID: "00000000-0000-4000-8000-000000000001",
  gardenSeed: 1,
  profileGenerationID: "00000000-0000-4000-8000-000000000002",
  qualifyingSessionCount: 0,
  totalQualifyingSeconds: 0,
  journeyDay: 0,
  highestMilestone: 0,
  unlockedVariants: [],
  activeCustomization: {},
  microGrowthOrdinal: 0,
  localTimePresentation: null,
  latestGrowthEvent: null,
  reduceMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  qualityHint: "balanced",
});

let scene: GardenSceneController | undefined;
let latestState = initialState;
const adaptiveQuality = new AdaptiveQualityController(initialState.qualityHint);
const contextRecovery = new WebGLContextRecoveryState();

const effectiveState = (): GardenState => ({
  ...latestState,
  qualityHint: adaptiveQuality.selectedQuality,
});

const bridge = installGardenBridge({
  applySnapshot(envelope): void {
    if (scene === undefined) {
      showStatus("The living garden is unavailable");
      return;
    }
    latestState = envelope.payload.state;
    const ceilingSelection = adaptiveQuality.setCeiling(latestState.qualityHint);
    scene.update(effectiveState());
    emitRendererInventory();
    hideStatus();
    bridge.emit("diagnostic", { code: "snapshot-applied" });
    if (ceilingSelection !== undefined) {
      bridge.emit("selected-quality", { quality: ceilingSelection, reason: "state-ceiling" });
    }
  },
  setActive(active): void {
    scene?.setActive(active);
  },
  resetView(): void {
    scene?.resetView();
  },
  showError(message): void {
    showStatus(message);
  },
});

try {
  scene = createGardenScene(canvas, effectiveState(), {
    contextLost(): void {
      if (!contextRecovery.beginRecovery()) return;
      showStatus("Garden renderer paused");
      bridge.emit("diagnostic", { code: "context-lost" });
    },
    contextRestored(): void {
      if (!contextRecovery.completeRecovery()) return;
      scene?.update(effectiveState());
      emitRendererInventory();
      hideStatus();
      bridge.emit("diagnostic", { code: "context-restored" });
    },
    interaction(kind): void {
      bridge.emit("interaction", { kind });
    },
    performance(frameMilliseconds): void {
      bridge.emit("performance", { frameMilliseconds });
      const selection = adaptiveQuality.observeRenderMilliseconds(frameMilliseconds);
      if (selection === undefined) return;
      scene?.update(effectiveState());
      bridge.emit("selected-quality", { quality: selection, reason: "frame-budget" });
    },
  }, shippingGardenVisualDirection);
  emitRendererInventory();
  bridge.emit("ready", { webgl2: true });
} catch (error) {
  const message = startupErrorMessage(error);
  showStatus("The living garden is unavailable");
  bridge.emit("error", { code: "startup-failed", message, recoverable: true });
}

window.addEventListener(
  "pagehide",
  () => {
    bridge.dispose();
    scene?.dispose();
  },
  { once: true },
);

function showStatus(message: string): void {
  status.textContent = message;
  status.dataset.visible = "true";
}

function hideStatus(): void {
  status.dataset.visible = "false";
}

function emitRendererInventory(): void {
  const diagnostics = scene?.diagnostics();
  if (diagnostics === undefined) return;
  bridge.emit("inventory", {
    direction: diagnostics.direction,
    drawCalls: diagnostics.drawCalls,
    triangles: diagnostics.triangles,
    geometries: diagnostics.geometries,
    textures: diagnostics.textures,
    programs: diagnostics.programs,
    rebuildCount: diagnostics.rebuildCount,
    context: diagnostics.context,
    effectivePixelRatio: diagnostics.effectivePixelRatio,
  });
}

function startupErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown renderer startup failure.";
  return message.slice(0, 160);
}

function requireElement<T extends HTMLElement>(id: string, constructor: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`Required renderer element #${id} is unavailable.`);
  }
  return element;
}
