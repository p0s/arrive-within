import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  AdaptiveQualityController,
  WebGLContextRecoveryState,
} from "../src/resilience";
import {
  disposeObjectResources,
  resolveBirdPresentation,
  resolveBirdSettledPresentation,
  resolveGardenOrbitAngle,
} from "../src/scene";

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

  it("locks the authored camera while Reduce Motion is active", () => {
    expect(resolveGardenOrbitAngle(0, 120, false)).toBeCloseTo(0.48);
    expect(resolveGardenOrbitAngle(0.4, 120, true)).toBe(0);
    expect(resolveGardenOrbitAngle(-0.4, -120, true)).toBe(0);
  });

  it("alternates sparse bird crossings with deterministic settled poses", () => {
    const bird = {
      pathRadius: 4,
      pathDepth: 2.5,
      height: 4,
      phase: 0,
      speed: 1,
      scale: 0.2,
      color: "#283e43",
    };
    const start = resolveBirdPresentation(bird, 0);
    const crossing = resolveBirdPresentation(bird, 4_000);
    const settledEarly = resolveBirdPresentation(bird, 10_000);
    const settledLate = resolveBirdPresentation(bird, 24_000);
    const returnStart = resolveBirdPresentation(bird, 32_000);

    expect(start.state).toBe("crossing");
    expect(crossing.state).toBe("crossing");
    expect(crossing.position[0]).toBeGreaterThan(start.position[0]);
    expect(settledEarly.state).toBe("settled");
    expect(settledLate.state).toBe("settled");
    expect(settledEarly.position).toEqual(settledLate.position);
    expect(settledEarly.wingFlap).toBe(0);
    expect(settledLate.wingFlap).toBe(0);
    expect(returnStart.position).toEqual(settledLate.position);

    const reducedMotionPose = resolveBirdSettledPresentation({ ...bird, phase: 4 });
    expect(reducedMotionPose.state).toBe("settled");
    expect(reducedMotionPose.wingFlap).toBe(0);
    expect(reducedMotionPose.roll).toBe(0);
  });
});
