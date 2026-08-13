import * as THREE from "three";
import { makeDeterministicRandom } from "./seeded";
import {
  styleProfileFor,
  type GardenMaterialRole,
  type GardenStyleProfile,
  type GardenVisualDirection,
} from "./visual-design";
import type { GardenQualityHint } from "./types";

type MaterialColor = THREE.ColorRepresentation;

export interface GardenMaterialOptions {
  color?: MaterialColor;
  roughness?: number;
  flatShading?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  depthWrite?: boolean;
  metalness?: number;
  map?: THREE.Texture | null;
}

interface CachedTexture {
  texture: THREE.CanvasTexture;
  references: number;
}

const sharedTextures = new Map<string, CachedTexture>();

/**
 * The only place where Garden style materials and their procedural surfaces are made.
 * Textures are deterministic, shared by role, and reference-counted across atomic root swaps.
 */
export class GardenStyleMaterialFactory {
  readonly profile: GardenStyleProfile;
  private readonly textureKeys = new Set<string>();

  constructor(
    readonly direction: GardenVisualDirection,
    private readonly root: THREE.Object3D,
    private readonly qualityHint: GardenQualityHint,
  ) {
    this.profile = styleProfileFor(direction);
    this.root.userData.arriveWithinStyleTextureKeys = this.textureKeys;
  }

  standard(role: GardenMaterialRole, options: GardenMaterialOptions = {}): THREE.Material {
    const roleProfile = this.profile.materialRoles[role];
    const map = options.map === undefined ? this.texture(role) : options.map;
    const common = {
      color: options.color ?? "#ffffff",
      map,
      flatShading: options.flatShading ?? roleProfile.flatShading,
      side: options.side ?? THREE.FrontSide,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      depthWrite: options.depthWrite ?? true,
    };
    if (this.profile.surfacePattern === "paper-hatch" && this.profile.shadingBands >= 3) {
      return new THREE.MeshToonMaterial({
        ...common,
        gradientMap: this.texture("celestial", "cel-bands"),
      });
    }
    return new THREE.MeshStandardMaterial({
      ...common,
      roughness: options.roughness ?? roleProfile.roughness,
      metalness: options.metalness ?? 0,
    });
  }

  basic(role: GardenMaterialRole, options: GardenMaterialOptions = {}): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: options.color ?? "#ffffff",
      map: options.map === undefined ? this.texture(role) : options.map,
      transparent: options.transparent ?? false,
      opacity: options.opacity ?? 1,
      side: options.side ?? THREE.FrontSide,
      depthWrite: options.depthWrite ?? true,
    });
  }

  outline(role: GardenMaterialRole): THREE.MeshBasicMaterial {
    const color = this.direction.material?.outlineColor ?? "#29455c";
    return new THREE.MeshBasicMaterial({
      color,
      side: THREE.BackSide,
      transparent: true,
      opacity: role === "canopy" ? 0.96 : 0.86,
      depthWrite: false,
    });
  }

  hasInkOutline(): boolean {
    return this.profile.edgeMode === "ink-outline" && this.qualityHint !== "low";
  }

  hasStyleDetail(): boolean {
    return this.qualityHint !== "low" && this.profile.detailDensity > 0.55;
  }

  texture(role: GardenMaterialRole, variant = "surface"): THREE.CanvasTexture | null {
    if (!this.textureEnabled(role, variant)) return null;
    const seed = this.profile.seeds.texture;
    const key = `${this.direction.id}:${this.profile.surfacePattern}:${role}:${variant}:${seed}`;
    const cached = sharedTextures.get(key);
    if (cached !== undefined) {
      this.retain(key, cached);
      return cached.texture;
    }
    const texture = variant === "cel-bands"
      ? createCelBandTexture(this.profile.shadingBands)
      : createStyleTexture(this.profile, role, seed);
    texture.userData.arriveWithinSharedStyleTexture = true;
    texture.userData.arriveWithinStyleTextureKey = key;
    sharedTextures.set(key, { texture, references: 0 });
    this.retain(key, sharedTextures.get(key)!);
    return texture;
  }

  release(): void {
    for (const key of this.textureKeys) {
      const cached = sharedTextures.get(key);
      if (cached === undefined) continue;
      cached.references -= 1;
      if (cached.references > 0) continue;
      cached.texture.dispose();
      sharedTextures.delete(key);
    }
    this.textureKeys.clear();
  }

  private retain(key: string, cached: CachedTexture): void {
    if (this.textureKeys.has(key)) return;
    this.textureKeys.add(key);
    cached.references += 1;
  }

  private textureEnabled(role: GardenMaterialRole, variant: string): boolean {
    if (this.direction.id === "twilight-refuge") return false;
    if (variant === "cel-bands") return this.profile.surfacePattern === "paper-hatch";
    if (this.profile.materialRoles[role].textureOpacity <= 0) return false;
    if (this.qualityHint !== "low") return true;
    return role === "canopy" || role === "trunk" || role === "ground";
  }
}

export function disposeSharedStyleTexture(texture: THREE.Texture): void {
  if (texture.userData.arriveWithinSharedStyleTexture !== true) texture.dispose();
}

function createStyleTexture(
  profile: GardenStyleProfile,
  role: GardenMaterialRole,
  seed: number,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Garden style texture context is unavailable.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 128, 128);
  const random = makeDeterministicRandom(seed, `${profile.surfacePattern}:${role}`);

  switch (profile.surfacePattern) {
  case "paper-hatch":
    drawPaperHatch(context, random, role);
    break;
  case "miniature-paper-set":
    drawMiniatureSet(context, random, role);
    break;
  case "braided-yarn":
    drawYarnLoops(context, role);
    break;
  case "fingerprint-clay":
    drawClayRings(context, random, role);
    break;
  case "natural-grain":
    drawNaturalGrain(context, random);
    break;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  const scale = profile.materialRoles[role].textureScale;
  texture.repeat.set(scale, scale);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function createCelBandTexture(bands: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.min(4, bands));
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Garden cel-band texture context is unavailable.");
  for (let index = 0; index < canvas.width; index += 1) {
    const value = Math.round(52 + index * (203 / Math.max(1, canvas.width - 1)));
    context.fillStyle = `rgb(${value}, ${value}, ${value})`;
    context.fillRect(index, 0, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

function drawPaperHatch(
  context: CanvasRenderingContext2D,
  random: ReturnType<typeof makeDeterministicRandom>,
  role: GardenMaterialRole,
): void {
  context.strokeStyle = role === "water" ? "rgba(39, 76, 99, 0.28)" : "rgba(38, 63, 84, 0.25)";
  context.lineWidth = role === "canopy" || role === "trunk" ? 0.85 : 0.62;
  for (let row = -128; row < 180; row += 9) {
    context.beginPath();
    context.moveTo(-12, row + random.signed(2));
    context.bezierCurveTo(35, row - 4, 87, row + 4, 140, row - 3);
    context.stroke();
  }
  context.strokeStyle = "rgba(41, 69, 91, 0.18)";
  context.lineWidth = 0.58;
  for (let column = -128; column < 160; column += 13) {
    context.beginPath();
    context.moveTo(column, -8);
    context.lineTo(column + 34, 136);
    context.stroke();
  }
  if (role === "canopy" || role === "wildlife") {
    context.strokeStyle = "rgba(28, 56, 78, 0.34)";
    context.lineWidth = 0.72;
    for (let index = 0; index < 14; index += 1) {
      const x = random.range(4, 124);
      const y = random.range(4, 124);
      context.beginPath();
      context.moveTo(x - 6, y + 4);
      context.quadraticCurveTo(x, y - 5, x + 7, y - 8);
      context.stroke();
    }
  }
}

function drawMiniatureSet(
  context: CanvasRenderingContext2D,
  random: ReturnType<typeof makeDeterministicRandom>,
  role: GardenMaterialRole,
): void {
  context.fillStyle = role === "ground" || role === "path"
    ? "rgba(67, 61, 51, 0.085)"
    : "rgba(83, 71, 58, 0.065)";
  for (let index = 0; index < 74; index += 1) {
    const x = Math.floor(random.range(0, 128));
    const y = Math.floor(random.range(0, 128));
    const size = index % 3 === 0 ? 2 : 1;
    context.fillRect(x, y, size, size);
  }
  context.strokeStyle = "rgba(64, 73, 73, 0.16)";
  context.lineWidth = 1;
  for (let row = 7; row < 128; row += 22) {
    context.beginPath();
    context.moveTo(0, row + random.signed(1));
    context.lineTo(128, row + random.signed(1));
    context.stroke();
  }
  if (role === "canopy" || role === "rock") {
    context.strokeStyle = "rgba(56, 68, 70, 0.18)";
    context.lineWidth = 1.2;
    for (let index = 0; index < 8; index += 1) {
      const x = random.range(0, 120);
      const y = random.range(0, 120);
      context.strokeRect(x, y, 5 + index % 3, 4 + (index + 1) % 3);
    }
  }
}

function drawYarnLoops(context: CanvasRenderingContext2D, role: GardenMaterialRole): void {
  context.strokeStyle = role === "pavilion" ? "rgba(93, 67, 72, 0.3)" : "rgba(76, 71, 76, 0.28)";
  context.lineWidth = role === "trunk" || role === "pavilion" ? 2.1 : 1.7;
  const spacing = role === "ground" || role === "path" ? 12 : 10;
  for (let row = -4; row < 136; row += spacing) {
    for (let column = -4; column < 136; column += spacing) {
      const offset = (Math.floor(row / spacing) % 2) * spacing * 0.5;
      context.beginPath();
      context.arc(column + offset, row, 4.2, 0.15, Math.PI * 1.82);
      context.stroke();
      context.beginPath();
      context.arc(column + offset + 4, row + 2.2, 3.2, Math.PI * 1.15, Math.PI * 2.75);
      context.stroke();
    }
  }
  if (role === "trunk" || role === "pavilion") {
    context.strokeStyle = "rgba(112, 74, 83, 0.25)";
    context.lineWidth = 1.15;
    for (let column = 2; column < 128; column += 14) {
      context.beginPath();
      context.moveTo(column, 0);
      context.bezierCurveTo(column - 8, 32, column + 8, 76, column, 128);
      context.stroke();
    }
  }
}

function drawClayRings(
  context: CanvasRenderingContext2D,
  random: ReturnType<typeof makeDeterministicRandom>,
  role: GardenMaterialRole,
): void {
  context.strokeStyle = role === "water" ? "rgba(63, 78, 76, 0.12)" : "rgba(77, 57, 52, 0.18)";
  context.lineWidth = role === "canopy" || role === "trunk" ? 1.05 : 0.82;
  const centers: Array<readonly [number, number]> = role === "ground" || role === "path"
    ? [[64, 64], [17, 108], [108, 24]]
    : [[64, 64]];
  for (const [centerX, centerY] of centers) {
    for (let radius = 8; radius < 72; radius += 7) {
      context.beginPath();
      context.ellipse(
        centerX + random.signed(1.8),
        centerY + random.signed(1.8),
        radius * (1 + random.signed(0.035)),
        radius * 0.64,
        random.signed(0.18),
        0.15,
        Math.PI * 1.86,
      );
      context.stroke();
    }
  }
  if (role === "canopy" || role === "wildlife") {
    context.strokeStyle = "rgba(103, 65, 57, 0.2)";
    context.lineWidth = 1.4;
    for (let index = 0; index < 6; index += 1) {
      const x = random.range(14, 114);
      const y = random.range(14, 114);
      context.beginPath();
      context.arc(x, y, 4 + index * 0.6, 0.25, Math.PI * 1.64);
      context.stroke();
    }
  }
}

function drawNaturalGrain(
  context: CanvasRenderingContext2D,
  random: ReturnType<typeof makeDeterministicRandom>,
): void {
  context.fillStyle = "rgba(223, 181, 105, 0.026)";
  for (let index = 0; index < 72; index += 1) {
    const radius = 1 + random.range(0, 2.4);
    context.beginPath();
    context.ellipse(
      random.range(0, 128),
      random.range(0, 128),
      radius * 1.8,
      radius,
      random.range(0, Math.PI),
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}
