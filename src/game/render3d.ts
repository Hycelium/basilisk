import * as THREE from "three";
import { BUILD_RANGE, STARTER_GUARD_RANGE, WORLD_H, WORLD_W } from "./balance";
import { homeCameraFrame } from "./homeCamera";
import { mapBounds } from "./map";
import { cloneModel, ensureModelsLoaded, setSharedAnisotropy } from "./assets3d";
import type { Barricade, Building, GameState, Team, Unit } from "./types";
import {
  buildScenery,
  buildTerrain,
} from "./worldMesh";
import { buildKeepModel } from "./models/keep";
import { buildTree } from "./models/nature";
import { buildGoldMine } from "./models/mine";
import { animateUnit, buildPeonModel, buildUnitModel, setPeonGear } from "./models/units";
import {
  buildBallistaModel,
  buildBarracksModel,
  buildCatapultModel,
  buildHouseModel,
  buildWatchtowerModel,
} from "./models/buildings";



/** Map 2D sim coords (y down) â†’ Three.js XZ ground (Y up). Allocates â€” use only off the hot path. */
function to3(x: number, y: number, h = 0) {
  return new THREE.Vector3(x - WORLD_W / 2, h, y - WORLD_H / 2);
}

/** Allocation-free variant of to3 for per-frame placement. */
function setPos3(obj: { position: THREE.Vector3 }, x: number, y: number, h = 0) {
  obj.position.set(x - WORLD_W / 2, h, y - WORLD_H / 2);
}

type EntityKey = string;

export type QualityTier = "low" | "medium" | "high";
export type QualitySetting = "auto" | QualityTier;
export type TouchDragMode = "select" | "camera";

export interface QualityInfo {
  setting: QualitySetting;
  tier: QualityTier;
  fps: number;
}

const QUALITY_KEY = "roadkeep.quality";

const TIER_PROFILE: Record<
  QualityTier,
  { dpr: number; shadows: boolean; shadowMap: number; particles: number; fog: boolean; pointLights: boolean; shadowEvery: number }
> = {
  low: { dpr: 1.0, shadows: false, shadowMap: 1024, particles: 120, fog: false, pointLights: false, shadowEvery: 1 },
  medium: { dpr: 1.5, shadows: true, shadowMap: 1024, particles: 260, fog: true, pointLights: true, shadowEvery: 2 },
  high: { dpr: 2.0, shadows: true, shadowMap: 2048, particles: 420, fog: true, pointLights: true, shadowEvery: 1 },
};

export function loadQualitySetting(): QualitySetting {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    if (v === "low" || v === "medium" || v === "high" || v === "auto") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

export function isTouchDevice() {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarse || navigator.maxTouchPoints > 0;
}

/** Static capability guess â€” refined by frame-time sampling once the game runs. */
export function detectQualityTier(): QualityTier {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory ?? 0;
  const ua = nav.userAgent || "";
  const mobile =
    nav.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPadOS desktop UA
  if (mobile) {
    if (cores <= 4 || (memory > 0 && memory <= 3)) return "low";
    return "medium";
  }
  if (cores <= 4 || (memory > 0 && memory <= 4)) return "medium";
  return "high";
}

const MAX_COMMAND_LINES = 64;

/**
 * Three.js battlefield renderer â€” same public API as the old Canvas2D GameRenderer.
 * Simulation stays 2D; this is presentation only.
 */
export class GameRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private root = new THREE.Group();
  private staticRoot = new THREE.Group();
  private dynamicRoot = new THREE.Group();
  private commandLineRoot = new THREE.Group();
  private floatRoot = new THREE.Group();

  private entityMap = new Map<EntityKey, THREE.Object3D>();
  private animationMap = new Map<
    EntityKey,
    {
      mixer: THREE.AnimationMixer;
      clips: THREE.AnimationClip[];
      actions: Map<string, THREE.AnimationAction>;
      current?: string;
      root: THREE.Object3D;
      accum: number;
      frame: number;
    }
  >();
  private scratchLive = new Set<string>();
  private scratchIds = new Set<number>();
  private scratchPads = new Set<string>();
  // Pooled command-line visuals (updated in place, never re-created per frame)
  private commandLines: THREE.LineSegments;
  private commandLinePos: Float32Array;
  private commandLineCol: Float32Array;
  private rallyLine: THREE.Line;
  private rallyLinePos: Float32Array;
  private padMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private rangeRingFor = "";
  // Quality
  private qualitySetting: QualitySetting = "auto";
  private tier: QualityTier = "high";
  private detectedTier: QualityTier = "high";
  private autoDrops = 0;
  private frameSamples = 0;
  private frameAccum = 0;
  private frameCount = 0;
  private fpsEstimate = 60;
  private shadowFrame = 0;
  private onQualityChange: ((info: QualityInfo) => void) | null = null;
  private touchDragMode: TouchDragMode = "select";
  private pinchStartAngle = 0;
  private pinchCenter = { x: 0, y: 0 };
  private tmpV = new THREE.Vector3();
  private lastMapId = "";
  private worldGroup = new THREE.Group();
  private torchLights: THREE.PointLight[] = [];
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private rangeRing: THREE.Mesh | null = null;
  private floatSprites: { mesh: THREE.Sprite; life: number; id: number }[] = [];
  private floatIdSeen = new Set<number>();
  private knownUnits = new Map<number, { x: number; y: number; team: Team }>();
  private knownKeepFlash = { you: 0, foe: 0 };
  private knownKeepAttack = { you: 0, foe: 0 };
  private knownKick = new Map<number, number>();
  private knownCombatEvents = new Set<number>();
  private arrows: {
    mesh: THREE.Mesh;
    start: THREE.Vector3;
    end: THREE.Vector3;
    life: number;
    max: number;
  }[] = [];
  private wallClock = performance.now();
  private particles: {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    life: number;
    max: number;
    color: THREE.Color;
    size: number;
  }[] = [];
  private particleGeo = new THREE.BufferGeometry();
  private particleMat: THREE.PointsMaterial;
  private particlePoints: THREE.Points;
  /** Spherical orbit â€” pitch from Y (0=top-down, Ï€/2=horizon). */
  private camDist = 520;
  private camYaw = 0.12;
  private camPitch = 1.12; // ~64Â° from top â†’ proper RTS angle, not bird's-eye
  private camLook = new THREE.Vector3(0, 14, 240);
  private homeSide: Team = "you";
  /** Battlefield width in sim units. 3-road maps are wider than the default 400. */
  private mapWidth = WORLD_W;
  private readonly camDistMin = 280;
  private readonly camDistMax = 900;
  private readonly camPitchMin = 0.72;
  private readonly camPitchMax = 1.35;
  private camShake = new THREE.Vector3();
  private pointers = new Map<number, { x: number; y: number; ox: number; oy: number }>();
  private dragMode: "none" | "orbit" | "pan" | "pinch" | "select" = "none";
  private dragMoved = false;
  private pointerButton = 0;
  private pointerType = "mouse";
  private lastPtr = { x: 0, y: 0 };
  private pinchStartDist = 0;
  private pinchStartCamDist = 520;
  private suppressClick = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.qualitySetting = loadQualitySetting();
    this.detectedTier = detectQualityTier();
    this.tier = this.qualitySetting === "auto" ? this.detectedTier : this.qualitySetting;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // Antialias is fixed at context creation; low tier skips it entirely.
      antialias: this.tier !== "low",
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x6a90b8, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.55;

    this.camera = new THREE.PerspectiveCamera(42, 1, 5, 3200);
    this.scene.fog = new THREE.FogExp2(0x8eb4d0, 0.00055);
    this.scene.background = new THREE.Color(0x7aa0c0);

    this.hemi = new THREE.HemisphereLight(0xfff0e0, 0x6a8a70, 1.35);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.35);
    this.sun.position.set(60, 380, 220);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 1400;
    this.sun.shadow.camera.left = -420;
    this.sun.shadow.camera.right = 420;
    this.sun.shadow.camera.top = 620;
    this.sun.shadow.camera.bottom = -620;
    this.scene.add(this.sun);
    this.scene.add(new THREE.AmbientLight(0xc8d8f0, 0.85));
    const fill = new THREE.DirectionalLight(0xb0d0ff, 0.75);
    fill.position.set(-140, 120, -40);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffe8c0, 0.45);
    rim.position.set(40, 60, 300);
    this.scene.add(rim);

    this.scene.add(this.root);
    this.root.add(this.staticRoot);
    this.staticRoot.add(this.worldGroup);
    this.root.add(this.dynamicRoot);
    this.dynamicRoot.add(this.commandLineRoot);
    this.root.add(this.floatRoot);

    this.particleMat = new THREE.PointsMaterial({
      size: 3.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.particlePoints = new THREE.Points(this.particleGeo, this.particleMat);
    this.particlePoints.frustumCulled = false;
    this.root.add(this.particlePoints);
    this.allocateParticleBuffers(TIER_PROFILE.high.particles);

    // Pooled command lines: one LineSegments for all peon order lines, one dashed Line for rally.
    this.commandLinePos = new Float32Array(MAX_COMMAND_LINES * 2 * 3);
    this.commandLineCol = new Float32Array(MAX_COMMAND_LINES * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(this.commandLinePos, 3).setUsage(THREE.DynamicDrawUsage));
    lineGeo.setAttribute("color", new THREE.BufferAttribute(this.commandLineCol, 3).setUsage(THREE.DynamicDrawUsage));
    lineGeo.setDrawRange(0, 0);
    this.commandLines = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.58 }),
    );
    this.commandLines.frustumCulled = false;
    this.commandLineRoot.add(this.commandLines);
    this.rallyLinePos = new Float32Array(6);
    const rallyGeo = new THREE.BufferGeometry();
    rallyGeo.setAttribute("position", new THREE.BufferAttribute(this.rallyLinePos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rallyLine = new THREE.Line(rallyGeo, new THREE.LineDashedMaterial({ color: 0xffd475, dashSize: 5, gapSize: 3 }));
    this.rallyLine.frustumCulled = false;
    this.rallyLine.visible = false;
    this.commandLineRoot.add(this.rallyLine);

    this.buildSky();
    this.fitCamera();
    this.applyTier(this.tier, false);
    void ensureModelsLoaded().then(() => {
      // Force one remesh pass so trees/units upgrade to GLBs
      this.lastMapId = "";
    });
  }

  private rebuildBattlefield(state: GameState) {
    this.rebuildMapProps(state);
    this.lastMapId = state.mapId;
    this.knownUnits.clear();
    this.knownCombatEvents.clear();
    this.particles.length = 0;
    this.rangeRingFor = "";
    if (this.rangeRing) {
      this.dynamicRoot.remove(this.rangeRing);
      this.rangeRing.geometry.dispose();
      this.rangeRing = null;
    }
    for (const [k, obj] of [...this.entityMap]) {
      this.dynamicRoot.remove(obj);
      this.clearAnimation(k);
      this.entityMap.delete(k);
    }
  }

  private buildSky() {
    const skyGeo = new THREE.SphereGeometry(1400, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld).y;
          vec3 top = vec3(0.35, 0.55, 0.85);
          vec3 mid = vec3(0.55, 0.72, 0.92);
          vec3 hor = vec3(0.95, 0.78, 0.55);
          vec3 col = mix(hor, mid, smoothstep(-0.05, 0.25, h));
          col = mix(col, top, smoothstep(0.2, 0.75, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));
  }

  private fitCamera() {
    this.resetCamera();
  }

  /** Best default RTS framing — oblique, on the local keep's side of the map. */
  resetCamera() {
    const frame = homeCameraFrame(this.homeSide);
    // Pull back a little on wide maps so the outer roads start in view.
    this.camDist = frame.dist * Math.sqrt(Math.max(1, this.mapWidth / WORLD_W));
    this.camYaw = frame.yaw;
    this.camPitch = frame.pitch;
    this.camLook.set(frame.lookX, frame.lookY, frame.lookZ);
    this.applyCamera();
  }

  getHomeSide() {
    return this.homeSide;
  }

  /** North keep for the guest. Does not flip the map. */
  setHomeSide(team: Team) {
    this.homeSide = team;
    this.resetCamera();
  }

  zoomBy(factor: number) {
    this.camDist = THREE.MathUtils.clamp(this.camDist * factor, this.camDistMin, this.camDistMax);
    this.applyCamera();
  }

  /** Normalised zoom: 0 = closest, 1 = furthest. */
  getZoomT() {
    return (this.camDist - this.camDistMin) / (this.camDistMax - this.camDistMin);
  }

  setZoomT(t: number) {
    const k = THREE.MathUtils.clamp(t, 0, 1);
    this.camDist = this.camDistMin + (this.camDistMax - this.camDistMin) * k;
    this.applyCamera();
  }

  orbitBy(dx: number, dy: number) {
    this.camYaw -= dx * 0.0055;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.0045, this.camPitchMin, this.camPitchMax);
    this.applyCamera();
  }

  panBy(dx: number, dy: number) {
    // Pan relative to camera facing on the ground plane
    const forward = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const scale = this.camDist * 0.00145;
    this.camLook.addScaledVector(right, -dx * scale);
    this.camLook.addScaledVector(forward, -dy * scale);
    const panX = this.mapWidth / 2 - 40;
    this.camLook.x = THREE.MathUtils.clamp(this.camLook.x, -panX, panX);
    this.camLook.z = THREE.MathUtils.clamp(this.camLook.z, -400, 400);
    this.applyCamera();
  }

  private applyCamera() {
    const sp = Math.sin(this.camPitch);
    const cp = Math.cos(this.camPitch);
    this.camera.position.set(
      this.camLook.x + this.camDist * sp * Math.sin(this.camYaw),
      this.camLook.y + this.camDist * cp,
      this.camLook.z + this.camDist * sp * Math.cos(this.camYaw),
    );
    this.camera.position.add(this.camShake);
    this.camera.lookAt(this.camLook);
  }

  /** One-finger drag behaviour on touch devices: marquee select (default) or camera orbit. */
  setTouchDragMode(mode: TouchDragMode) {
    this.touchDragMode = mode;
  }

  getTouchDragMode() {
    return this.touchDragMode;
  }

  getDragMode() {
    return this.dragMode;
  }

  /** Cancel the pending tap for the current gesture (used after a long-press fires). */
  cancelTap() {
    this.suppressClick = true;
  }

  /** Returns true if this pointerdown should also fire a game click (short tap). */
  onPointerDown(ev: PointerEvent) {
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, ox: ev.clientX, oy: ev.clientY });
    this.pointerType = ev.pointerType;

    if (this.pointers.size === 2) {
      // Second finger: whatever was happening becomes a two-finger camera gesture
      // (pinch = zoom, drag = pan, twist = orbit).
      this.dragMode = "pinch";
      const pts = [...this.pointers.values()];
      this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.pinchStartCamDist = this.camDist;
      this.pinchStartAngle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      this.pinchCenter = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      this.suppressClick = true;
      this.dragMoved = true;
      return false;
    }
    if (this.pointers.size > 2) {
      this.suppressClick = true;
      return false;
    }

    this.dragMoved = false;
    this.suppressClick = false;
    this.pointerButton = ev.button;
    this.lastPtr = { x: ev.clientX, y: ev.clientY };

    // Middle / Alt = orbit immediately. Right-click is a command when tapped,
    // but promotes to orbit when dragged.
    if (ev.button === 1 || ev.altKey) {
      this.dragMode = "orbit";
      this.suppressClick = true;
    } else if (ev.shiftKey) {
      this.dragMode = "pan";
      this.suppressClick = true;
    } else {
      this.dragMode = "none"; // promote to select/orbit after move threshold
    }
    try {
      (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    } catch {
      /* ignore */
    }
    return false;
  }

  onPointerMove(ev: PointerEvent) {
    const prev = this.pointers.get(ev.pointerId);
    if (!prev) return;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, ox: prev.ox, oy: prev.oy });

    if (this.dragMode === "pinch") {
      if (this.pointers.size < 2) return;
      const pts = [...this.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.pinchStartDist > 1) {
        const ratio = this.pinchStartDist / Math.max(1, d);
        this.camDist = THREE.MathUtils.clamp(this.pinchStartCamDist * ratio, this.camDistMin, this.camDistMax);
      }
      // Twist â†’ yaw orbit
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      let dAngle = angle - this.pinchStartAngle;
      if (dAngle > Math.PI) dAngle -= Math.PI * 2;
      if (dAngle < -Math.PI) dAngle += Math.PI * 2;
      if (Math.abs(dAngle) > 0.004) {
        this.camYaw -= dAngle;
        this.pinchStartAngle = angle;
      }
      // Centroid drift â†’ pan
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const pdx = cx - this.pinchCenter.x;
      const pdy = cy - this.pinchCenter.y;
      this.pinchCenter = { x: cx, y: cy };
      if (Math.abs(pdx) > 0.1 || Math.abs(pdy) > 0.1) this.panBy(pdx, pdy);
      this.applyCamera();
      this.dragMoved = true;
      this.suppressClick = true;
      return;
    }

    const dx = ev.clientX - this.lastPtr.x;
    const dy = ev.clientY - this.lastPtr.y;
    this.lastPtr = { x: ev.clientX, y: ev.clientY };

    if (this.dragMode === "none") {
      const touch = this.pointerType !== "mouse";
      const threshold = touch ? 8 : 2;
      // Total travel from pointerdown — last-frame dx is too small to promote a slow finger drag.
      const travel = Math.hypot(ev.clientX - prev.ox, ev.clientY - prev.oy);
      if (travel <= threshold) return;
      if (touch) {
        this.dragMode = this.touchDragMode === "select" ? "select" : "orbit";
      } else {
        this.dragMode = this.pointerButton === 0 ? "select" : "orbit";
      }
      this.suppressClick = true;
      this.dragMoved = true;
    }

    if (this.dragMode === "orbit") {
      this.orbitBy(dx, dy);
      this.dragMoved = true;
      this.suppressClick = true;
    } else if (this.dragMode === "pan") {
      this.panBy(dx, dy);
      this.dragMoved = true;
      this.suppressClick = true;
    } else if (this.dragMode === "select") {
      this.dragMoved = true;
      this.suppressClick = true;
    }
  }

  /** Returns true if the gesture was a tap and should select/build. */
  onPointerUp(ev: PointerEvent): boolean {
    this.pointers.delete(ev.pointerId);
    const wasTap = !this.suppressClick && !this.dragMoved && this.dragMode === "none";
    if (this.pointers.size < 2 && this.dragMode === "pinch") {
      // Lifting one finger of a pinch must not turn the remaining finger into a select/orbit.
      this.dragMode = "none";
      this.suppressClick = true;
      this.dragMoved = true;
      const rest = this.pointers.values().next().value as { x: number; y: number } | undefined;
      if (rest) this.lastPtr = { x: rest.x, y: rest.y };
    }
    if (this.pointers.size === 0) {
      this.dragMode = "none";
      this.dragMoved = false;
      this.suppressClick = false;
    }
    return wasTap;
  }

  // ---------------------------------------------------------------- quality

  onQuality(cb: ((info: QualityInfo) => void) | null) {
    this.onQualityChange = cb;
    cb?.(this.getQualityInfo());
  }

  getQualityInfo(): QualityInfo {
    return { setting: this.qualitySetting, tier: this.tier, fps: Math.round(this.fpsEstimate) };
  }

  setQuality(setting: QualitySetting) {
    this.qualitySetting = setting;
    try {
      localStorage.setItem(QUALITY_KEY, setting);
    } catch {
      /* ignore */
    }
    this.autoDrops = 0;
    this.frameAccum = 0;
    this.frameCount = 0;
    this.frameSamples = 0;
    this.applyTier(setting === "auto" ? this.detectedTier : setting, true);
  }

  private applyTier(tier: QualityTier, notify: boolean) {
    const profile = TIER_PROFILE[tier];
    const prev = this.tier;
    this.tier = tier;
    this.renderer.shadowMap.enabled = profile.shadows;
    this.renderer.shadowMap.autoUpdate = profile.shadowEvery <= 1;
    if (this.sun.castShadow !== profile.shadows) this.sun.castShadow = profile.shadows;
    if (this.sun.shadow.mapSize.x !== profile.shadowMap) {
      this.sun.shadow.mapSize.set(profile.shadowMap, profile.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.fog = profile.fog ? new THREE.FogExp2(0x8eb4d0, 0.00055) : null;
    for (const light of this.torchLights) light.visible = profile.pointLights;
    if (this.particles.length > profile.particles) this.particles.length = profile.particles;
    if (prev !== tier) {
      // Shadow/fog toggles need shader recompiles.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
        else m.needsUpdate = true;
      });
    }
    // Filtering only. Albedo maps stay on the shared colormap.
    setSharedAnisotropy(tier === "low" ? 1 : tier === "medium" ? 4 : 8);
    this.resize();
    if (notify) this.onQualityChange?.(this.getQualityInfo());
  }

  /** Rolling frame-time monitor; in Auto mode steps the tier down when the device can't keep up. */
  private sampleFrame(dtMs: number) {
    if (dtMs > 250) return; // tab was hidden / debugger paused
    this.frameSamples++;
    if (this.frameSamples < 30) return; // warm-up (shader compiles, first asset uploads)
    this.frameAccum += dtMs;
    this.frameCount++;
    if (this.frameAccum < 2000) return;
    const avg = this.frameAccum / this.frameCount;
    this.fpsEstimate = 1000 / Math.max(1, avg);
    this.frameAccum = 0;
    this.frameCount = 0;
    if (this.qualitySetting !== "auto" || this.autoDrops >= 2) return;
    if (avg > 22 && this.tier !== "low") {
      this.autoDrops++;
      this.applyTier(this.tier === "high" ? "medium" : "low", true);
    }
  }

  onWheel(ev: WheelEvent) {
    ev.preventDefault();
    const factor = ev.deltaY > 0 ? 1.08 : 0.92;
    this.zoomBy(factor);
  }

  private allocateParticleBuffers(cap: number) {
    const positions = new Float32Array(cap * 3);
    const colors = new Float32Array(cap * 3);
    this.particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.particleGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.particleGeo.setDrawRange(0, 0);
  }

  private burst(x: number, y: number, h: number, color: number, count: number, speed = 40) {
    const cap = TIER_PROFILE[this.tier].particles;
    // Scale burst density with tier so low-end devices don't pay for bursts they'll clip anyway.
    if (this.tier === "low") count = Math.max(2, Math.round(count * 0.4));
    else if (this.tier === "medium") count = Math.max(3, Math.round(count * 0.7));
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const elev = Math.random() * 0.9 + 0.2;
      const sp = speed * (0.4 + Math.random());
      this.particles.push({
        pos: to3(x, y, h),
        vel: new THREE.Vector3(Math.cos(a) * sp, elev * sp, Math.sin(a) * sp),
        life: 0.35 + Math.random() * 0.45,
        max: 0.8,
        color: c.clone(),
        size: 2 + Math.random() * 3,
      });
    }
    if (this.particles.length > cap) this.particles.splice(0, this.particles.length - cap);
  }

  private shootArrow(fromX: number, fromY: number, toX: number, toY: number, spread: number, startH = 12) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 5.5, 5),
      new THREE.MeshStandardMaterial({ color: 0x6b3d1f, roughness: 0.7 }),
    );
    const start = to3(fromX + spread, fromY, startH);
    const end = to3(toX, toY, 7);
    const direction = end.clone().sub(start).normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    mesh.position.copy(start);
    this.dynamicRoot.add(mesh);
    this.arrows.push({ mesh, start, end, life: 0.5, max: 0.5 });
  }

  private syncCombatFx(state: GameState, dt: number) {
    // Unit deaths â€” use cached last positions (syncUnits may already have pruned meshes)
    const live = this.scratchIds;
    live.clear();
    for (const u of state.units) live.add(u.id);
    for (const [id, last] of this.knownUnits) {
      if (!live.has(id)) {
        this.burst(last.x, last.y, 8, last.team === "you" ? 0x88c8ff : 0xff8866, 16, 58);
      }
    }
    this.knownUnits.clear();
    for (const u of state.units) this.knownUnits.set(u.id, { x: u.pos.x, y: u.pos.y, team: u.team });

    for (const event of state.combatEvents) {
      if (this.knownCombatEvents.has(event.id)) continue;
      this.knownCombatEvents.add(event.id);
      const hit = event.target ?? event.pos;
      if (event.kind === "arrow" && event.target) {
        this.shootArrow(event.pos.x, event.pos.y, event.target.x, event.target.y, 0);
      } else if (event.kind === "meleeHit") {
        this.burst(hit.x, hit.y, 7, 0xffd48a, 7, 34);
      } else if (event.kind === "ramImpact" || event.kind === "keepImpact") {
        this.burst(hit.x, hit.y, 8, 0xe8b66b, event.kind === "ramImpact" ? 22 : 13, 62);
      } else if (event.kind === "woodHit") {
        this.burst(hit.x, hit.y, 6, 0xa86b32, 9, 42);
      } else if (event.kind === "woodBreak") {
        this.burst(hit.x, hit.y, 7, 0xc48645, 32, 76);
      } else if (event.kind === "buildComplete") {
        this.burst(hit.x, hit.y, 7, 0xffdb7d, 18, 44);
      }
    }

    // Keep hits
    for (const team of ["you", "foe"] as Team[]) {
      const flash = state.keeps[team].hitFlash;
      if (flash > 0 && this.knownKeepFlash[team] <= 0) {
        const k = state.keeps[team];
        this.burst(k.pos.x, k.pos.y, 18, team === "you" ? 0x66aaff : 0xff5577, 22, 70);
      }
      this.knownKeepFlash[team] = flash;

      const keep = state.keeps[team];
      const attack = keep.attackFlash;
      const target = keep.attackTarget;
      if (attack > 0 && this.knownKeepAttack[team] <= 0 && target) {
        const occupants = state.villagers.filter(
          (v) => v.team === team && v.state === "garrisoned",
        ).length;
        const arrows = Math.min(3, Math.max(1, Math.ceil(occupants / 2)));
        for (let i = 0; i < arrows; i++) {
          this.shootArrow(keep.pos.x, keep.pos.y, target.x, target.y, (i - (arrows - 1) / 2) * 3, 25);
        }
      }
      this.knownKeepAttack[team] = attack;
    }

    // Tower / catapult kick
    for (const b of state.buildings) {
      const prev = this.knownKick.get(b.id) ?? 0;
      if (b.animKick > 0 && prev <= 0) {
        const col = b.kind === "catapult" ? 0xffcc66 : 0xaad4ff;
        this.burst(b.pos.x, b.pos.y, 16, col, b.kind === "catapult" ? 18 : 10, 48);
      }
      this.knownKick.set(b.id, b.animKick);
    }

    // Integrate particles (in-place compaction, no per-frame array churn)
    let write = 0;
    const particles = this.particles;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y -= 60 * dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;
      particles[write++] = p;
    }
    particles.length = write;

    let arrowWrite = 0;
    for (let i = 0; i < this.arrows.length; i++) {
      const arrow = this.arrows[i];
      arrow.life -= dt;
      const t = Math.min(1, 1 - arrow.life / arrow.max);
      arrow.mesh.position.lerpVectors(arrow.start, arrow.end, t);
      arrow.mesh.position.y += Math.sin(t * Math.PI) * 18;
      if (arrow.life > 0) {
        this.arrows[arrowWrite++] = arrow;
        continue;
      }
      this.dynamicRoot.remove(arrow.mesh);
      arrow.mesh.geometry.dispose();
      (arrow.mesh.material as THREE.Material).dispose();
    }
    this.arrows.length = arrowWrite;

    const posAttr = this.particleGeo.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = this.particleGeo.getAttribute("color") as THREE.BufferAttribute;
    const positions = posAttr.array as Float32Array;
    const colors = colAttr.array as Float32Array;
    const n = Math.min(particles.length, posAttr.count);
    for (let i = 0; i < n; i++) {
      const p = particles[i];
      const fade = Math.max(0, p.life / p.max);
      positions[i * 3] = p.pos.x;
      positions[i * 3 + 1] = p.pos.y;
      positions[i * 3 + 2] = p.pos.z;
      colors[i * 3] = p.color.r * fade;
      colors[i * 3 + 1] = p.color.g * fade;
      colors[i * 3 + 2] = p.color.b * fade;
    }
    this.particleGeo.setDrawRange(0, n);
    this.particlePoints.visible = n > 0;
    if (n > 0) {
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }
  }

  private updateCamera(state: GameState) {
    if (state.shake > 0) {
      this.camShake.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 4);
    } else {
      this.camShake.set(0, 0, 0);
    }
    this.applyCamera();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(TIER_PROFILE[this.tier].dpr, window.devicePixelRatio || 1);
    if (this.renderer.getPixelRatio() !== dpr) this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = h > w ? 44 : 40;
    this.camera.updateProjectionMatrix();
    this.applyCamera();
  }

  screenToWorld(screenX: number, screenY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = (screenX / Math.max(1, rect.width)) * 2 - 1;
    this.pointer.y = -(screenY / Math.max(1, rect.height)) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    if (!hit) return { x: WORLD_W / 2, y: WORLD_H / 2 };
    return {
      x: hit.x + WORLD_W / 2,
      y: hit.z + WORLD_H / 2,
    };
  }

  draw(state: GameState) {
    const now = performance.now();
    const rawMs = now - this.wallClock;
    const step = Math.min(0.05, Math.max(0.008, rawMs / 1000));
    this.wallClock = now;
    this.sampleFrame(rawMs);

    if (state.mapId !== this.lastMapId) {
      this.rebuildBattlefield(state);
    }
    // FX before prune so deaths still have last-known sim coords
    this.syncCombatFx(state, step);
    this.syncKeeps(state);
    this.syncBuildings(state);
    this.syncPads(state);
    this.syncNodes(state);
    this.syncBarricades(state);
    this.syncUnits(state);
    this.syncVillagers(state);
    this.syncCommandViz(state);
    this.updateAnimations(step);
    this.syncSelectionRing(state);
    this.syncFloats(state);
    this.pulseTorches(state.time);
    this.updateCamera(state);

    this.sun.intensity = 2.25 + Math.sin(state.time * 0.35) * 0.1;
    this.hemi.intensity = 1.3 + Math.sin(state.time * 0.22) * 0.05;

    const profile = TIER_PROFILE[this.tier];
    if (profile.shadows && profile.shadowEvery > 1) {
      this.shadowFrame = (this.shadowFrame + 1) % profile.shadowEvery;
      if (this.shadowFrame === 0) this.renderer.shadowMap.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** Mixers near the camera tick every frame; distant ones at half/third rate (accumulated dt). */
  private updateAnimations(step: number) {
    const nearSq = this.tier === "high" ? 520 * 520 : this.tier === "medium" ? 380 * 380 : 260 * 260;
    const farInterval = this.tier === "low" ? 3 : 2;
    const baseInterval = this.tier === "low" ? 2 : 1;
    const cam = this.camera.position;
    for (const animated of this.animationMap.values()) {
      animated.accum += step;
      animated.frame++;
      const p = animated.root.getWorldPosition(this.tmpV);
      const dx = p.x - cam.x;
      const dy = p.y - cam.y;
      const dz = p.z - cam.z;
      const far = dx * dx + dy * dy + dz * dz > nearSq;
      const interval = far ? farInterval : baseInterval;
      if (animated.frame % interval !== 0) continue;
      animated.mixer.update(animated.accum);
      animated.accum = 0;
    }
  }

  private rebuildMapProps(state: GameState) {
    // Drop previous world (avoid disposing shared GLB materials)
    while (this.worldGroup.children.length) {
      this.worldGroup.remove(this.worldGroup.children[0]);
    }
    this.torchLights = [];
    const seed = this.hashMapSeed(state.mapId);
    this.worldGroup.add(buildTerrain(seed));
    this.worldGroup.add(buildScenery(seed));
    const width = mapBounds(seed).width;
    if (width !== this.mapWidth) {
      this.mapWidth = width;
      this.resetCamera();
    }
  }

  private hashMapSeed(mapId: string) {
    const m = /^seed-(\d+)$/.exec(mapId);
    if (m) return Number(m[1]) >>> 0;
    let h = 2166136261;
    for (let i = 0; i < mapId.length; i++) {
      h ^= mapId.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private ensure(key: EntityKey, factory: () => THREE.Object3D) {
    let obj = this.entityMap.get(key);
    if (!obj) {
      obj = factory();
      this.entityMap.set(key, obj);
      this.dynamicRoot.add(obj);
    }
    obj.visible = true;
    return obj;
  }

  private liveSet() {
    this.scratchLive.clear();
    return this.scratchLive;
  }

  private clearAnimation(key: EntityKey) {
    const animated = this.animationMap.get(key);
    if (!animated) return;
    animated.mixer.stopAllAction();
    animated.mixer.uncacheRoot(animated.mixer.getRoot());
    this.animationMap.delete(key);
  }

  private prune(prefix: string, live: Set<string>) {
    for (const [k, obj] of this.entityMap) {
      if (!k.startsWith(prefix)) continue;
      if (!live.has(k)) {
        this.dynamicRoot.remove(obj);
        this.clearAnimation(k);
        this.entityMap.delete(k);
      }
    }
  }

  private makeKeep(team: Team) {
    const g = new THREE.Group();
    const keep = buildKeepModel(team);
    // Gate faces the enemy: player keep sits at +z, foe at -z.
    if (team === "you") keep.rotation.y = Math.PI;
    g.add(keep);
    const light = new THREE.PointLight(0xffaa55, 1.6, 110, 2);
    light.position.set(-16, 28, 14);
    light.visible = TIER_PROFILE[this.tier].pointLights;
    g.add(light);
    this.torchLights.push(light);
    const light2 = light.clone();
    light2.position.set(16, 28, 14);
    light2.visible = light.visible;
    g.add(light2);
    this.torchLights.push(light2);
    return g;
  }

  private syncKeeps(state: GameState) {
    const live = this.liveSet();
    for (const team of ["you", "foe"] as Team[]) {
      const key = `keep-${team}`;
      live.add(key);
      const obj = this.ensure(key, () => this.makeKeep(team));
      const k = state.keeps[team];
      setPos3(obj, k.pos.x, k.pos.y, 0);
      if (k.hitFlash > 0) obj.scale.setScalar(1.04);
      else obj.scale.setScalar(1);
    }
    this.prune("keep-", live);
  }

  private makeBuilding(kind: Building["kind"], team: Team) {
    if (kind === "watchtower") return buildWatchtowerModel(team);
    if (kind === "ballista") return buildBallistaModel(team);
    if (kind === "catapult") return buildCatapultModel(team);
    if (kind === "house") return buildHouseModel(team);
    return buildBarracksModel(team);
  }

  private syncBuildings(state: GameState) {
    const live = this.liveSet();
    for (const b of state.buildings) {
      const key = `bld-${b.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const built = this.makeBuilding(b.kind, b.team);
        built.userData.arm = built.getObjectByName("arm") ?? null;
        return built;
      });
      setPos3(obj, b.pos.x, b.pos.y, 0);
      const arm = obj.userData.arm as THREE.Object3D | null;
      if (arm && b.animKick > 0) arm.rotation.z = -0.8 * (b.animKick / 0.15);
      else if (arm) arm.rotation.z = 0;
    }
    this.prune("bld-", live);
  }

  private padMaterial(zone: string, team: Team) {
    const id = `${zone}-${team}`;
    let mat = this.padMaterials.get(id);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: zone === "eco" ? 0xc6f06a : team === "you" ? 0x7fd4ff : 0xff6a78,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this.padMaterials.set(id, mat);
    }
    return mat;
  }

  private syncPads(state: GameState) {
    const live = this.liveSet();
    const occupied = this.scratchPads;
    occupied.clear();
    for (const b of state.buildings) if (b.padId) occupied.add(b.padId);
    for (const p of state.pads) {
      if (occupied.has(p.id)) continue;
      const key = `pad-${p.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const inner = p.zone === "eco" ? 8.5 : 9.5;
        const outer = p.zone === "eco" ? 14.5 : 16;
        const color = this.padMaterial(p.zone, p.team).color;
        const ringMat = this.padMaterial(p.zone, p.team).clone();
        const glowMat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
        const g = new THREE.Group();
        g.renderOrder = 30;
        const glow = new THREE.Mesh(new THREE.RingGeometry(inner - 2.2, outer + 3, 40), glowMat);
        glow.rotation.x = -Math.PI / 2;
        glow.name = "glow";
        glow.renderOrder = 30;
        const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 40), ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.name = "ring";
        ring.renderOrder = 31;
        g.add(glow, ring);
        return g;
      });
      setPos3(obj, p.pos.x, p.pos.y, 1.2);
      const pulse = state.buildSelection && p.team === state.commandTeam ? 0.92 + Math.sin(state.time * 5) * 0.08 : 0.82;
      const ecoSel = state.buildSelection === "house";
      const match =
        p.zone === "eco"
          ? ecoSel || !state.buildSelection
          : state.buildSelection !== "house" || !state.buildSelection;
      const ringOp = match ? pulse : 0.55;
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
        if (!mat || mat.opacity == null) return;
        mat.opacity = mesh.name === "glow" ? ringOp * 0.42 : ringOp;
      });
    }
    this.prune("pad-", live);
  }

  private resourceBeacon(label: string, color: number) {
    const g = new THREE.Group();
    g.name = "beacon";
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(11, 14.5, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.8;
    ring.name = "marker";
    g.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 1.1, 28, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    beam.position.y = 16;
    beam.name = "beam";
    g.add(beam);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1a1208";
    ctx.fillRect(8, 8, 240, 48);
    ctx.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, 240, 48);
    ctx.fillStyle = "#fff6d8";
    ctx.font = "bold 36px Georgia";
    ctx.textAlign = "center";
    ctx.fillText(label, 128, 44);
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }),
    );
    spr.scale.set(22, 5.5, 1);
    spr.position.y = 34;
    spr.name = "label";
    g.add(spr);
    return g;
  }

  private syncNodes(state: GameState) {
    const live = this.liveSet();
    for (const n of state.nodes) {
      const key = `node-${this.homeSide}-${n.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const g = this.makeNode(n);
        g.userData.canopy = g.getObjectByName("canopy") ?? null;
        g.userData.beam = g.getObjectByName("beam") ?? null;
        g.userData.label = g.getObjectByName("label") ?? null;
        g.userData.marker = g.getObjectByName("marker") ?? null;
        return g;
      });
      setPos3(obj, n.pos.x, n.pos.y, 0);
      const alive = n.loadsLeft > 0;
      const canopy = obj.userData.canopy as THREE.Object3D | null;
      if (canopy) canopy.visible = alive;
      const beam = obj.userData.beam as THREE.Object3D | null;
      if (beam) beam.visible = alive;
      const label = obj.userData.label as THREE.Object3D | null;
      if (label) label.visible = alive;
      const marker = obj.userData.marker as THREE.Mesh | null;
      if (marker?.material instanceof THREE.MeshBasicMaterial) {
        marker.material.opacity = alive ? 0.55 + Math.sin(state.time * 4 + n.pos.x) * 0.3 : 0.12;
      }
    }
    this.prune("node-", live);
  }

  private makeNode(n: GameState["nodes"][number]) {
    const own = n.team === this.homeSide;
    const g = new THREE.Group();
    if (n.kind === "pine") {
      // Bright oak + log pile = wood. Scenery pines never look like this.
      const canopy = buildTree("oak", n.pos.x + n.pos.y, 30);
      canopy.name = "canopy";
      g.add(canopy);
      const logs = cloneModel("kLogs", 7);
      if (logs) {
        logs.position.set(6, 0, 4);
        logs.name = "logs";
        g.add(logs);
      }
      g.add(
        this.resourceBeacon(own ? "WOOD" : "RAID WOOD", own ? 0xf0c040 : 0xff704f),
      );
    } else {
      const rocks = new THREE.Group();
      rocks.name = "canopy";
      rocks.add(buildGoldMine());
      g.add(rocks);
      g.add(
        this.resourceBeacon(own ? "GOLD" : "RAID GOLD", own ? 0x4aa0ff : 0xff704f),
      );
    }
    return g;
  }

  private makeBarricade(barricade: Barricade) {
    const group = new THREE.Group();
    const timber = new THREE.MeshStandardMaterial({
      color: barricade.team === "you" ? 0x74451f : 0x71302a,
      roughness: 0.9,
    });
    const iron = new THREE.MeshStandardMaterial({ color: 0x40372f, roughness: 0.7 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.BoxGeometry(43, 2.7, 3.2), timber);
      log.position.set(0, 2.4 + i * 3.1, 0);
      log.rotation.z = (i - 1) * 0.035;
      log.castShadow = true;
      group.add(log);
    }
    for (const x of [-17, 17]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(2.6, 13, 3.5), timber);
      brace.position.set(x, 5.3, 0);
      brace.rotation.z = x < 0 ? -0.16 : 0.16;
      brace.castShadow = true;
      group.add(brace);
    }
    for (const x of [-20, -10, 0, 10, 20]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(1.1, 7, 5), iron);
      spike.position.set(x, 9.8, 0);
      spike.castShadow = true;
      group.add(spike);
    }
    return group;
  }

  private syncBarricades(state: GameState) {
    const live = this.liveSet();
    for (const barricade of state.barricades) {
      const key = `bar-${barricade.id}`;
      live.add(key);
      const obj = this.ensure(key, () => this.makeBarricade(barricade));
      setPos3(obj, barricade.pos.x, barricade.pos.y, 0);
      const progress = barricade.built
        ? 1
        : Math.max(0.12, barricade.buildProgress / Math.max(0.01, barricade.buildTime));
      obj.scale.set(1, progress, 1);
      obj.visible = true;
    }
    this.prune("bar-", live);
  }

  private makeUnit(u: Unit) {
    return buildUnitModel(u.kind, u.team);
  }

  private syncUnits(state: GameState) {
    const live = this.liveSet();
    for (const u of state.units) {
      const key = `unit-${u.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const made = this.makeUnit(u);
        made.userData.ramBody = made.children.find((child) => child.userData.movingRamBody) ?? null;
        return made;
      });
      setPos3(obj, u.pos.x, u.pos.y, 0);
      // Face march direction
      obj.rotation.y = u.team === "you" ? Math.PI : 0;
      if (u.kind === "rammer") {
        const body = obj.userData.ramBody as THREE.Object3D | null;
        if (body) {
          body.position.y = Math.abs(Math.sin(state.time * 5.5 + u.id)) * 0.35;
          body.rotation.z = Math.sin(state.time * 5.5 + u.id) * 0.012;
        }
      }
      animateUnit(obj, state.time + u.id * 0.37, { x: u.pos.x, y: u.pos.y, timer: u.attackTimer });
    }
    this.prune("unit-", live);
  }

  private syncVillagers(state: GameState) {
    const live = this.liveSet();
    for (const v of state.villagers) {
      if (v.state === "garrisoned") continue;
      const key = `vil-${v.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const g = new THREE.Group();
        g.userData.selection = null;
        const m = buildPeonModel(v.team);
        m.name = "rig";
        g.add(m);
        g.userData.rig = m;
        return g;
      });
      setPos3(obj, v.pos.x, v.pos.y, 0);
      obj.rotation.y = v.team === "you" ? Math.PI : 0;
      obj.scale.setScalar(v.state === "defend" ? 1.08 : 1);
      let selection = obj.userData.selection as THREE.Mesh | null;
      if (!selection) {
        selection = new THREE.Mesh(
          new THREE.RingGeometry(5.8, 7.1, 28),
          new THREE.MeshBasicMaterial({
            color: 0x79d3ff,
            transparent: true,
            opacity: 0.82,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        selection.name = "peon-selection";
        selection.rotation.x = -Math.PI / 2;
        selection.position.y = 0.25;
        obj.add(selection);
        obj.userData.selection = selection;
      }
      selection.visible = state.selectedVillagerIds.includes(v.id);
      const rig = obj.userData.rig as THREE.Object3D;
      const node = v.targetNodeId ? state.nodes.find((n) => n.id === v.targetNodeId) : undefined;
      setPeonGear(rig, node?.kind === "copper" ? "pick" : "axe", v.carryingGold > 0 ? "gold" : v.carryingWood > 0 ? "wood" : "none");
      animateUnit(rig, state.time + v.id * 0.37, {
        x: v.pos.x,
        y: v.pos.y,
        timer: v.attackTimer,
        fighting: v.state === "defend" && v.attackTimer > -0.35,
        work: v.state === "gathering" || v.state === "buildingBarricade",
      });
    }
    this.prune("vil-", live);
  }

  private syncCommandViz(state: GameState) {
    // Peon order lines → pooled LineSegments, written in place.
    const pos = this.commandLinePos;
    const col = this.commandLineCol;
    let seg = 0;
    const hw = WORLD_W / 2;
    const hh = WORLD_H / 2;
    if (state.selectedVillagerIds.length > 0) {
      for (const v of state.villagers) {
        if (seg >= MAX_COMMAND_LINES) break;
        if (!state.selectedVillagerIds.includes(v.id)) continue;
        let target = v.moveTarget;
        if (v.state === "patrolling") target = v.patrolToB ? v.patrolB : v.patrolA;
        else if (v.state === "defend" && v.moveTarget && !v.forcedAttack) target = v.moveTarget;
        else if (v.targetBarricadeId) target = state.barricades.find((b) => b.id === v.targetBarricadeId)?.pos;
        else if (v.targetNodeId) target = state.nodes.find((n) => n.id === v.targetNodeId)?.pos;
        else if (v.targetEnemyId) {
          target =
            state.units.find((u) => u.id === v.targetEnemyId)?.pos ??
            state.villagers.find((other) => other.id === v.targetEnemyId)?.pos;
        }
        if (target && Math.hypot(target.x - v.pos.x, target.y - v.pos.y) < 2) target = undefined;
        if (!target) continue;
        const o = seg * 6;
        pos[o] = v.pos.x - hw;
        pos[o + 1] = 0.5;
        pos[o + 2] = v.pos.y - hh;
        pos[o + 3] = target.x - hw;
        pos[o + 4] = 0.5;
        pos[o + 5] = target.y - hh;
        const patrol = v.state === "patrolling";
        const r = patrol ? 0.902 : 0.494;
        const g = patrol ? 0.749 : 0.824;
        const b = patrol ? 0.412 : 1.0;
        col[o] = r;
        col[o + 1] = g;
        col[o + 2] = b;
        col[o + 3] = r;
        col[o + 4] = g;
        col[o + 5] = b;
        seg++;
      }
    }
    this.commandLines.geometry.setDrawRange(0, seg * 2);
    this.commandLines.visible = seg > 0;
    if (seg > 0) {
      (this.commandLines.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (this.commandLines.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    }

    const selectedBarracks = state.selectedBuildingId
      ? state.buildings.find((b) => b.id === state.selectedBuildingId && b.kind === "barracks" && b.rallyPoint)
      : undefined;
    if (selectedBarracks?.rallyPoint) {
      const rp = this.rallyLinePos;
      rp[0] = selectedBarracks.pos.x - hw;
      rp[1] = 1;
      rp[2] = selectedBarracks.pos.y - hh;
      rp[3] = selectedBarracks.rallyPoint.x - hw;
      rp[4] = 1;
      rp[5] = selectedBarracks.rallyPoint.y - hh;
      (this.rallyLine.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      this.rallyLine.computeLineDistances();
      this.rallyLine.visible = true;
    } else {
      this.rallyLine.visible = false;
    }

    const live = this.liveSet();
    for (const marker of state.commandMarkers) {
      const key = `cmd-${marker.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const colors = {
          move: 0x72c9ff,
          gather: 0x83db8a,
          attack: 0xff6e67,
          patrol: 0xe4bd67,
          rally: 0xffd475,
        };
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(3.5, 5, 24),
          new THREE.MeshBasicMaterial({
            color: colors[marker.kind],
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        return ring;
      });
      setPos3(obj, marker.pos.x, marker.pos.y, 0.35);
      const pulse = 1 + (1.4 - marker.life) * 1.8;
      obj.scale.setScalar(Math.max(0.5, pulse));
      const mesh = obj as THREE.Mesh;
      if (mesh.material instanceof THREE.MeshBasicMaterial) {
        mesh.material.opacity = Math.max(0, marker.life / 1.4);
      }
    }
    this.prune("cmd-", live);
  }

  private syncSelectionRing(state: GameState) {
    const b = state.selectedBuildingId ? state.buildings.find((x) => x.id === state.selectedBuildingId) : undefined;
    const wanted = b && b.kind !== "barracks" ? `${b.id}:${b.canRefund ? 1 : 0}` : "";
    if (wanted === this.rangeRingFor) return; // unchanged — ring is already correct
    this.rangeRingFor = wanted;
    if (this.rangeRing) {
      this.dynamicRoot.remove(this.rangeRing);
      this.rangeRing.geometry.dispose();
      (this.rangeRing.material as THREE.Material).dispose();
      this.rangeRing = null;
    }
    if (!b || b.kind === "barracks") return;
    const range = !b.canRefund && b.kind === "watchtower" ? STARTER_GUARD_RANGE : BUILD_RANGE[b.kind];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(range - 2, range, 64),
      new THREE.MeshBasicMaterial({ color: 0xf8e0a7, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(to3(b.pos.x, b.pos.y, 0.5));
    this.dynamicRoot.add(ring);
    this.rangeRing = ring;
  }

  private syncFloats(state: GameState) {
    for (const f of state.floatingTexts) {
      if (this.floatIdSeen.has(f.id)) continue;
      this.floatIdSeen.add(f.id);
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, 128, 64);
      ctx.font = "bold 28px Georgia";
      ctx.textAlign = "center";
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, 64, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const spr = new THREE.Sprite(mat);
      spr.scale.set(28, 14, 1);
      spr.position.copy(to3(f.pos.x, f.pos.y, 24));
      this.floatRoot.add(spr);
      this.floatSprites.push({ mesh: spr, life: f.life, id: f.id });
    }
    // prune
    const liveIds = new Set(state.floatingTexts.map((f) => f.id));
    this.floatSprites = this.floatSprites.filter((s) => {
      if (!liveIds.has(s.id)) {
        this.floatRoot.remove(s.mesh);
        (s.mesh.material as THREE.SpriteMaterial).map?.dispose();
        (s.mesh.material as THREE.Material).dispose();
        this.floatIdSeen.delete(s.id);
        return false;
      }
      const ft = state.floatingTexts.find((f) => f.id === s.id)!;
      setPos3(s.mesh, ft.pos.x, ft.pos.y, 24 + ft.rise);
      (s.mesh.material as THREE.SpriteMaterial).opacity = Math.min(1, ft.life);
      return true;
    });
  }

  private pulseTorches(time: number) {
    for (const L of this.torchLights) {
      L.intensity = 0.9 + Math.sin(time * 10 + L.id) * 0.35;
    }
  }

  dispose() {
    this.renderer.dispose();
  }
}
