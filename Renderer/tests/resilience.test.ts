import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  AdaptiveQualityController,
  WebGLContextRecoveryState,
} from "../src/resilience";
import { disposeObjectResources } from "../src/scene";

describe("renderer resilience", () => {
  it("reduces quality only after sustained render-budget pressure", () => {
    const controller = new AdaptiveQualityController("high");
    expect(controller.observeRenderMilliseconds(22)).toBeUndefined();
    expect(controller.observeRenderMilliseconds(23)).toBe("balanced");
    expect(controller.selectedQuality).toBe("balanced");
  });

  it("uses hysteresis before restoring quality and never exceeds its ceiling", () => {
    const controller = new AdaptiveQualityController("balanced");
    controller.observeRenderMilliseconds(21);
    expect(controller.observeRenderMilliseconds(21)).toBe("low");

    for (let index = 0; index < 8; index += 1) {
      expect(controller.observeRenderMilliseconds(5)).toBeUndefined();
    }
    expect(controller.observeRenderMilliseconds(5)).toBe("balanced");
    expect(controller.selectedQuality).toBe("balanced");
    for (let index = 0; index < 12; index += 1) {
      controller.observeRenderMilliseconds(4);
    }
    expect(controller.selectedQuality).toBe("balanced");
  });

  it("deduplicates context-loss and restoration transitions", () => {
    const recovery = new WebGLContextRecoveryState();
    expect(recovery.beginRecovery()).toBe(true);
    expect(recovery.beginRecovery()).toBe(false);
    expect(recovery.isRecovering).toBe(true);
    expect(recovery.completeRecovery()).toBe(true);
    expect(recovery.completeRecovery()).toBe(false);
    expect(recovery.isRecovering).toBe(false);
  });

  it("survives twenty complete context-loss and restoration cycles", () => {
    const recovery = new WebGLContextRecoveryState();
    for (let cycle = 0; cycle < 20; cycle += 1) {
      expect(recovery.beginRecovery()).toBe(true);
      expect(recovery.beginRecovery()).toBe(false);
      expect(recovery.completeRecovery()).toBe(true);
      expect(recovery.completeRecovery()).toBe(false);
      expect(recovery.isRecovering).toBe(false);
    }
  });

  it("disposes shared scene resources exactly once", () => {
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const geometryDisposed = vi.fn();
    const materialDisposed = vi.fn();
    const textureDisposed = vi.fn();
    geometry.addEventListener("dispose", geometryDisposed);
    material.addEventListener("dispose", materialDisposed);
    texture.addEventListener("dispose", textureDisposed);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, material));
    root.add(new THREE.Mesh(geometry, material));

    disposeObjectResources(root);

    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(1);
    expect(textureDisposed).toHaveBeenCalledTimes(1);
  });
});
