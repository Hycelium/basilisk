import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Shared building blocks for the unit models: grayscale fabric/metal textures, cached materials and geometry, mesh baking and arm IK. */

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export type UTex = "wool" | "linen" | "leather" | "mail" | "quilt" | "steel" | "grain" | "hide" | "skin" | "plank" | "fur";

type Draw = (g: CanvasRenderingContext2D, r: () => number, s: number) => void;
const grey = (v: number, a = 1) => `rgba(${v},${v},${v},${a})`;
const speckle = (g: CanvasRenderingContext2D, r: () => number, s: number, n: number, a: number, size = 2) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    g.fillRect(r() * s, r() * s, size, size);
  }
};

/** Textures are near-white so the material colour carries the hue; detail lives in value only. */
const DRAW: Record<UTex, Draw> = {
  wool: (g, r, s) => {
    g.fillStyle = grey(215);
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 50; i++) {
      g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.06)";
      g.beginPath();
      g.ellipse(r() * s, r() * s, 10 + r() * 30, 6 + r() * 16, r() * 3, 0, 7);
      g.fill();
    }
    g.lineWidth = 1;
    for (let i = 0; i < 9000; i++) {
      const x = r() * s, y = r() * s, a = r() * Math.PI;
      g.strokeStyle = r() < 0.55 ? "rgba(0,0,0,0.13)" : "rgba(255,255,255,0.12)";
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4);
      g.stroke();
    }
  },
  linen: (g, r, s) => {
    g.fillStyle = grey(228);
    g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) {
      g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.06})`;
      g.fillRect(0, y, s, 1);
    }
    for (let x = 0; x < s; x += 2) {
      g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.05})`;
      g.fillRect(x, 0, 1, s);
    }
    speckle(g, r, s, 3000, 0.06);
  },
  leather: (g, r, s) => {
    g.fillStyle = grey(196);
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = r() < 0.6 ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.07)";
      g.beginPath();
      g.ellipse(r() * s, r() * s, 3 + r() * 14, 2 + r() * 8, r() * 3, 0, 7);
      g.fill();
    }
    g.lineWidth = 1;
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = "rgba(255,255,255,0.18)";
      const x = r() * s, y = r() * s;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 10);
      g.stroke();
    }
    speckle(g, r, s, 2500, 0.08);
  },
  mail: (g, _r, s) => {
    g.fillStyle = grey(40);
    g.fillRect(0, 0, s, s);
    for (let row = 0, y = 0; y < s + 8; row++, y += 6) {
      for (let x = row % 2 ? 4 : 0; x < s + 8; x += 8) {
        g.lineWidth = 1.8;
        g.strokeStyle = grey(175);
        g.beginPath();
        g.arc(x, y, 3.4, 0, Math.PI * 2);
        g.stroke();
        g.lineWidth = 1;
        g.strokeStyle = grey(245);
        g.beginPath();
        g.arc(x, y, 3.4, Math.PI * 1.1, Math.PI * 1.6);
        g.stroke();
      }
    }
  },
  quilt: (g, r, s) => {
    for (let x = 0; x < s; x += 32) {
      const grd = g.createLinearGradient(x, 0, x + 32, 0);
      grd.addColorStop(0, grey(170));
      grd.addColorStop(0.5, grey(240));
      grd.addColorStop(1, grey(170));
      g.fillStyle = grd;
      g.fillRect(x, 0, 32, s);
      g.fillStyle = grey(90, 0.6);
      for (let y = 0; y < s; y += 6) g.fillRect(x, y, 1.5, 3);
    }
    speckle(g, r, s, 3000, 0.05);
  },
  steel: (g, r, s) => {
    g.fillStyle = grey(200);
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.1)";
      g.fillRect(r() * s, r() * s, 20 + r() * 80, 1);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = "rgba(60,40,20,0.12)";
      g.beginPath();
      g.arc(r() * s, r() * s, 2 + r() * 6, 0, 7);
      g.fill();
    }
  },
  grain: (g, r, s) => {
    g.fillStyle = grey(190);
    g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 2) {
      g.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.18})`;
      g.lineWidth = 1;
      g.beginPath();
      const ph = r() * 6, amp = 1 + r() * 2;
      for (let y = 0; y <= s; y += 8) g.lineTo(x + Math.sin(y / 40 + ph) * amp, y);
      g.stroke();
    }
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = "rgba(0,0,0,0.25)";
      g.beginPath();
      g.ellipse(r() * s, r() * s, 3, 8, 0, 0, 7);
      g.stroke();
    }
  },
  hide: (g, r, s) => {
    g.fillStyle = grey(222);
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.045)" : "rgba(255,255,255,0.05)";
      g.beginPath();
      g.ellipse(r() * s, r() * s, 12 + r() * 30, 8 + r() * 20, r() * 3, 0, 7);
      g.fill();
    }
    g.lineWidth = 1;
    for (let i = 0; i < 5000; i++) {
      const x = r() * s, y = r() * s;
      g.strokeStyle = r() < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.06)";
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 1, y + 4);
      g.stroke();
    }
  },
  skin: (g, r, s) => {
    g.fillStyle = grey(236);
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = r() < 0.5 ? "rgba(120,40,30,0.035)" : "rgba(255,255,255,0.04)";
      g.beginPath();
      g.arc(r() * s, r() * s, 1 + r() * 3, 0, 7);
      g.fill();
    }
  },
  plank: (g, r, s) => {
    g.fillStyle = grey(30);
    g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 32) {
      g.fillStyle = grey(Math.round(150 + r() * 70));
      g.fillRect(x + 1.5, 0, 29, s);
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.15})`;
        g.fillRect(x + 3 + r() * 25, r() * s, 1, 20 + r() * 80);
      }
      for (const y of [18, s / 2 + 18]) {
        g.fillStyle = grey(25);
        g.beginPath();
        g.arc(x + 16, y, 3.5, 0, 7);
        g.fill();
        g.fillStyle = grey(140);
        g.beginPath();
        g.arc(x + 15, y - 1, 1.3, 0, 7);
        g.fill();
      }
    }
  },
  fur: (g, r, s) => {
    g.fillStyle = grey(205);
    g.fillRect(0, 0, s, s);
    g.lineWidth = 1.2;
    for (let i = 0; i < 9000; i++) {
      const x = r() * s, y = r() * s, a = Math.PI / 2 + (r() - 0.5) * 0.9;
      g.strokeStyle = r() < 0.5 ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.2)";
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
      g.stroke();
    }
  },
};

let texAnisotropy = 8;
let allowBump = true;

/** Match structure-material mobile rules: separate linear bump maps, optional disable. */
export function configureUnitMaterials(opts: { anisotropy: number; bump: boolean }) {
  texAnisotropy = Math.max(1, opts.anisotropy);
  allowBump = opts.bump;
  for (const tex of texCache.values()) {
    if (tex.anisotropy !== texAnisotropy) {
      tex.anisotropy = texAnisotropy;
      tex.needsUpdate = true;
    }
  }
  for (const mat of matCache.values()) {
    let changed = false;
    if (mat.map && mat.map.anisotropy !== texAnisotropy) {
      mat.map.anisotropy = texAnisotropy;
      mat.map.needsUpdate = true;
      changed = true;
    }
    const want = (mat.userData.bumpScale as number) || 0;
    if (!allowBump && mat.bumpMap) {
      mat.bumpMap = null;
      mat.bumpScale = 0;
      changed = true;
    } else if (allowBump && mat.map && !mat.bumpMap && want > 0) {
      mat.bumpMap = bumpFromAlbedo(mat.map);
      mat.bumpScale = want;
      changed = true;
    }
    if (changed) mat.needsUpdate = true;
  }
}

function bumpFromAlbedo(albedo: THREE.Texture) {
  const bump = albedo.clone();
  bump.colorSpace = THREE.NoColorSpace;
  bump.wrapS = albedo.wrapS;
  bump.wrapT = albedo.wrapT;
  bump.repeat.copy(albedo.repeat);
  bump.offset.copy(albedo.offset);
  bump.anisotropy = albedo.anisotropy;
  bump.needsUpdate = true;
  return bump;
}

const texCache = new Map<UTex, THREE.Texture>();
function baseTex(name: UTex) {
  let t = texCache.get(name);
  if (!t) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    DRAW[name](c.getContext("2d")!, rng(name.length * 977 + name.charCodeAt(0)), 256);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = texAnisotropy;
    t.needsUpdate = true;
    texCache.set(name, t);
  }
  return t;
}

export interface MatOpts {
  rep?: [number, number];
  rough?: number;
  metal?: number;
  bump?: number;
  side?: THREE.Side;
  emissive?: number;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** Smooth-shaded standard material, optionally with a tinted procedural texture and a separate bump map. */
export function M(color: number, t: UTex | null = null, o: MatOpts = {}) {
  const rep = o.rep ?? [2, 2];
  const key = `${color}|${t}|${rep}|${o.rough}|${o.metal}|${o.bump}|${o.side}|${o.emissive}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.rough ?? 0.85,
      metalness: o.metal ?? 0,
      side: o.side ?? THREE.FrontSide,
      emissive: o.emissive ?? 0,
    });
    if (t) {
      const tx = baseTex(t).clone();
      tx.colorSpace = THREE.SRGBColorSpace;
      tx.repeat.set(rep[0], rep[1]);
      tx.anisotropy = texAnisotropy;
      tx.needsUpdate = true;
      m.map = tx;
      const bump = o.bump ?? 0;
      m.userData.bumpScale = bump;
      if (bump && allowBump) {
        m.bumpMap = bumpFromAlbedo(tx);
        m.bumpScale = bump;
      }
    }
    matCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
export const G = (k: string, make: () => THREE.BufferGeometry) => {
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = make()));
  return g;
};

/** Lathe from `[radius, y]` pairs listed bottom to top (that order keeps normals facing out). */
export function lathe(pts: number[][], seg = 18, phiStart = 0, phiLen = Math.PI * 2) {
  return new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y)),
    seg,
    phiStart,
    phiLen,
  );
}

/** Radial cloth folds that grow toward the hem (`yTop` and above stays untouched). */
export function folds(geo: THREE.BufferGeometry, n: number, amp: number, yTop: number) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  let yMin = Infinity;
  for (let i = 0; i < p.count; i++) yMin = Math.min(yMin, p.getY(i));
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y >= yTop) continue;
    const k = (yTop - y) / Math.max(0.001, yTop - yMin);
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const s = 1 + amp * k * (Math.sin(a * n + Math.sin(a * 3) * 1.7) * 0.7 + Math.sin(a * (n + 3)) * 0.3);
    p.setX(i, p.getX(i) * s);
    p.setZ(i, p.getZ(i) * s);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Scalloped (dagged) hem: lifts the lowest ring of vertices in `n` tongues. */
export function dag(geo: THREE.BufferGeometry, n: number, depth: number) {
  const p = geo.attributes.position as THREE.BufferAttribute;
  let yMin = Infinity;
  for (let i = 0; i < p.count; i++) yMin = Math.min(yMin, p.getY(i));
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > yMin + 1e-4) continue;
    const a = Math.atan2(p.getX(i), p.getZ(i));
    p.setY(i, yMin + depth * Math.max(0, Math.sin(a * n)) ** 0.6);
  }
  geo.computeVertexNormals();
  return geo;
}

export const sphere = (seg = 16) => G(`sph${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.75))));
export const cyl = (rt: number, rb: number, h: number, seg = 12, open = false) =>
  G(`cyl${rt}|${rb}|${h}|${seg}|${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
/** Cylinder lying along +Z, from z=0 to z=len. */
export const rodZ = (r: number, len: number, seg = 8, r2 = r) =>
  G(`rodz${r}|${len}|${seg}|${r2}`, () => new THREE.CylinderGeometry(r2, r, len, seg).rotateX(Math.PI / 2).translate(0, 0, len / 2));
export const box = (w: number, h: number, d: number) => G(`box${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
export const torus = (r: number, t: number, seg = 20, arc = Math.PI * 2) =>
  G(`tor${r}|${t}|${seg}|${arc}`, () => new THREE.TorusGeometry(r, t, 6, seg, arc));

type V3 = [number, number, number];
/** Adds a shadow-casting mesh. `s` may be a uniform scale or per-axis. */
export function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, p?: V3, r?: V3, s?: V3 | number) {
  const mesh = new THREE.Mesh(geo, m);
  if (p) mesh.position.set(...p);
  if (r) mesh.rotation.set(...r);
  if (s !== undefined) typeof s === "number" ? mesh.scale.setScalar(s) : mesh.scale.set(...s);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export function joint(parent: THREE.Object3D, name: string, p: V3 = [0, 0, 0]) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(...p);
  parent.add(g);
  return g;
}

/** Merges each node's unnamed leaf meshes per material so a detailed figure costs a handful of draw calls. */
export function bake<T extends THREE.Object3D>(root: T): T {
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => nodes.push(o));
  for (const node of nodes) {
    const buckets = new Map<THREE.Material, THREE.Mesh[]>();
    for (const c of node.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || c.children.length || c.name || Array.isArray(m.material)) continue;
      const list = buckets.get(m.material as THREE.Material) ?? [];
      list.push(m);
      buckets.set(m.material as THREE.Material, list);
    }
    for (const [material, list] of buckets) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
        g.morphAttributes = {};
        return g.applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(geos);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      list.forEach((m) => node.remove(m));
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      node.add(mesh);
    }
  }
  return root;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _hy = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();

export interface ArmChain {
  shoulder: THREE.Object3D;
  elbow: THREE.Object3D;
  wrist: THREE.Object3D;
  upper: number;
  fore: number;
  hand: number;
}

/**
 * Two-bone IK in the shoulder's parent space. Puts the fist (hand length below the wrist) on `targetW`
 * with the grip axis along `axisW`; `pole` (parent space) chooses which way the elbow points.
 */
export function solveArm(arm: ArmChain, targetW: THREE.Vector3, axisW: THREE.Vector3, pole: THREE.Vector3) {
  const parent = arm.shoulder.parent!;
  parent.updateWorldMatrix(true, false);
  _m.copy(parent.matrixWorld).invert();
  _t.copy(targetW).applyMatrix4(_m);
  _ax.copy(axisW).transformDirection(_m);
  const S = arm.shoulder.position;
  _hy.copy(S).sub(_t);
  _hy.addScaledVector(_ax, -_hy.dot(_ax));
  if (_hy.lengthSq() < 1e-6) _hy.set(0, 1, 0);
  _hy.normalize();
  _w.copy(_t).addScaledVector(_hy, arm.hand);
  _d.copy(_w).sub(S);
  const L1 = arm.upper, L2 = arm.fore;
  const dist = THREE.MathUtils.clamp(_d.length(), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.001);
  _d.normalize();
  const cosA = THREE.MathUtils.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
  _n.crossVectors(_d, pole);
  if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
  _n.normalize();
  _u.copy(_d).applyAxisAngle(_n, Math.acos(cosA));
  _f.copy(S).addScaledVector(_u, L1);
  _f.subVectors(_w, _f).normalize();
  const cosB = THREE.MathUtils.clamp(_u.dot(_f), -1, 1);
  _z.copy(_f).addScaledVector(_u, -cosB);
  if (_z.lengthSq() < 1e-6) _z.crossVectors(_n, _u);
  _z.normalize();
  _v.copy(_u).negate();
  _x.crossVectors(_v, _z);
  _m.makeBasis(_x, _v, _z);
  arm.shoulder.quaternion.setFromRotationMatrix(_m);
  arm.elbow.rotation.set(-Math.acos(cosB), 0, 0);
  arm.elbow.updateMatrix();
  _x.crossVectors(_hy, _ax).normalize();
  _v.crossVectors(_ax, _x);
  _m.makeBasis(_x, _v, _ax);
  _q.setFromRotationMatrix(_m);
  _q2.copy(arm.shoulder.quaternion).multiply(arm.elbow.quaternion).invert();
  arm.wrist.quaternion.copy(_q2.multiply(_q));
}

/** Orients `obj` (in its parent's space) so local +Z = d and local +Y leans toward u. */
export function aim(obj: THREE.Object3D, p: ArrayLike<number>, i: number) {
  obj.position.set(p[i], p[i + 1], p[i + 2]);
  _z.set(p[i + 3], p[i + 4], p[i + 5]).normalize();
  _v.set(p[i + 6], p[i + 7], p[i + 8]);
  _v.addScaledVector(_z, -_v.dot(_z));
  if (_v.lengthSq() < 1e-6) _v.set(0, 1, 0).addScaledVector(_z, -_z.y);
  if (_v.lengthSq() < 1e-6) _v.set(1, 0, 0);
  _v.normalize();
  _x.crossVectors(_v, _z);
  _m.makeBasis(_x, _v, _z);
  obj.quaternion.setFromRotationMatrix(_m);
}
