import * as THREE from "three";
import { BUILD_RANGE, STARTER_GUARD_RANGE, WORLD_H, WORLD_W } from "./balance";
import { cloneAnimatedModel, cloneModel, ensureModelsLoaded } from "./assets3d";
import type { Barricade, Building, GameState, Team, Unit } from "./types";
import {
  buildScenery,
  buildTerrain,
  makeAoETree,
  makeBallista,
  makeBarracks,
  makeCatapult,
  makeHouse,
  makeKeepMesh,
  makeMine,
  makeWatchtower,
} from "./worldMesh";

function teamColor(team: Team, lite = false) {
  if (team === "you") return lite ? 0x8ec8ff : 0x3a7ec8;
  return lite ? 0xf08090 : 0xa03040;
}

/** Map 2D sim coords (y down) → Three.js XZ ground (Y up). */
function to3(x: number, y: number, h = 0) {
  return new THREE.Vector3(x - WORLD_W / 2, h, y - WORLD_H / 2);
}

type EntityKey = string;

/**
 * Three.js battlefield renderer — same public API as the old Canvas2D GameRenderer.
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
    }
  >();
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
  /** Spherical orbit — pitch from Y (0=top-down, π/2=horizon). */
  private camDist = 520;
  private camYaw = 0.12;
  private camPitch = 1.12; // ~64° from top → proper RTS angle, not bird's-eye
  private camLook = new THREE.Vector3(0, 14, 55);
  private readonly camDistMin = 280;
  private readonly camDistMax = 900;
  private readonly camPitchMin = 0.72;
  private readonly camPitchMax = 1.35;
  private camShake = new THREE.Vector3();
  private pointers = new Map<number, { x: number; y: number }>();
  private dragMode: "none" | "orbit" | "pan" | "pinch" | "select" = "none";
  private dragMoved = false;
  private pointerButton = 0;
  private pointerType = "mouse";
  private lastPtr = { x: 0, y: 0 };
  private pinchStartDist = 0;
  private pinchStartCamDist = 520;
  private suppressClick = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
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
    this.sun.shadow.camera.far = 1100;
    this.sun.shadow.camera.left = -360;
    this.sun.shadow.camera.right = 360;
    this.sun.shadow.camera.top = 480;
    this.sun.shadow.camera.bottom = -480;
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

    this.buildSky();
    this.fitCamera();
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
    for (const [k, obj] of [...this.entityMap]) {
      this.dynamicRoot.remove(obj);
      this.clearAnimation(k);
      this.entityMap.delete(k);
    }
  }

  private buildSky() {
    const skyGeo = new THREE.SphereGeometry(900, 24, 16);
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

  /** Best default RTS framing — oblique, biased toward your keep. */
  resetCamera() {
    this.camDist = 520;
    this.camYaw = 0.12;
    this.camPitch = 1.12;
    this.camLook.set(0, 14, 55);
    this.applyCamera();
  }

  zoomBy(factor: number) {
    this.camDist = THREE.MathUtils.clamp(this.camDist * factor, this.camDistMin, this.camDistMax);
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
    this.camLook.x = THREE.MathUtils.clamp(this.camLook.x, -160, 160);
    this.camLook.z = THREE.MathUtils.clamp(this.camLook.z, -280, 280);
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

  /** Returns true if this pointerdown should also fire a game click (short tap). */
  onPointerDown(ev: PointerEvent) {
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    this.dragMoved = false;
    this.suppressClick = false;
    this.pointerButton = ev.button;
    this.pointerType = ev.pointerType;
    this.lastPtr = { x: ev.clientX, y: ev.clientY };

    if (this.pointers.size === 2) {
      this.dragMode = "pinch";
      const pts = [...this.pointers.values()];
      this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.pinchStartCamDist = this.camDist;
      this.suppressClick = true;
      return false;
    }

    // Middle / Alt = orbit immediately. Right-click is a command when tapped,
    // but promotes to orbit when dragged.
    if (ev.button === 1 || ev.altKey) {
      this.dragMode = "orbit";
      this.suppressClick = true;
    } else if (ev.shiftKey) {
      this.dragMode = "pan";
      this.suppressClick = true;
    } else {
      this.dragMode = "none"; // promote to orbit after move threshold
    }
    try {
      (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    } catch {
      /* ignore */
    }
    return false;
  }

  onPointerMove(ev: PointerEvent) {
    if (!this.pointers.has(ev.pointerId)) return;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (this.dragMode === "pinch" && this.pointers.size >= 2) {
      const pts = [...this.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (this.pinchStartDist > 1) {
        const ratio = this.pinchStartDist / Math.max(1, d);
        this.camDist = THREE.MathUtils.clamp(this.pinchStartCamDist * ratio, this.camDistMin, this.camDistMax);
        this.applyCamera();
      }
      this.dragMoved = true;
      this.suppressClick = true;
      return;
    }

    const dx = ev.clientX - this.lastPtr.x;
    const dy = ev.clientY - this.lastPtr.y;
    this.lastPtr = { x: ev.clientX, y: ev.clientY };
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5 && this.dragMode === "none") return;

    if (this.dragMode === "none" && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
      this.dragMode =
        this.pointerType === "mouse" && this.pointerButton === 0 ? "select" : "orbit";
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
    if (this.pointers.size < 2 && this.dragMode === "pinch") this.dragMode = "none";
    if (this.pointers.size === 0) {
      this.dragMode = "none";
      this.dragMoved = false;
    }
    return wasTap;
  }

  onWheel(ev: WheelEvent) {
    ev.preventDefault();
    const factor = ev.deltaY > 0 ? 1.08 : 0.92;
    this.zoomBy(factor);
  }

  private burst(x: number, y: number, h: number, color: number, count: number, speed = 40) {
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
    if (this.particles.length > 420) this.particles.splice(0, this.particles.length - 420);
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
    // Unit deaths — use cached last positions (syncUnits may already have pruned meshes)
    const live = new Set(state.units.map((u) => u.id));
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

    // Integrate particles
    for (const p of this.particles) {
      p.life -= dt;
      p.vel.y -= 60 * dt;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += p.vel.z * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    this.arrows = this.arrows.filter((arrow) => {
      arrow.life -= dt;
      const t = Math.min(1, 1 - arrow.life / arrow.max);
      arrow.mesh.position.lerpVectors(arrow.start, arrow.end, t);
      arrow.mesh.position.y += Math.sin(t * Math.PI) * 18;
      if (arrow.life > 0) return true;
      this.dynamicRoot.remove(arrow.mesh);
      arrow.mesh.geometry.dispose();
      (arrow.mesh.material as THREE.Material).dispose();
      return false;
    });

    const n = this.particles.length;
    const positions = new Float32Array(Math.max(1, n) * 3);
    const colors = new Float32Array(Math.max(1, n) * 3);
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      const fade = Math.max(0, p.life / p.max);
      positions[i * 3] = p.pos.x;
      positions[i * 3 + 1] = p.pos.y;
      positions[i * 3 + 2] = p.pos.z;
      colors[i * 3] = p.color.r * fade;
      colors[i * 3 + 1] = p.color.g * fade;
      colors[i * 3 + 2] = p.color.b * fade;
    }
    this.particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.particleGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.particleGeo.setDrawRange(0, n);
    this.particleGeo.attributes.position.needsUpdate = true;
    this.particleGeo.attributes.color.needsUpdate = true;
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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(dpr);
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
    const step = Math.min(0.05, Math.max(0.008, (now - this.wallClock) / 1000));
    this.wallClock = now;

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
    for (const animated of this.animationMap.values()) animated.mixer.update(step);
    this.syncSelectionRing(state);
    this.syncFloats(state);
    this.pulseTorches(state.time);
    this.updateCamera(state);

    this.sun.intensity = 2.25 + Math.sin(state.time * 0.35) * 0.1;
    this.hemi.intensity = 1.3 + Math.sin(state.time * 0.22) * 0.05;

    this.renderer.render(this.scene, this.camera);
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

  private registerAnimation(
    key: EntityKey,
    object: THREE.Object3D,
    clips: THREE.AnimationClip[],
  ) {
    if (!clips.length) return;
    this.animationMap.set(key, {
      mixer: new THREE.AnimationMixer(object),
      clips,
      actions: new Map(),
    });
  }

  private playAnimation(key: EntityKey, choices: string[], speed = 1) {
    const animated = this.animationMap.get(key);
    if (!animated) return;
    const clip = choices
      .map((name) => animated.clips.find((candidate) => candidate.name.toLowerCase() === name))
      .find((candidate): candidate is THREE.AnimationClip => Boolean(candidate));
    if (!clip || animated.current === clip.name) return;

    const oldAction = animated.current ? animated.actions.get(animated.current) : undefined;
    let action = animated.actions.get(clip.name);
    if (!action) {
      action = animated.mixer.clipAction(clip);
      animated.actions.set(clip.name, action);
    }
    oldAction?.fadeOut(0.14);
    action.reset().setEffectiveTimeScale(speed).fadeIn(0.14).play();
    animated.current = clip.name;
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
    const kit = cloneModel("kKeep", 42);
    const g = kit ? new THREE.Group() : makeKeepMesh(team);
    if (kit) {
      g.add(kit);
      const flag = cloneModel("kFlag", 16);
      if (flag) {
        flag.position.set(0, 28, 0);
        g.add(flag);
      }
      const wallL = cloneModel("kWall", 18);
      const wallR = cloneModel("kWall", 18);
      if (wallL && wallR) {
        wallL.position.set(-22, 0, 8);
        wallR.position.set(22, 0, 8);
        g.add(wallL, wallR);
      }
    }
    const light = new THREE.PointLight(0xffaa55, 1.6, 110, 2);
    light.position.set(-16, 28, 14);
    g.add(light);
    this.torchLights.push(light);
    const light2 = light.clone();
    light2.position.set(16, 28, 14);
    g.add(light2);
    this.torchLights.push(light2);
    return g;
  }

  private syncKeeps(state: GameState) {
    const live = new Set<string>();
    for (const team of ["you", "foe"] as Team[]) {
      const key = `keep-${team}`;
      live.add(key);
      const obj = this.ensure(key, () => this.makeKeep(team));
      const k = state.keeps[team];
      obj.position.copy(to3(k.pos.x, k.pos.y, 0));
      if (k.hitFlash > 0) obj.scale.setScalar(1.04);
      else obj.scale.setScalar(1);
    }
    this.prune("keep-", live);
  }

  private kitOr(key: "kTower" | "kBallista" | "kCatapult" | "kGate" | "kWall", height: number, fallback: () => THREE.Object3D) {
    const m = cloneModel(key, height);
    if (!m) return fallback();
    const g = new THREE.Group();
    g.add(m);
    return g;
  }

  private makeBuilding(kind: Building["kind"], team: Team) {
    if (kind === "watchtower") return this.kitOr("kTower", 34, () => makeWatchtower(team));
    if (kind === "ballista") return this.kitOr("kBallista", 16, () => makeBallista(team));
    if (kind === "catapult") return this.kitOr("kCatapult", 18, () => makeCatapult(team));
    if (kind === "house") return makeHouse(team);
    return makeBarracks(team);
  }

  private syncBuildings(state: GameState) {
    const live = new Set<string>();
    for (const b of state.buildings) {
      const key = `bld-${b.id}`;
      live.add(key);
      const obj = this.ensure(key, () => this.makeBuilding(b.kind, b.team));
      obj.position.copy(to3(b.pos.x, b.pos.y, 0));
      const arm = obj.getObjectByName("arm");
      if (arm && b.animKick > 0) arm.rotation.z = -0.8 * (b.animKick / 0.15);
      else if (arm) arm.rotation.z = 0;
    }
    this.prune("bld-", live);
  }

  private syncPads(state: GameState) {
    const live = new Set<string>();
    for (const p of state.pads) {
      if (state.buildings.some((b) => b.padId === p.id)) continue;
      const key = `pad-${p.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(p.zone === "eco" ? 9 : 10, p.zone === "eco" ? 13 : 14, 24),
          new THREE.MeshStandardMaterial({
            color: p.zone === "eco" ? 0xa8c86a : p.team === "you" ? 0x6eb4ff : 0xb44a55,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        return ring;
      });
      obj.position.copy(to3(p.pos.x, p.pos.y, 0.4));
      const pulse = state.buildSelection && p.team === "you" ? 0.7 + Math.sin(state.time * 5) * 0.25 : 0.45;
      const ecoSel = state.buildSelection === "house";
      const match =
        p.zone === "eco"
          ? ecoSel || !state.buildSelection
          : state.buildSelection !== "house" || !state.buildSelection;
      (obj as THREE.Mesh).material = new THREE.MeshStandardMaterial({
        color: p.zone === "eco" ? 0xa8c86a : p.team === "you" ? 0x6eb4ff : 0xb44a55,
        transparent: true,
        opacity: match ? pulse : 0.22,
        side: THREE.DoubleSide,
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
    const live = new Set<string>();
    for (const n of state.nodes) {
      const key = `node-${n.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const g = new THREE.Group();
        if (n.kind === "pine") {
          // Bright oak + log pile = wood. Scenery pines never look like this.
          const canopy = cloneModel("kOak", 30) ?? cloneModel("oak", 30) ?? makeAoETree(1.2);
          canopy.name = "canopy";
          g.add(canopy);
          const logs = cloneModel("kLogs", 7);
          if (logs) {
            logs.position.set(6, 0, 4);
            logs.name = "logs";
            g.add(logs);
          }
          g.add(
            this.resourceBeacon(
              n.team === "you" ? "WOOD" : "RAID WOOD",
              n.team === "you" ? 0xf0c040 : 0xff704f,
            ),
          );
        } else {
          const rocks = new THREE.Group();
          rocks.name = "canopy";
          const a = cloneModel("kRock", 10);
          const b = cloneModel("kRock2", 8);
          const c = cloneModel("kStone", 7);
          if (a) rocks.add(a);
          if (b) {
            b.position.set(6, 0, 2);
            rocks.add(b);
          }
          if (c) {
            c.position.set(-5, 0, 3);
            rocks.add(c);
          }
          if (rocks.children.length === 0) rocks.add(makeMine());
          // Gold seam so mines read as ore, not random boulders
          const nugget = new THREE.Mesh(
            new THREE.OctahedronGeometry(2.2, 0),
            new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xaa7700, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.25 }),
          );
          nugget.position.set(0, 8, 0);
          rocks.add(nugget);
          g.add(rocks);
          g.add(
            this.resourceBeacon(
              n.team === "you" ? "GOLD" : "RAID GOLD",
              n.team === "you" ? 0x4aa0ff : 0xff704f,
            ),
          );
        }
        return g;
      });
      obj.position.copy(to3(n.pos.x, n.pos.y, 0));
      obj.scale.setScalar(1);
      const alive = n.loadsLeft > 0;
      const canopy = obj.getObjectByName("canopy");
      if (canopy) canopy.visible = alive;
      const beam = obj.getObjectByName("beam");
      if (beam) beam.visible = alive;
      const label = obj.getObjectByName("label");
      if (label) label.visible = alive;
      const marker = obj.getObjectByName("marker") as THREE.Mesh | undefined;
      if (marker?.material instanceof THREE.MeshBasicMaterial) {
        marker.material.opacity = alive ? 0.55 + Math.sin(state.time * 4 + n.pos.x) * 0.3 : 0.12;
      }
      obj.visible = true;
    }
    this.prune("node-", live);
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
    const live = new Set<string>();
    for (const barricade of state.barricades) {
      const key = `bar-${barricade.id}`;
      live.add(key);
      const obj = this.ensure(key, () => this.makeBarricade(barricade));
      obj.position.copy(to3(barricade.pos.x, barricade.pos.y, 0));
      const progress = barricade.built
        ? 1
        : Math.max(0.12, barricade.buildProgress / Math.max(0.01, barricade.buildTime));
      obj.scale.set(1, progress, 1);
      obj.visible = true;
    }
    this.prune("bar-", live);
  }

  private addArcherGear(model: THREE.Object3D, team: Team) {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b3d1f, roughness: 0.78 });
    const bow = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.16, 5, 18, Math.PI * 1.55), wood);
    bow.position.set(2.7, 7.2, 0.4);
    bow.rotation.z = -0.85;
    model.add(bow);
    const string = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -2.5, 0),
        new THREE.Vector3(-1.25, 0, 0),
        new THREE.Vector3(0, 2.5, 0),
      ]),
      new THREE.LineBasicMaterial({ color: 0xe7d9bd }),
    );
    string.position.copy(bow.position);
    string.rotation.copy(bow.rotation);
    model.add(string);
    const quiver = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.85, 4.8, 7),
      new THREE.MeshStandardMaterial({ color: team === "you" ? 0x315f91 : 0x8c3340, roughness: 0.8 }),
    );
    quiver.position.set(-1.5, 6.5, -1.2);
    quiver.rotation.z = 0.25;
    model.add(quiver);
  }

  private makeUnit(u: Unit, key: EntityKey) {
    if (u.kind === "rammer") {
      const ram = cloneModel("kRam", 14);
      if (ram) {
        // The asset's forward axis is sideways to the game's marching axis.
        // Keep that correction on an inner model so team-facing can use the wrapper.
        const root = new THREE.Group();
        ram.rotation.y = Math.PI / 2;
        ram.userData.movingRamBody = true;
        root.add(ram);
        return root;
      }
    }
    const animatedKenney = cloneAnimatedModel(
      u.team === "you" ? "kCharA" : "kCharB",
      u.kind === "brute" ? 16 : 12,
    );
    if (animatedKenney) {
      this.registerAnimation(key, animatedKenney.object, animatedKenney.clips);
      if (u.kind === "archer") this.addArcherGear(animatedKenney.object, u.team);
      return animatedKenney.object;
    }
    if (u.kind === "brute") {
      const boss = cloneModel("mindflayer", 16) ?? cloneModel("hero", 16);
      if (boss) return boss;
    }
    const animatedSoldier = cloneAnimatedModel(
      u.team === "you" ? "blue" : "red",
      u.kind === "runner" ? 11 : 12,
    );
    if (animatedSoldier) {
      this.registerAnimation(key, animatedSoldier.object, animatedSoldier.clips);
      return animatedSoldier.object;
    }

    // Procedural fallback
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: teamColor(u.team, true), roughness: 0.55 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(3.5, 6, 6, 10), bodyMat);
    body.position.y = 7;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8d0b0 }),
    );
    head.position.y = 14;
    g.add(head);
    return g;
  }

  private syncUnits(state: GameState) {
    const live = new Set<string>();
    for (const u of state.units) {
      const key = `unit-${u.id}`;
      live.add(key);
      const obj = this.ensure(key, () => this.makeUnit(u, key));
      obj.position.copy(to3(u.pos.x, u.pos.y, 0));
      // Face march direction
      obj.rotation.y = u.team === "you" ? Math.PI : 0;
      if (u.kind === "rammer") {
        const body = obj.children.find((child) => child.userData.movingRamBody);
        if (body) {
          body.position.y = Math.abs(Math.sin(state.time * 5.5 + u.id)) * 0.35;
          body.rotation.z = Math.sin(state.time * 5.5 + u.id) * 0.012;
        }
      } else if (u.kind === "archer" && u.attackTimer > 0) {
        this.playAnimation(key, ["attack-ranged-right", "attack-range-right", "interact-right", "attack-melee-right"]);
      } else if (u.attackTimer > 0) {
        this.playAnimation(key, ["attack-melee-right", "attack", "simple_interact"]);
      } else if (u.kind === "runner") {
        this.playAnimation(key, ["sprint", "run_lower", "walk"], 1.15);
      } else {
        this.playAnimation(key, ["walk", "walk_lower", "run_lower"]);
      }
    }
    this.prune("unit-", live);
  }

  private syncVillagers(state: GameState) {
    const live = new Set<string>();
    for (const v of state.villagers) {
      if (v.state === "garrisoned") continue;
      const key = `vil-${v.id}`;
      live.add(key);
      const obj = this.ensure(key, () => {
        const g = new THREE.Group();
        const animated =
          cloneAnimatedModel("kCharC", 14) ??
          cloneAnimatedModel(v.team === "you" ? "blue" : "red", 14);
        const m = animated?.object;
        if (m) {
          m.name = "rig";
          g.add(m);
          this.registerAnimation(key, m, animated.clips);
          return g;
        }
        const body = new THREE.Mesh(
          new THREE.CapsuleGeometry(2.4, 6, 6, 10),
          new THREE.MeshStandardMaterial({ color: 0x8ec8ff, roughness: 0.6 }),
        );
        body.position.y = 5.5;
        body.castShadow = true;
        body.name = "body";
        g.add(body);
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(2, 10, 10),
          new THREE.MeshStandardMaterial({ color: 0xe8d0b0 }),
        );
        head.position.y = 11;
        g.add(head);
        return g;
      });
      obj.position.copy(to3(v.pos.x, v.pos.y, 0));
      obj.rotation.y = v.team === "you" ? Math.PI : 0;
      obj.scale.setScalar(v.state === "defend" ? 1.08 : 1);
      let selection = obj.getObjectByName("peon-selection") as THREE.Mesh | undefined;
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
      }
      selection.visible = state.selectedVillagerIds.includes(v.id);
      if (v.state === "defend" && v.attackTimer > 0) {
        this.playAnimation(key, ["attack-melee-right", "attack", "simple_interact"]);
      } else if (v.state === "gathering" || v.state === "buildingBarricade") {
        this.playAnimation(key, ["interact-right", "pick-up", "simple_interact"]);
      } else if (v.state === "idle") {
        this.playAnimation(key, ["idle", "idle_lower"]);
      } else {
        this.playAnimation(key, ["walk", "walk_lower", "run_lower"]);
      }
    }
    this.prune("vil-", live);
  }

  private syncCommandViz(state: GameState) {
    while (this.commandLineRoot.children.length) {
      const child = this.commandLineRoot.children[0];
      this.commandLineRoot.remove(child);
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }

    const selected = state.villagers.filter(
      (v) => v.team === "you" && state.selectedVillagerIds.includes(v.id),
    );
    for (const v of selected) {
      let target = v.moveTarget;
      if (v.state === "patrolling") target = v.patrolToB ? v.patrolB : v.patrolA;
      if (v.targetNodeId) target = state.nodes.find((n) => n.id === v.targetNodeId)?.pos;
      if (v.targetEnemyId) target = state.units.find((u) => u.id === v.targetEnemyId)?.pos;
      if (v.targetBarricadeId) target = state.barricades.find((b) => b.id === v.targetBarricadeId)?.pos;
      if (!target) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          to3(v.pos.x, v.pos.y, 0.5),
          to3(target.x, target.y, 0.5),
        ]),
        new THREE.LineBasicMaterial({
          color: v.state === "patrolling" ? 0xe6bf69 : 0x7ed2ff,
          transparent: true,
          opacity: 0.58,
        }),
      );
      this.commandLineRoot.add(line);
    }

    const selectedBarracks = state.buildings.find(
      (b) => b.id === state.selectedBuildingId && b.kind === "barracks" && b.rallyPoint,
    );
    if (selectedBarracks?.rallyPoint) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          to3(selectedBarracks.pos.x, selectedBarracks.pos.y, 1),
          to3(selectedBarracks.rallyPoint.x, selectedBarracks.rallyPoint.y, 1),
        ]),
        new THREE.LineDashedMaterial({ color: 0xffd475, dashSize: 5, gapSize: 3 }),
      );
      line.computeLineDistances();
      this.commandLineRoot.add(line);
    }

    const live = new Set<string>();
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
      obj.position.copy(to3(marker.pos.x, marker.pos.y, 0.35));
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
    if (this.rangeRing) {
      this.dynamicRoot.remove(this.rangeRing);
      this.rangeRing.geometry.dispose();
      this.rangeRing = null;
    }
    const b = state.buildings.find((x) => x.id === state.selectedBuildingId);
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
      s.mesh.position.copy(to3(ft.pos.x, ft.pos.y, 24 + ft.rise));
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
