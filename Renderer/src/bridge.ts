import type { GardenSnapshotEnvelope, RendererEventEnvelope } from "./types";
import { decodeSnapshotEnvelope, GardenContractError } from "./validation";

declare global {
  interface Window {
    arriveWithinGarden?: {
      receiveSnapshot(input: string | unknown): void;
      setActive(active: boolean): void;
      resetView(): void;
    };
  }
}

export interface GardenBridgeActions {
  applySnapshot(envelope: GardenSnapshotEnvelope): void;
  setActive(active: boolean): void;
  resetView(): void;
  showError(message: string): void;
}

export interface GardenBridgeController {
  emit(
    type: RendererEventEnvelope["type"],
    payload?: RendererEventEnvelope["payload"],
  ): void;
  dispose(): void;
}

export function installGardenBridge(actions: GardenBridgeActions): GardenBridgeController {
  const emit = (
    type: RendererEventEnvelope["type"],
    payload: RendererEventEnvelope["payload"] = {},
  ): void => {
    const event: RendererEventEnvelope = {
      type,
      schemaVersion: 1,
      requestID: createRendererRequestID(),
      payload,
    };
    window.postMessage({ channel: "arrive-within-renderer", event }, "*");
  };

  window.arriveWithinGarden = {
    receiveSnapshot(input): void {
      try {
        actions.applySnapshot(decodeSnapshotEnvelope(input));
      } catch (error) {
        const message =
          error instanceof GardenContractError ? error.message : "The garden snapshot could not be read.";
        actions.showError(message);
        emit("error", { code: "invalid-snapshot", message, recoverable: true });
      }
    },
    setActive(active): void {
      actions.setActive(active);
    },
    resetView(): void {
      actions.resetView();
    },
  };

  return {
    emit,
    dispose(): void {
      delete window.arriveWithinGarden;
    },
  };
}

export function createRendererRequestID(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hexadecimal = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20),
  ].join("-");
}
