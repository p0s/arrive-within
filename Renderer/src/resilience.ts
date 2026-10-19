import type { GardenQualityHint } from "./types";

const qualityOrder: readonly GardenQualityHint[] = ["low", "balanced", "high"];

export class AdaptiveQualityController {
  private slowWindows = 0;
  private headroomWindows = 0;
  private cooldownWindows = 0;
  private ceiling: GardenQualityHint;
  private quality: GardenQualityHint;

  constructor(initialQuality: GardenQualityHint) {
    this.ceiling = initialQuality;
    this.quality = initialQuality;
  }

  get selectedQuality(): GardenQualityHint {
    return this.quality;
  }

  setCeiling(ceiling: GardenQualityHint): GardenQualityHint | undefined {
    this.ceiling = ceiling;
    if (qualityIndex(this.quality) <= qualityIndex(ceiling)) return undefined;
    this.quality = ceiling;
    this.resetWindows();
    return this.quality;
  }

  observeRenderMilliseconds(renderMilliseconds: number): GardenQualityHint | undefined {
    if (!Number.isFinite(renderMilliseconds) || renderMilliseconds < 0) return undefined;

    if (this.cooldownWindows > 0) {
      this.cooldownWindows -= 1;
      return undefined;
    }

    if (renderMilliseconds > 18) {
      this.slowWindows += 1;
      this.headroomWindows = 0;
    } else if (renderMilliseconds < 9) {
      this.headroomWindows += 1;
      this.slowWindows = 0;
    } else {
      this.resetWindows();
    }

    if (this.slowWindows >= 2 && this.quality !== "low") {
      this.quality = qualityOrder[qualityIndex(this.quality) - 1]!;
      this.resetWindows();
      this.cooldownWindows = 3;
      return this.quality;
    }

    if (
      this.headroomWindows >= 6
      && qualityIndex(this.quality) < qualityIndex(this.ceiling)
    ) {
      this.quality = qualityOrder[qualityIndex(this.quality) + 1]!;
      this.resetWindows();
      this.cooldownWindows = 3;
      return this.quality;
    }

    return undefined;
  }

  private resetWindows(): void {
    this.slowWindows = 0;
    this.headroomWindows = 0;
  }
}

export class WebGLContextRecoveryState {
  private recovering = false;

  get isRecovering(): boolean {
    return this.recovering;
  }

  beginRecovery(): boolean {
    if (this.recovering) return false;
    this.recovering = true;
    return true;
  }

  completeRecovery(): boolean {
    if (!this.recovering) return false;
    this.recovering = false;
    return true;
  }
}

function qualityIndex(quality: GardenQualityHint): number {
  return qualityOrder.indexOf(quality);
}
