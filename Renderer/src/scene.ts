import * as THREE from "three";
import type { GardenState } from "./types";
import {
  resolveDetailColor,
  resolveVisualModel,
  type GardenVisualDirection,
} from "./visual-design";
import {
  deriveWorldModel,
  type GardenBird,
  type GardenDetail,
  type GardenGroundAnimal,
  type GardenWorldModel,
} from "./world-model";

export interface GardenSceneEvents {
  contextLost(): void;
  contextRestored(): void;
  interaction(kind: "orbit" | "reset"): void;
  performance(frameMilliseconds: number): void;
}

export interface GardenSceneController {
  update(state: GardenState): void;
  setActive(active: boolean): void;
  resetView(): void;
  diagnostics(): GardenRendererDiagnostics;
  dispose(): void;
}

export interface GardenRendererDiagnostics {
  direction: GardenVisualDirection["id"];
  dayPhase: GardenWorldModel["dayPhase"];
  orbitAngle: number;
  toneMappingExposure: number;
  hemisphereIntensity: number;
  sunIntensity: number;
  sunPosition: [number, number, number];
  fillIntensity: number;
  fillPosition: [number, number, number];
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  rebuildCount: number;
  context: "available" | "lost" | "disposed";
  effectivePixelRatio: number;
}

const baseCameraPosition = new THREE.Vector3(5.7, 4.4, 8.6);

export function createGardenScene(
  canvas: HTMLCanvasElement,
  initialState: GardenState,
  events: GardenSceneEvents,
  visualDirection: GardenVisualDirection,
): GardenSceneController {
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: true,
    depth: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });
  if (context === null) {
    throw new Error("WebGL2 is unavailable.");
  }

  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 60);

  let state = initialState;
  let visualSignature = gardenVisualSignature(state);
  let model = deriveWorldModel(state);
  let composition = cameraComposition(model, visualDirection);
  const initialVisual = resolveVisualModel(model, visualDirection);
  renderer.toneMappingExposure = initialVisual.exposure;

  const hemisphere = new THREE.HemisphereLight(
    initialVisual.hemisphereSkyColor,
    initialVisual.hemisphereGroundColor,
    initialVisual.hemisphereIntensity,
  );
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(initialVisual.sunColor, initialVisual.sunIntensity);
  sun.position.set(-4.5, 8.5, 5.5);
  sun.castShadow = true;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 24;
  sun.shadow.camera.left = -7;
  sun.shadow.camera.right = 7;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  sun.shadow.bias = -0.0007;
  scene.add(sun);
  const fill = new THREE.PointLight(
    initialVisual.fillColor,
    initialVisual.fillIntensity,
    18,
    2,
  );
  fill.position.set(...visualDirection.lighting.fillPosition);
  scene.add(fill);

  camera.position.copy(composition.position);
  camera.lookAt(composition.target);
  const skyDome = buildSkyDome(model, visualDirection);
  scene.add(skyDome);
  let world = buildWorld(model, visualDirection);
  scene.add(world.root);
  configureQuality(renderer, sun, model, visualDirection);
  configureAtmosphere(
    renderer,
    scene,
    skyDome,
    hemisphere,
    sun,
    fill,
    model,
    visualDirection,
  );

  let disposed = false;
  let animationFrame = 0;
  let lastRendered = 0;
  let measuredFrames = 0;
  let measuredMilliseconds = 0;
  let orbitAngle = 0;
  let contextIsLost = false;
  let renderingIsActive = true;
  let rebuildCount = 1;
  let revealStartedAt: number | undefined;
  let revealDuration = 0;
  let revealScale = 1;
  let viewportDistanceScale = 1;
  let pointerStart: { id: number; x: number; angle: number } | undefined;

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    viewportDistanceScale = camera.aspect < 0.72 ? 1 + (0.72 - camera.aspect) * 0.78 : 1;
    const radius = Math.hypot(composition.position.x, composition.position.z) * viewportDistanceScale;
    camera.position.x = Math.sin(orbitAngle + 0.585) * radius;
    camera.position.z = Math.cos(orbitAngle + 0.585) * radius;
    camera.position.y = composition.position.y;
    camera.lookAt(composition.target);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  const updateCamera = (): void => {
    const radius = Math.hypot(composition.position.x, composition.position.z) * viewportDistanceScale;
    camera.position.x = Math.sin(orbitAngle + 0.585) * radius;
    camera.position.z = Math.cos(orbitAngle + 0.585) * radius;
    camera.position.y = composition.position.y;
    camera.lookAt(composition.target);
  };

  const onPointerDown = (event: PointerEvent): void => {
    pointerStart = { id: event.pointerId, x: event.clientX, angle: orbitAngle };
    canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (pointerStart?.id !== event.pointerId) return;
    orbitAngle = THREE.MathUtils.clamp(
      pointerStart.angle + (event.clientX - pointerStart.x) * 0.004,
      -0.62,
      0.62,
    );
    updateCamera();
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (pointerStart?.id !== event.pointerId) return;
    if (Math.abs(event.clientX - pointerStart.x) > 4) events.interaction("orbit");
    pointerStart = undefined;
    canvas.releasePointerCapture(event.pointerId);
  };
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    if (contextIsLost) return;
    contextIsLost = true;
    events.contextLost();
  };
  const onContextRestored = (): void => {
    if (!contextIsLost) return;
    contextIsLost = false;
    renderer.resetState();
    lastRendered = 0;
    renderer.render(scene, camera);
    events.contextRestored();
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  const animate = (now: number): void => {
    if (disposed) return;
    animationFrame = requestAnimationFrame(animate);
    if (!renderingIsActive || document.hidden || contextIsLost) return;

    const targetFrameRate = state.reduceMotion ? 12 : state.qualityHint === "low" ? 30 : 60;
    const minimumFrameInterval = 1_000 / targetFrameRate;
    if (now - lastRendered < minimumFrameInterval) return;

    lastRendered = now;

    const renderStarted = performance.now();
    if (revealStartedAt !== undefined) {
      const progress = THREE.MathUtils.clamp((now - revealStartedAt) / revealDuration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const scale = THREE.MathUtils.lerp(revealScale, 1, eased);
      world.root.scale.setScalar(scale);
      world.root.position.y = THREE.MathUtils.lerp(-0.06, 0, eased);
      if (progress >= 1) revealStartedAt = undefined;
    }
    if (!state.reduceMotion) {
      const breeze = Math.sin(now * 0.00042) * model.windStrength;
      world.canopy.rotation.z = breeze * visualDirection.motion.canopyAmplitude;
      world.canopy.rotation.x = breeze * visualDirection.motion.canopyAmplitude * 0.42;
      world.particles.rotation.y = now * 0.000025 * visualDirection.motion.particleSpeed;
      animateBirds(world.birds, model, now);
      animateGroundWildlife(world.groundWildlife, now);
    }
    renderer.render(scene, camera);
    const frameMilliseconds = Math.min(100, performance.now() - renderStarted);
    measuredFrames += 1;
    measuredMilliseconds += frameMilliseconds;

    if (measuredFrames >= 120) {
      events.performance(measuredMilliseconds / measuredFrames);
      measuredFrames = 0;
      measuredMilliseconds = 0;
    }
  };
  renderer.render(scene, camera);
  animationFrame = requestAnimationFrame(animate);

  return {
    update(nextState): void {
      const previousState = state;
      state = nextState;
      const nextVisualSignature = gardenVisualSignature(state);
      if (nextVisualSignature === visualSignature) return;
      visualSignature = nextVisualSignature;
      model = deriveWorldModel(state);
      composition = cameraComposition(model, visualDirection);
      scene.remove(world.root);
      disposeObjectResources(world.root);
      world = buildWorld(model, visualDirection);
      rebuildCount += 1;
      scene.add(world.root);
      configureQuality(renderer, sun, model, visualDirection);
      configureAtmosphere(
        renderer,
        scene,
        skyDome,
        hemisphere,
        sun,
        fill,
        model,
        visualDirection,
      );
      updateCamera();
      const grew = state.microGrowthOrdinal > previousState.microGrowthOrdinal;
      if (!state.reduceMotion && grew) {
        const major = state.highestMilestone > previousState.highestMilestone;
        revealScale = major ? 0.93 : 0.978;
        revealDuration = major ? 1_050 : 620;
        revealStartedAt = performance.now();
        world.root.scale.setScalar(revealScale);
        world.root.position.y = -0.06;
      }
    },
    setActive(active): void {
      if (renderingIsActive === active) return;
      renderingIsActive = active;
      lastRendered = 0;
      if (active && !contextIsLost) renderer.render(scene, camera);
    },
    resetView(): void {
      orbitAngle = 0;
      updateCamera();
      events.interaction("reset");
    },
    diagnostics(): GardenRendererDiagnostics {
      const programs = renderer.info.programs?.length ?? 0;
      return {
        direction: visualDirection.id,
        dayPhase: model.dayPhase,
        orbitAngle,
        toneMappingExposure: renderer.toneMappingExposure,
        hemisphereIntensity: hemisphere.intensity,
        sunIntensity: sun.intensity,
        sunPosition: [sun.position.x, sun.position.y, sun.position.z],
        fillIntensity: fill.intensity,
        fillPosition: [fill.position.x, fill.position.y, fill.position.z],
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs,
        rebuildCount,
        context: disposed ? "disposed" : contextIsLost ? "lost" : "available",
        effectivePixelRatio: renderer.getPixelRatio(),
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      disposeObjectResources(world.root);
      disposeObjectResources(skyDome);
      renderer.dispose();
    },
  };
}

export function gardenVisualSignature(state: GardenState): string {
  const customization = Object.entries(state.activeCustomization)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify({
    gardenSeed: state.gardenSeed,
    totalQualifyingSeconds: state.totalQualifyingSeconds,
    journeyDay: state.journeyDay,
    highestMilestone: state.highestMilestone,
    activeCustomization: customization,
    microGrowthOrdinal: state.microGrowthOrdinal,
    localDayPhase: state.localDayPhase ?? "day",
    qualityHint: state.qualityHint,
  });
}

function cameraComposition(
  model: GardenWorldModel,
  direction: GardenVisualDirection,
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const maturity = THREE.MathUtils.clamp((model.trunkHeight - 0.52) / 3.7, 0, 1);
  const distanceScale = 0.7 + maturity * 0.72;
  return {
    position: new THREE.Vector3(
      baseCameraPosition.x * distanceScale * direction.composition.cameraDistanceScale,
      2.35 + maturity * 3.05 + direction.composition.cameraHeightOffset,
      baseCameraPosition.z * distanceScale * direction.composition.cameraDistanceScale,
    ),
    target: new THREE.Vector3(
      0,
      0.48 + maturity * 2.02 + direction.composition.targetHeightOffset,
      0,
    ),
  };
}

interface BuiltWorld {
  root: THREE.Group;
  canopy: THREE.Group;
  particles: THREE.Points;
  birds: THREE.Group;
  groundWildlife: THREE.Group;
}

function buildWorld(model: GardenWorldModel, direction: GardenVisualDirection): BuiltWorld {
  const root = new THREE.Group();
  root.name = "deterministic-garden-world";
  const visual = resolveVisualModel(model, direction);
  const groundTexture = createProceduralGroundTexture(direction.id);

  for (let layer = 0; layer < direction.composition.groundLayers; layer += 1) {
    const groundColor = new THREE.Color(visual.groundColor).offsetHSL(
      0,
      0,
      layer * (direction.foliageForm === "paper-relief" ? 0.028 : -0.014),
    );
    const ground = new THREE.Mesh(
      new THREE.CylinderGeometry(6.2 - layer * 0.11, 6.65 - layer * 0.06, 0.5, direction.foliageForm === "paper-relief" ? 40 : 64),
      new THREE.MeshStandardMaterial({
        color: groundColor,
        map: groundTexture,
        roughness: 1,
        metalness: 0,
        flatShading: direction.foliageForm !== "painted-botanical",
      }),
    );
    ground.position.y = -0.25 - layer * 0.07;
    ground.receiveShadow = true;
    root.add(ground);
  }

  const lightRing = new THREE.Mesh(
    new THREE.RingGeometry(1.8, 2.04, 64),
    new THREE.MeshBasicMaterial({ color: visual.accentColor, opacity: 0.42, transparent: true }),
  );
  lightRing.rotation.x = -Math.PI / 2;
  lightRing.position.y = 0.012;
  root.add(lightRing);

  const trunkGeometry = new THREE.CylinderGeometry(
    model.trunkRadius * 0.56,
    model.trunkRadius,
    model.trunkHeight,
    direction.foliageForm === "painted-botanical" ? 14 : 10,
  );
  const trunk = new THREE.Mesh(
    trunkGeometry,
    new THREE.MeshToonMaterial({ color: direction.palette.trunk }),
  );
  trunk.position.y = model.trunkHeight / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  root.add(trunk);

  const canopy = buildCanopy(model, visual.foliageColors, direction);
  root.add(canopy);
  const foliageAccents = buildFoliageAccents(model, visual.foliageColors, direction);
  if (foliageAccents !== null) root.add(foliageAccents);
  const branches = buildInstancedBranches(model, direction.palette.trunk);
  if (branches !== null) root.add(branches);

  const plantGeometry = groundPlantGeometry(direction.foliageForm);
  const plantMaterial = new THREE.MeshStandardMaterial({
    roughness: direction.foliageForm === "paper-relief" ? 1 : 0.86,
    metalness: 0,
    flatShading: true,
  });
  const plants = new THREE.InstancedMesh(plantGeometry, plantMaterial, model.groundPlants.length);
  const transform = new THREE.Object3D();
  model.groundPlants.forEach((plant, index) => {
    transform.position.set(plant.x, 0.16, plant.z);
    transform.scale.set(
      plant.scale * (direction.foliageForm === "twilight-silhouette" ? 0.7 : 0.86),
      plant.scale,
      plant.scale * (direction.foliageForm === "paper-relief" ? 0.38 : 0.72),
    );
    transform.rotation.y = index * 2.399963;
    transform.updateMatrix();
    plants.setMatrixAt(index, transform.matrix);
    plants.setColorAt(index, new THREE.Color(plant.color));
  });
  plants.instanceMatrix.needsUpdate = true;
  plants.receiveShadow = true;
  root.add(plants);

  const particlePositions = new Float32Array(model.quality.particleCount * 3);
  for (let index = 0; index < model.quality.particleCount; index += 1) {
    const angle = index * 2.399963;
    particlePositions[index * 3] = Math.cos(angle) * (1.8 + (index % 4) * 0.38);
    particlePositions[index * 3 + 1] = 0.7 + (index % 7) * 0.42;
    particlePositions[index * 3 + 2] = Math.sin(angle) * (1.2 + (index % 3) * 0.44);
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  const particleVisibility = visual.dayPhase === "day"
    ? 0.06
    : visual.dayPhase === "dawn"
    ? 0.2
    : visual.dayPhase === "dusk"
    ? 0.68
    : 1;
  const particles = new THREE.Points(
    particleGeometry,
    new THREE.PointsMaterial({
      color: visual.accentColor,
      opacity: direction.composition.particleOpacity * particleVisibility,
      size: direction.composition.particleSize,
      transparent: true,
    }),
  );
  root.add(particles);

  for (const detailObject of buildDetailObjects(model, direction)) {
    root.add(detailObject);
  }

  const birds = buildBirds(model);
  const groundWildlife = buildGroundWildlife(model);
  root.add(birds, groundWildlife);

  return { root, canopy, particles, birds, groundWildlife };
}

const instancedDetailKinds = new Set<GardenDetail["kind"]>([
  "stones",
  "undergrowth",
  "fireflies",
  "blossoms",
  "drifting-life",
  "clouds",
  "twilight-stars",
]);

function buildDetailObjects(
  model: GardenWorldModel,
  direction: GardenVisualDirection,
): THREE.Object3D[] {
  const visual = resolveVisualModel(model, direction);
  const details = model.details.filter((detail) => {
    if (detail.kind === "twilight-stars") return visual.starOpacity > 0.01;
    if (detail.kind === "fireflies") return false;
    return true;
  });
  const objects: THREE.Object3D[] = [];
  const roots = details.filter((detail) => detail.kind === "roots");
  if (roots.length > 0) {
    objects.push(
      buildInstancedCylinders(
        roots.map((detail) => ({
          start: new THREE.Vector3(0, 0.065, 0),
          end: new THREE.Vector3(detail.x, detail.y, detail.z),
          radius: 0.045 * detail.scale,
          color: resolveDetailColor(detail.color, detail.kind, direction),
        })),
      ),
    );
  }

  for (const kind of instancedDetailKinds) {
    const matching = details.filter((detail) => detail.kind === kind);
    if (matching.length > 0) {
      objects.push(buildInstancedDetailKind(kind, matching, direction, model));
    }
  }

  for (const detail of details) {
    if (detail.kind !== "roots" && !instancedDetailKinds.has(detail.kind)) {
      objects.push(buildDetail(detail, direction, model));
    }
  }
  return objects;
}

function buildInstancedBranches(
  model: GardenWorldModel,
  color: string,
): THREE.InstancedMesh | null {
  const segments = model.foliage.flatMap((cluster, index) =>
    index > 1 && index % 2 === 0
      ? [{
        start: new THREE.Vector3(0, model.trunkHeight * 0.56, 0),
        end: new THREE.Vector3(cluster.x * 0.76, cluster.y * 0.92, cluster.z * 0.76),
        radius: model.trunkRadius * 0.26,
        color,
      }]
      : [],
  );
  return segments.length > 0 ? buildInstancedCylinders(segments) : null;
}

function buildInstancedCylinders(
  segments: Array<{
    start: THREE.Vector3;
    end: THREE.Vector3;
    radius: number;
    color: string;
  }>,
): THREE.InstancedMesh {
  const geometry = new THREE.CylinderGeometry(0.7, 1, 1, 7);
  const material = new THREE.MeshToonMaterial({ color: "#ffffff" });
  const mesh = new THREE.InstancedMesh(geometry, material, segments.length);
  const transform = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  segments.forEach((segment, index) => {
    const vector = segment.end.clone().sub(segment.start);
    const length = vector.length();
    transform.position.copy(segment.start).add(segment.end).multiplyScalar(0.5);
    transform.quaternion.setFromUnitVectors(up, vector.normalize());
    transform.scale.set(segment.radius, length, segment.radius);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, new THREE.Color(segment.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  return mesh;
}

function buildInstancedDetailKind(
  kind: GardenDetail["kind"],
  details: GardenDetail[],
  direction: GardenVisualDirection,
  model: GardenWorldModel,
): THREE.Object3D {
  if (kind === "clouds") return buildCloudBanks(details, direction, model);
  const geometry = detailGeometry(kind);
  const material = detailMaterial(kind, model, direction);
  const mesh = new THREE.InstancedMesh(geometry, material, details.length);
  const transform = new THREE.Object3D();
  details.forEach((detail, index) => {
    transform.position.set(detail.x, detail.y, detail.z);
    transform.rotation.set(0, 0, 0);
    transform.scale.setScalar(detail.scale);
    switch (kind) {
    case "stones":
      transform.rotation.set(detail.rotation * 0.12, detail.rotation, detail.rotation * 0.08);
      transform.scale.set(detail.scale, detail.scale * 0.36, detail.scale * 0.72);
      break;
    case "undergrowth":
      transform.position.y += detail.scale * 0.28;
      transform.rotation.y = detail.rotation;
      transform.scale.set(detail.scale, detail.scale, detail.scale * 0.62);
      break;
    case "fireflies":
      transform.position.y += Math.sin(detail.rotation * 3) * 1.3;
      break;
    case "blossoms": break;
    case "drifting-life":
      transform.rotation.set(detail.rotation, detail.rotation * 0.4, detail.rotation * 0.2);
      break;
    case "sanctuary":
      transform.position.y += 1.4 + Math.abs(Math.cos(detail.rotation)) * 2.7;
      break;
    case "twilight-stars":
      break;
    default:
      throw new Error(`Unsupported instanced garden detail: ${kind}`);
    }
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(
      index,
      new THREE.Color(resolveDetailColor(detail.color, detail.kind, direction)),
    );
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = ["stones", "undergrowth", "blossoms", "sanctuary"].includes(kind);
  mesh.receiveShadow = kind === "stones";
  return mesh;
}

function buildCloudBanks(
  details: GardenDetail[],
  direction: GardenVisualDirection,
  model: GardenWorldModel,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "air-iii-authored-cloud-banks";
  const texture = createCloudBankTexture();
  const visual = resolveVisualModel(model, direction);
  const opacity = visual.dayPhase === "day" ? 0.34 : visual.dayPhase === "night" ? 0.13 : 0.22;
  for (const detail of details) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color: resolveDetailColor(detail.color, detail.kind, direction),
        transparent: true,
        opacity,
        depthWrite: false,
        rotation: detail.rotation * 0.22,
      }),
    );
    sprite.position.set(detail.x, detail.y, detail.z);
    sprite.scale.set(detail.scale * 3.2, detail.scale * 1.12, 1);
    group.add(sprite);
  }
  return group;
}

function createCloudBankTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 112;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Garden cloud texture context is unavailable.");
  context.shadowColor = "rgba(255, 255, 255, 0.42)";
  context.shadowBlur = 11;
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  context.beginPath();
  context.moveTo(24, 79);
  context.bezierCurveTo(31, 61, 51, 55, 70, 60);
  context.bezierCurveTo(78, 36, 106, 28, 127, 48);
  context.bezierCurveTo(143, 25, 181, 33, 184, 59);
  context.bezierCurveTo(207, 50, 230, 63, 232, 80);
  context.bezierCurveTo(190, 91, 67, 92, 24, 79);
  context.closePath();
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function detailGeometry(kind: GardenDetail["kind"]): THREE.BufferGeometry {
  switch (kind) {
  case "stones": return new THREE.DodecahedronGeometry(0.46, 0);
  case "undergrowth": return new THREE.ConeGeometry(0.34, 1.05, 6);
  case "fireflies": return new THREE.SphereGeometry(1, 7, 5);
  case "blossoms":
  case "sanctuary": return new THREE.DodecahedronGeometry(1, 0);
  case "drifting-life": return floatingLeafGeometry();
  case "clouds": return new THREE.SphereGeometry(1, 12, 7);
  case "twilight-stars": return new THREE.SphereGeometry(1, 6, 4);
  default: throw new Error(`Unsupported instanced garden detail: ${kind}`);
  }
}

function detailMaterial(
  kind: GardenDetail["kind"],
  model: GardenWorldModel,
  direction: GardenVisualDirection,
): THREE.Material {
  const visual = resolveVisualModel(model, direction);
  switch (kind) {
  case "fireflies":
    return new THREE.MeshBasicMaterial({ color: "#ffffff" });
  case "twilight-stars":
    return new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: visual.starOpacity,
      depthWrite: false,
    });
  case "clouds":
    return new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: visual.dayPhase === "day" ? 0.2 : visual.dayPhase === "night" ? 0.09 : 0.15,
      depthWrite: false,
    });
  case "drifting-life":
    return new THREE.MeshToonMaterial({ color: "#ffffff", side: THREE.DoubleSide });
  default:
    return new THREE.MeshToonMaterial({ color: "#ffffff" });
  }
}

function buildCanopy(
  model: GardenWorldModel,
  colors: string[],
  direction: GardenVisualDirection,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "hero-canopy";
  const leafCount = direction.foliageForm === "painted-botanical" ? 6 :
    direction.foliageForm === "paper-relief" ? 5 : 4;
  let geometry: THREE.BufferGeometry;
  if (direction.foliageForm === "paper-relief") {
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.72);
    shape.bezierCurveTo(0.72, -0.28, 0.76, 0.48, 0, 0.82);
    shape.bezierCurveTo(-0.76, 0.48, -0.72, -0.28, 0, -0.72);
    geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.055,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.025,
      bevelThickness: 0.018,
      curveSegments: 8,
      steps: 1,
    });
    geometry.center();
  } else {
    geometry = direction.foliageForm === "painted-botanical"
      ? new THREE.IcosahedronGeometry(1, 2)
      : new THREE.IcosahedronGeometry(1, 1);
  }
  const surfaceTexture = createProceduralSurfaceTexture(direction.id);
  const material = new THREE.MeshStandardMaterial({
    map: surfaceTexture,
    roughness: direction.foliageForm === "paper-relief" ? 1 : 0.9,
    metalness: 0,
    flatShading: direction.foliageForm !== "painted-botanical",
    side: direction.foliageForm === "paper-relief" ? THREE.DoubleSide : THREE.FrontSide,
  });
  const leaves = new THREE.InstancedMesh(geometry, material, model.foliage.length * leafCount);
  const cutEdges = direction.foliageForm === "paper-relief"
    ? new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: "#4c4a37", side: THREE.BackSide }),
      model.foliage.length * leafCount,
    )
    : null;
  const parent = new THREE.Object3D();
  const leaf = new THREE.Object3D();
  const matrix = new THREE.Matrix4();
  let instance = 0;
  for (const [clusterIndex, cluster] of model.foliage.entries()) {
    parent.position.set(cluster.x, cluster.y, cluster.z);
    parent.rotation.set(cluster.rotation * 0.08, cluster.rotation * 0.28, cluster.rotation * 0.05);
    parent.scale.setScalar(cluster.scale);
    parent.updateMatrix();
    for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
      const angle = leafIndex * 2.399963 + cluster.rotation * 0.12;
      const centeredLeafIndex = leafIndex - (leafCount - 1) / 2;
      const leafColor = new THREE.Color(colors[clusterIndex] ?? cluster.color).offsetHSL(
        centeredLeafIndex * 0.008,
        0,
        direction.foliageForm === "paper-relief"
          ? centeredLeafIndex * 0.038
          : direction.foliageForm === "painted-botanical"
          ? centeredLeafIndex * 0.022
          : -leafIndex * 0.018,
      );
      if (direction.foliageForm === "paper-relief") {
        leaf.position.set(
          centeredLeafIndex * 0.38,
          (leafIndex % 2) * 0.18,
          centeredLeafIndex * 0.13,
        );
        leaf.rotation.set(0, 0, centeredLeafIndex * 0.36);
        leaf.scale.set(0.9, 1.12, 1);
      } else {
        const radius = leafIndex === 0 ? 0 : 0.43;
        leaf.position.set(
          Math.cos(angle) * radius,
          Math.sin(angle * 0.7) * 0.2,
          Math.sin(angle) * radius * 0.55,
        );
        leaf.scale.set(
          direction.composition.canopyScale[0] * (leafIndex === 0 ? 0.78 : 0.62),
          direction.composition.canopyScale[1] * (leafIndex === 0 ? 0.92 : 0.72),
          direction.composition.canopyScale[2] * (leafIndex === 0 ? 0.82 : 0.64),
        );
        leaf.rotation.set(angle * 0.08, angle * 0.22, angle * 0.12);
      }
      leaf.updateMatrix();
      matrix.multiplyMatrices(parent.matrix, leaf.matrix);
      leaves.setMatrixAt(instance, matrix);
      leaves.setColorAt(instance, leafColor);
      if (cutEdges !== null) cutEdges.setMatrixAt(instance, matrix);
      instance += 1;
    }
  }
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor !== null) leaves.instanceColor.needsUpdate = true;
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  if (cutEdges !== null) {
    cutEdges.instanceMatrix.needsUpdate = true;
    group.add(cutEdges);
  }
  group.add(leaves);
  return group;
}

function buildFoliageAccents(
  model: GardenWorldModel,
  colors: string[],
  direction: GardenVisualDirection,
): THREE.InstancedMesh | null {
  if (direction.foliageForm === "paper-relief" || model.foliage.length === 0) return null;
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.52);
  shape.bezierCurveTo(0.34, -0.22, 0.38, 0.24, 0, 0.58);
  shape.bezierCurveTo(-0.38, 0.24, -0.34, -0.22, 0, -0.52);
  const geometry = new THREE.ShapeGeometry(shape, 6);
  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const countPerCluster = direction.foliageForm === "painted-botanical" ? 3 : 2;
  const accents = new THREE.InstancedMesh(
    geometry,
    material,
    model.foliage.length * countPerCluster,
  );
  const transform = new THREE.Object3D();
  let instance = 0;
  for (const [clusterIndex, cluster] of model.foliage.entries()) {
    for (let leafIndex = 0; leafIndex < countPerCluster; leafIndex += 1) {
      const angle = cluster.rotation + leafIndex * 2.399963;
      const radius = cluster.scale * (0.44 + leafIndex * 0.08);
      transform.position.set(
        cluster.x + Math.cos(angle) * radius,
        cluster.y + cluster.scale * (0.18 + leafIndex * 0.14),
        cluster.z + Math.sin(angle) * radius * 0.58,
      );
      transform.rotation.set(-0.18 + leafIndex * 0.12, angle + Math.PI / 2, angle * 0.18);
      const scale = cluster.scale * (direction.foliageForm === "painted-botanical" ? 0.34 : 0.28);
      transform.scale.set(scale * 0.72, scale, scale);
      transform.updateMatrix();
      accents.setMatrixAt(instance, transform.matrix);
      accents.setColorAt(
        instance,
        new THREE.Color(colors[clusterIndex] ?? cluster.color).offsetHSL(
          0,
          direction.foliageForm === "painted-botanical" ? 0.04 : -0.08,
          direction.foliageForm === "painted-botanical" ? 0.08 : 0.02,
        ),
      );
      instance += 1;
    }
  }
  accents.instanceMatrix.needsUpdate = true;
  if (accents.instanceColor !== null) accents.instanceColor.needsUpdate = true;
  accents.castShadow = true;
  return accents;
}

function createProceduralSurfaceTexture(
  direction: GardenVisualDirection["id"],
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Garden surface texture context is unavailable.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 128, 128);
  let randomState = direction === "verdant-atelier" ? 0x4a31b : direction === "paper-sanctuary" ? 0x8f21d : 0xc1743;
  const random = (): number => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 0xffff_ffff;
  };

  if (direction === "paper-sanctuary") {
    context.lineWidth = 0.65;
    for (let index = 0; index < 86; index += 1) {
      const y = random() * 128;
      context.strokeStyle = `rgba(108, 92, 65, ${0.018 + random() * 0.045})`;
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(34, y + random() * 3, 92, y - random() * 3, 128, y + random() * 2);
      context.stroke();
    }
    context.strokeStyle = "rgba(82, 73, 52, 0.12)";
    context.lineWidth = 1.1;
    context.beginPath();
    context.moveTo(64, 10);
    context.bezierCurveTo(60, 42, 69, 84, 64, 118);
    context.stroke();
  } else {
    const count = direction === "verdant-atelier" ? 120 : 72;
    for (let index = 0; index < count; index += 1) {
      const radius = 1 + random() * (direction === "verdant-atelier" ? 5 : 2.4);
      context.fillStyle = direction === "verdant-atelier"
        ? `rgba(67, 91, 48, ${0.015 + random() * 0.055})`
        : `rgba(223, 181, 105, ${0.01 + random() * 0.035})`;
      context.beginPath();
      context.ellipse(random() * 128, random() * 128, radius * 1.8, radius, random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
    if (direction === "verdant-atelier") {
      context.strokeStyle = "rgba(236, 244, 206, 0.1)";
      context.lineWidth = 1;
      for (let index = 0; index < 16; index += 1) {
        const x = random() * 128;
        const y = random() * 128;
        context.beginPath();
        context.moveTo(x - 8, y + 4);
        context.quadraticCurveTo(x, y - 4, x + 11, y - 6);
        context.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.8, 1.8);
  texture.needsUpdate = true;
  return texture;
}

function createProceduralGroundTexture(
  direction: GardenVisualDirection["id"],
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Garden ground texture context is unavailable.");
  context.fillStyle = "#f5f3e8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  let randomState = direction === "verdant-atelier" ? 0x72491 :
    direction === "paper-sanctuary" ? 0xb381d : 0x9a2f7;
  const random = (): number => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 0xffff_ffff;
  };
  const markCount = direction === "paper-sanctuary" ? 105 : 150;
  for (let index = 0; index < markCount; index += 1) {
    const alpha = direction === "twilight-refuge" ? 0.035 : 0.028 + random() * 0.042;
    context.fillStyle = direction === "twilight-refuge"
      ? `rgba(42, 57, 71, ${alpha})`
      : `rgba(88, 86, 57, ${alpha})`;
    context.beginPath();
    const radius = 0.7 + random() * (direction === "paper-sanctuary" ? 1.5 : 2.8);
    context.ellipse(
      random() * canvas.width,
      random() * canvas.height,
      radius * (1.4 + random()),
      radius,
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  if (direction === "paper-sanctuary") {
    context.strokeStyle = "rgba(94, 79, 55, 0.055)";
    context.lineWidth = 0.8;
    for (let row = 18; row < canvas.height; row += 24) {
      context.beginPath();
      context.moveTo(0, row);
      context.bezierCurveTo(48, row + 2, 132, row - 2, canvas.width, row + 1);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3.6, 3.6);
  texture.needsUpdate = true;
  return texture;
}

function groundPlantGeometry(form: GardenVisualDirection["foliageForm"]): THREE.BufferGeometry {
  switch (form) {
  case "painted-botanical":
    return new THREE.ConeGeometry(0.16, 0.72, 7);
  case "paper-relief":
    return new THREE.ConeGeometry(0.18, 0.74, 4);
  case "twilight-silhouette":
    return new THREE.ConeGeometry(0.14, 0.68, 6);
  }
}

function buildDetail(
  detail: GardenDetail,
  direction: GardenVisualDirection,
  model: GardenWorldModel,
): THREE.Object3D {
  const position = new THREE.Vector3(detail.x, detail.y, detail.z);
  const color = resolveDetailColor(detail.color, detail.kind, direction);
  switch (detail.kind) {
  case "roots": {
    const root = cylinderBetween(
      new THREE.Vector3(0, 0.065, 0),
      position,
      0.045 * detail.scale,
      color,
    );
    return root;
  }
  case "stones": {
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.46, 0),
      new THREE.MeshToonMaterial({ color }),
    );
    stone.position.copy(position);
    stone.rotation.set(detail.rotation * 0.12, detail.rotation, detail.rotation * 0.08);
    stone.scale.set(detail.scale, detail.scale * 0.36, detail.scale * 0.72);
    stone.castShadow = true;
    stone.receiveShadow = true;
    return stone;
  }
  case "undergrowth": {
    const plant = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 1.05, 6),
      new THREE.MeshToonMaterial({ color }),
    );
    plant.position.copy(position);
    plant.position.y += detail.scale * 0.28;
    plant.rotation.y = detail.rotation;
    plant.scale.set(detail.scale, detail.scale, detail.scale * 0.62);
    plant.castShadow = true;
    return plant;
  }
  case "stream": {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-5.4, 0.04, -1.8),
      new THREE.Vector3(-2.2, 0.045, -0.7),
      new THREE.Vector3(0.4, 0.05, 0.35),
      new THREE.Vector3(3.3, 0.045, 1.4),
      new THREE.Vector3(5.6, 0.04, 2.25),
    ]);
    const stream = new THREE.Mesh(
      streamRibbonGeometry(curve, 48, 0.34),
      new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: direction.composition.waterOpacity,
        roughness: 0.24,
        side: THREE.DoubleSide,
      }),
    );
    stream.rotation.y = detail.rotation * 0.18;
    stream.receiveShadow = true;
    return stream;
  }
  case "pond": {
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(1.45 * detail.scale, 48),
      new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: direction.composition.waterOpacity,
        roughness: 0.22,
      }),
    );
    pond.position.copy(position);
    pond.rotation.x = -Math.PI / 2;
    pond.receiveShadow = true;
    return pond;
  }
  case "ripples": {
    const ripple = new THREE.Mesh(
      new THREE.RingGeometry(detail.scale * 0.38, detail.scale * 0.43, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.64 }),
    );
    ripple.position.copy(position);
    ripple.rotation.x = -Math.PI / 2;
    return ripple;
  }
  case "warm-light": {
    const lightPatch = new THREE.Mesh(
      new THREE.RingGeometry(detail.scale * 0.35, detail.scale * 0.72, 36),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18 }),
    );
    lightPatch.position.copy(position);
    lightPatch.position.y = 0.03;
    lightPatch.rotation.x = -Math.PI / 2;
    return lightPatch;
  }
  case "fireflies": {
    const firefly = new THREE.Mesh(
      new THREE.SphereGeometry(detail.scale, 7, 5),
      new THREE.MeshBasicMaterial({ color }),
    );
    firefly.position.copy(position);
    firefly.position.y += Math.sin(detail.rotation * 3) * 1.3;
    return firefly;
  }
  case "blossoms": {
    const blossom = new THREE.Mesh(
      new THREE.DodecahedronGeometry(detail.scale, 0),
      new THREE.MeshToonMaterial({ color }),
    );
    blossom.position.copy(position);
    blossom.position.y += Math.abs(Math.sin(detail.rotation)) * 1.9;
    return blossom;
  }
  case "wind": {
    const ribbon = new THREE.Mesh(
      new THREE.TorusGeometry(detail.scale, 0.012, 5, 36, Math.PI * 1.25),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.34 }),
    );
    ribbon.position.copy(position);
    ribbon.rotation.set(Math.PI * 0.44, detail.rotation, detail.rotation * 0.08);
    return ribbon;
  }
  case "drifting-life": {
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(detail.scale, detail.scale * 1.7, 3),
      new THREE.MeshToonMaterial({ color, side: THREE.DoubleSide }),
    );
    leaf.position.copy(position);
    leaf.rotation.set(detail.rotation, detail.rotation * 0.4, detail.rotation * 0.2);
    return leaf;
  }
  case "clouds": {
    const cloud = new THREE.Mesh(
      new THREE.SphereGeometry(detail.scale, 12, 7),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    );
    cloud.position.copy(position);
    cloud.scale.set(1.9, 0.48, 0.72);
    return cloud;
  }
  case "twilight-stars": {
    const star = new THREE.Mesh(
      new THREE.SphereGeometry(detail.scale, 6, 4),
      new THREE.MeshBasicMaterial({ color }),
    );
    star.position.copy(position);
    return star;
  }
  case "moon": {
    const visual = resolveVisualModel(model, direction);
    const moon = new THREE.Group();
    moon.name = "space-ii-moon";
    const disc = new THREE.Mesh(
      new THREE.SphereGeometry(detail.scale, 18, 12),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.22,
        roughness: 1,
        metalness: 0,
        flatShading: true,
        transparent: true,
        opacity: visual.moonOpacity,
        depthWrite: false,
      }),
    );
    disc.rotation.set(0.16, detail.rotation, -0.08);
    disc.renderOrder = 1;
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createMoonHaloTexture(),
        color: visual.celestialGlowColor,
        transparent: true,
        opacity: visual.moonOpacity * 0.46,
        depthWrite: false,
      }),
    );
    halo.scale.setScalar(detail.scale * 3.25);
    halo.renderOrder = 0;
    moon.add(halo, disc);
    moon.position.copy(position);
    return moon;
  }
  case "sanctuary": {
    return buildGardenPavilion(detail, direction, model);
  }
  }
}

function createMoonHaloTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Garden moon halo texture context is unavailable.");
  const gradient = context.createRadialGradient(64, 64, 22, 64, 64, 62);
  gradient.addColorStop(0, "rgba(255, 246, 216, 0.16)");
  gradient.addColorStop(0.42, "rgba(255, 229, 178, 0.14)");
  gradient.addColorStop(0.72, "rgba(238, 188, 126, 0.055)");
  gradient.addColorStop(1, "rgba(238, 188, 126, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function buildGardenPavilion(
  detail: GardenDetail,
  direction: GardenVisualDirection,
  model: GardenWorldModel,
): THREE.Group {
  const pavilion = new THREE.Group();
  pavilion.name = "space-iii-open-timber-pavilion";
  const visual = resolveVisualModel(model, direction);
  const timber = new THREE.Color(detail.color).lerp(new THREE.Color("#5e493a"), 0.64);
  const timberMaterial = new THREE.MeshToonMaterial({ color: timber });
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(visual.groundColor).offsetHSL(0, -0.08, 0.14),
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const roofMaterial = new THREE.MeshToonMaterial({
    color: "#26353a",
  });

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.2, 1.56), stoneMaterial);
  plinth.position.y = 0.12;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  pavilion.add(plinth);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(2.18, 0.1, 1.3),
    new THREE.MeshToonMaterial({ color: timber.clone().offsetHSL(0, -0.04, 0.08) }),
  );
  floor.position.y = 0.27;
  floor.receiveShadow = true;
  pavilion.add(floor);

  const columnGeometry = new THREE.CylinderGeometry(0.065, 0.082, 1.38, 6);
  for (const x of [-0.88, 0, 0.88]) {
    for (const z of [-0.49, 0.49]) {
      const column = new THREE.Mesh(columnGeometry, timberMaterial);
      column.position.set(x, 0.98, z);
      column.castShadow = true;
      pavilion.add(column);
    }
  }

  for (const z of [-0.5, 0.5]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.1), timberMaterial);
    beam.position.set(0, 1.65, z);
    beam.castShadow = true;
    pavilion.add(beam);
  }
  for (const x of [-0.92, 0.92]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.18), timberMaterial);
    beam.position.set(x, 1.58, 0);
    beam.castShadow = true;
    pavilion.add(beam);
  }

  const roof = new THREE.Mesh(
    new THREE.CylinderGeometry(0.92, 1.68, 0.46, 4, 1, false),
    roofMaterial,
  );
  roof.position.y = 1.91;
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = 0.68;
  roof.castShadow = true;
  pavilion.add(roof);

  const eave = new THREE.Mesh(new THREE.BoxGeometry(2.72, 0.11, 1.72), roofMaterial);
  eave.position.y = 1.7;
  eave.castShadow = true;
  pavilion.add(eave);

  const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.075, 0.075), timberMaterial);
  ridge.position.y = 2.17;
  ridge.castShadow = true;
  pavilion.add(ridge);

  const interiorWarmth = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 0.72),
    new THREE.MeshBasicMaterial({
      color: visual.celestialGlowColor,
      transparent: true,
      opacity: visual.dayPhase === "day" ? 0.07 : 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  interiorWarmth.name = "pavilion-quiet-interior-warmth";
  interiorWarmth.position.set(0, 1.03, -0.53);
  pavilion.add(interiorWarmth);

  pavilion.position.set(detail.x, detail.y, detail.z);
  pavilion.rotation.y = detail.rotation;
  pavilion.scale.setScalar(detail.scale);
  return pavilion;
}

function floatingLeafGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.86);
  shape.bezierCurveTo(0.42, -0.38, 0.46, 0.34, 0, 0.92);
  shape.bezierCurveTo(-0.46, 0.34, -0.42, -0.38, 0, -0.86);
  return new THREE.ShapeGeometry(shape, 5);
}

function buildBirds(model: GardenWorldModel): THREE.Group {
  const flock = new THREE.Group();
  flock.name = "air-ii-bird-flock";
  for (const [index, bird] of model.birds.entries()) {
    const figure = new THREE.Group();
    figure.name = `garden-bird-${index + 1}`;
    const material = new THREE.MeshBasicMaterial({ color: bird.color, side: THREE.DoubleSide });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 5), material);
    body.scale.set(0.42, 0.15, 0.13);
    body.rotation.z = -0.08;
    figure.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 5), material);
    head.position.x = 0.48;
    figure.add(head);

    const beak = new THREE.Mesh(
      new THREE.ConeGeometry(0.075, 0.24, 5),
      new THREE.MeshBasicMaterial({ color: "#a48b59" }),
    );
    beak.position.x = 0.64;
    beak.rotation.z = -Math.PI / 2;
    figure.add(beak);

    const leftWing = buildBirdWing(1, material);
    leftWing.name = "bird-wing-left";
    leftWing.position.set(-0.08, 0.05, 0);
    figure.add(leftWing);
    const rightWing = buildBirdWing(-1, material);
    rightWing.name = "bird-wing-right";
    rightWing.position.set(-0.08, 0.05, 0);
    figure.add(rightWing);

    figure.scale.setScalar(bird.scale);
    placeBird(figure, bird, bird.phase);
    flock.add(figure);
  }
  return flock;
}

function placeBird(figure: THREE.Group, bird: GardenBird, phase: number): void {
  figure.position.set(
    Math.cos(phase) * bird.pathRadius,
    bird.height + Math.sin(phase * 2) * 0.22,
    Math.sin(phase) * bird.pathDepth - 0.7,
  );
  figure.rotation.y = -0.52 + Math.sin(phase) * 0.22;
  figure.rotation.z = Math.sin(phase * 2) * 0.08;
}

function animateBirds(flock: THREE.Group, model: GardenWorldModel, now: number): void {
  for (const [index, figure] of flock.children.entries()) {
    const bird = model.birds[index];
    if (!(figure instanceof THREE.Group) || bird === undefined) continue;
    const phase = bird.phase + now * 0.000075 * bird.speed;
    placeBird(figure, bird, phase);
    const flap = Math.sin(now * 0.0068 * bird.speed + bird.phase) * 0.28;
    const leftWing = figure.getObjectByName("bird-wing-left");
    const rightWing = figure.getObjectByName("bird-wing-right");
    if (leftWing !== undefined) leftWing.rotation.x = flap;
    if (rightWing !== undefined) rightWing.rotation.x = -flap;
  }
}

function buildBirdWing(side: 1 | -1, material: THREE.Material): THREE.Group {
  const wing = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([
      0, 0, 0,
      -0.04, 0.2, side * 0.48,
      -0.22, 0.38, side * 1.06,
      -0.44, 0.15, side * 0.76,
      -0.3, -0.045, side * 0.18,
    ], 3),
  );
  geometry.setIndex([0, 1, 4, 1, 2, 3, 1, 3, 4]);
  geometry.computeVertexNormals();
  wing.add(new THREE.Mesh(geometry, material));
  wing.rotation.x = side * 0.1;
  return wing;
}

function buildGroundWildlife(model: GardenWorldModel): THREE.Group {
  const wildlife = new THREE.Group();
  wildlife.name = "space-iii-grass-wildlife";
  for (const [index, animal] of model.groundAnimals.entries()) {
    const hare = buildHare(animal);
    hare.name = `garden-hare-${index + 1}`;
    hare.userData.motionPhase = index * 2.41 + animal.rotation;
    hare.userData.baseScale = animal.scale;
    wildlife.add(hare);
  }
  return wildlife;
}

function buildHare(animal: GardenGroundAnimal): THREE.Group {
  const hare = new THREE.Group();
  const material = new THREE.MeshToonMaterial({ color: animal.color });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), material);
  const haunch = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), material);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), material);
  const earGeometry = new THREE.SphereGeometry(1, 7, 5);

  if (animal.pose === "seated") {
    body.position.set(0, 0.38, 0);
    body.scale.set(0.25, 0.43, 0.23);
    haunch.position.set(-0.18, 0.23, 0);
    haunch.scale.set(0.34, 0.27, 0.29);
    head.position.set(0.02, 0.73, 0);
  } else {
    body.position.set(0, 0.27, 0);
    body.scale.set(0.41, 0.25, 0.24);
    haunch.position.set(-0.28, 0.25, 0);
    haunch.scale.set(0.3, 0.28, 0.28);
    head.position.set(0.38, 0.25, 0);
  }
  head.scale.set(0.2, 0.22, 0.2);
  hare.add(body, haunch, head);

  for (const [index, z] of [-0.075, 0.075].entries()) {
    const ear = new THREE.Mesh(earGeometry, material);
    ear.name = `hare-ear-${index + 1}`;
    ear.position.set(
      animal.pose === "seated" ? 0 : 0.39,
      animal.pose === "seated" ? 1.02 : 0.48,
      z,
    );
    ear.scale.set(0.07, 0.25, 0.055);
    ear.rotation.z = animal.pose === "seated" ? -0.08 + index * 0.12 : -0.72 + index * 0.1;
    hare.add(ear);
  }

  const tail = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 7, 5),
    new THREE.MeshToonMaterial({ color: "#a69b8b" }),
  );
  tail.position.set(-0.45, 0.32, 0);
  hare.add(tail);
  hare.position.set(animal.x, 0.08, animal.z);
  hare.rotation.y = animal.rotation;
  hare.scale.setScalar(animal.scale);
  hare.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  return hare;
}

function animateGroundWildlife(wildlife: THREE.Group, now: number): void {
  for (const child of wildlife.children) {
    if (!(child instanceof THREE.Group)) continue;
    const phase = Number(child.userData.motionPhase ?? 0);
    const baseScale = Number(child.userData.baseScale ?? 1);
    child.scale.set(baseScale, baseScale * (1 + Math.sin(now * 0.0011 + phase) * 0.012), baseScale);
    const ear = child.getObjectByName("hare-ear-2");
    if (ear !== undefined) ear.rotation.y = Math.sin(now * 0.0008 + phase) * 0.1;
  }
}

function cylinderBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  color = "#6a4d39",
): THREE.Mesh {
  const direction = end.clone().sub(start);
  const geometry = new THREE.CylinderGeometry(radius * 0.7, radius, direction.length(), 7);
  const branch = new THREE.Mesh(geometry, new THREE.MeshToonMaterial({ color }));
  branch.position.copy(start).add(end).multiplyScalar(0.5);
  branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  branch.castShadow = true;
  return branch;
}

function configureQuality(
  renderer: THREE.WebGLRenderer,
  sun: THREE.DirectionalLight,
  model: GardenWorldModel,
  direction: GardenVisualDirection,
): void {
  const visual = resolveVisualModel(model, direction);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, model.quality.pixelRatioLimit));
  sun.color.set(visual.sunColor);
  sun.intensity = visual.sunIntensity;
  sun.shadow.mapSize.set(model.quality.shadowMapSize, model.quality.shadowMapSize);
  if (sun.shadow.map !== null) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
}

function buildSkyDome(
  model: GardenWorldModel,
  direction: GardenVisualDirection,
): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const visual = resolveVisualModel(model, direction);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(visual.skyTopColor) },
      horizonColor: { value: new THREE.Color(visual.skyColor) },
      lowerColor: { value: new THREE.Color(visual.skyLowerColor) },
      glowColor: { value: new THREE.Color(visual.celestialGlowColor) },
      glowStrength: { value: visual.celestialGlowStrength },
      glowDirection: { value: new THREE.Vector3(-0.46, 0.34, -0.82).normalize() },
    },
    vertexShader: `
      varying float gardenHeight;
      varying vec3 gardenDirection;
      void main() {
        gardenDirection = normalize(position);
        gardenHeight = gardenDirection.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float gardenHeight;
      varying vec3 gardenDirection;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 lowerColor;
      uniform vec3 glowColor;
      uniform vec3 glowDirection;
      uniform float glowStrength;
      void main() {
        float upperMix = smoothstep(-0.02, 0.72, gardenHeight);
        float lowerMix = smoothstep(-0.45, 0.05, gardenHeight);
        vec3 horizonToTop = mix(horizonColor, topColor, upperMix);
        vec3 color = mix(lowerColor, horizonToTop, lowerMix);
        float horizonHaze = exp(-abs(gardenHeight) * 8.0) * 0.09;
        float glow = pow(max(dot(normalize(gardenDirection), glowDirection), 0.0), 42.0) * glowStrength;
        color = mix(color, horizonColor, horizonHaze);
        color += glowColor * glow;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(38, 32, 18), material);
  dome.name = "garden-sky-gradient";
  dome.frustumCulled = false;
  dome.renderOrder = -100;
  return dome;
}

function configureAtmosphere(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  skyDome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>,
  hemisphere: THREE.HemisphereLight,
  sun: THREE.DirectionalLight,
  fill: THREE.PointLight,
  model: GardenWorldModel,
  direction: GardenVisualDirection,
): void {
  const visual = resolveVisualModel(model, direction);
  renderer.toneMappingExposure = visual.exposure;
  hemisphere.color.set(visual.hemisphereSkyColor);
  hemisphere.groundColor.set(visual.hemisphereGroundColor);
  hemisphere.intensity = visual.hemisphereIntensity;
  sun.color.set(visual.sunColor);
  sun.intensity = visual.sunIntensity;
  fill.color.set(visual.fillColor);
  fill.intensity = visual.fillIntensity;
  scene.background = new THREE.Color(visual.fogColor);
  const topColor = shaderColorUniform(skyDome.material, "topColor");
  const horizonColor = shaderColorUniform(skyDome.material, "horizonColor");
  const lowerColor = shaderColorUniform(skyDome.material, "lowerColor");
  const glowColor = shaderColorUniform(skyDome.material, "glowColor");
  topColor.set(visual.skyTopColor);
  horizonColor.set(visual.skyColor);
  lowerColor.set(visual.skyLowerColor);
  glowColor.set(visual.celestialGlowColor);
  const glowStrength = skyDome.material.uniforms.glowStrength;
  if (glowStrength === undefined || typeof glowStrength.value !== "number") {
    throw new Error("Garden shader glow strength is unavailable.");
  }
  glowStrength.value = visual.celestialGlowStrength;
  scene.fog = new THREE.Fog(
    visual.fogColor,
    direction.lighting.fogNear,
    direction.lighting.fogFar,
  );
}

function shaderColorUniform(material: THREE.ShaderMaterial, name: string): THREE.Color {
  const value = material.uniforms[name]?.value;
  if (!(value instanceof THREE.Color)) {
    throw new Error(`Garden shader color uniform ${name} is unavailable.`);
  }
  return value;
}

function streamRibbonGeometry(
  curve: THREE.CatmullRomCurve3,
  segments: number,
  width: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const point = curve.getPoint(index / segments);
    const tangent = curve.getTangent(index / segments);
    const side = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize().multiplyScalar(width);
    positions.push(point.x + side.x, point.y, point.z + side.z);
    positions.push(point.x - side.x, point.y, point.z - side.z);
    if (index < segments) {
      const start = index * 2;
      indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function disposeObjectResources(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      geometries.add(object.geometry);
    }
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite)) return;
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}
