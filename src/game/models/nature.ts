import * as THREE from "three";
import { materials } from "./materials";

/** Hand-built trees and rock piles. Each variant is built once; instances are clones sharing geometry. */

export type TreeKind = "oak" | "pine" | "birch" | "poplar" | "maple";
export const SCENERY_TREES: TreeKind[] = ["pine", "birch", "poplar", "maple"];

const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
const needleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide });
const bark = new THREE.MeshStandardMaterial({ color: 0x4e3826, roughness: 1, flatShading: true });
const birchBark = new THREE.MeshStandardMaterial({ color: 0xe4ded0, roughness: 0.9, flatShading: true });

function rng(seed: number) {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Lumpy foliage blob with per-vertex tint (darker underneath). */
function clump(r: number, hex: number, r01: () => number, sy = 1) {
  const geo = new THREE.IcosahedronGeometry(r, 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const base = new THREE.Color(hex);
  const phase = r01() * 10;
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + Math.sin(x * 1.7 + phase) * Math.cos(z * 1.9 + phase) * 0.18 + Math.sin(y * 2.3) * 0.08;
    p.setXYZ(i, x * k, y * k * sy, z * k);
    const shadeK = (0.82 + ((Math.sin(x * 3 + y * 5 + z * 7 + phase) + 1) / 2) * 0.3) * (y < 0 ? 0.72 : 1);
    c.copy(base).multiplyScalar(shadeK).toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, leafMat);
}

function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, mat: THREE.Material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, a.distanceTo(b), 7), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Broad oak: thick trunk, spreading limbs, layered crown (~30 tall). */
function oak(r: () => number) {
  const g = new THREE.Group();
  g.add(limb(V(0, 0, 0), V(0, 12, 0), 2.2, 1.4, bark));
  const greens = [0x5f8a32, 0x6f9a3a, 0x557d2c];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + r() * 0.6;
    const end = V(Math.cos(a) * 8, 15 + r() * 4, Math.sin(a) * 8);
    g.add(limb(V(0, 10 + r() * 2, 0), end, 0.9, 0.4, bark));
    const c = clump(5.5 + r() * 1.5, greens[i % 3], r, 0.8);
    c.position.copy(end).add(V(0, 2, 0));
    g.add(c);
  }
  const top = clump(8, greens[1], r, 0.75);
  top.position.y = 22;
  g.add(top);
  return g;
}

/** Tiered conifer with drooping skirts (~26 tall). */
function pine(r: () => number) {
  const g = new THREE.Group();
  g.add(limb(V(0, 0, 0), V(0, 24, 0), 1, 0.3, bark));
  for (let i = 0; i < 6; i++) {
    const rad = 7 - i * 1.05;
    const geo = new THREE.ConeGeometry(rad, 6.5 - i * 0.4, 9, 2, true);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let j = 0; j < p.count; j++) {
      const y = p.getY(j);
      const jag = y < -1 ? 1 + (Math.sin(j * 2.7) * 0.12) : 1;
      p.setX(j, p.getX(j) * jag);
      p.setZ(j, p.getZ(j) * jag);
      if (y < -1) p.setY(j, y - Math.abs(Math.sin(j * 1.3)) * 0.8);
      c.setHex(0x2f5a35).multiplyScalar(y < 0 ? 0.75 + r() * 0.15 : 1 + r() * 0.15).toArray(colors, j * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const tier = new THREE.Mesh(geo, needleMat);
    tier.position.y = 6 + i * 3.3;
    tier.rotation.y = r() * 3;
    g.add(tier);
  }
  return g;
}

/** Slender leaning birch, pale bark, airy yellow-green clumps (~22 tall). */
function birch(r: () => number) {
  const g = new THREE.Group();
  const lean = V(r() * 2 - 1, 0, r() * 2 - 1).multiplyScalar(1.5);
  const top = V(lean.x, 18, lean.z);
  g.add(limb(V(0, 0, 0), top, 0.8, 0.35, birchBark));
  for (let i = 0; i < 6; i++) {
    const h = 9 + i * 1.8;
    const a = r() * Math.PI * 2;
    const at = V((lean.x * h) / 18, h, (lean.z * h) / 18);
    const end = at.clone().add(V(Math.cos(a) * 3.5, 2, Math.sin(a) * 3.5));
    g.add(limb(at, end, 0.25, 0.12, birchBark));
    const c = clump(2.6 + r(), i % 2 ? 0x9ab84a : 0x86a83e, r, 1.2);
    c.position.copy(end);
    g.add(c);
  }
  const crown = clump(3.2, 0x9ab84a, r, 1.3);
  crown.position.copy(top).add(V(0, 1.5, 0));
  g.add(crown);
  return g;
}

/** Columnar poplar of stacked narrow clumps (~26 tall). */
function poplar(r: () => number) {
  const g = new THREE.Group();
  g.add(limb(V(0, 0, 0), V(0, 20, 0), 1, 0.4, bark));
  for (let i = 0; i < 6; i++) {
    const c = clump(3.4 - Math.abs(i - 2) * 0.35, i % 2 ? 0x4f7a2c : 0x5a8632, r, 1.6);
    c.position.set(r() - 0.5, 7 + i * 3.2, r() - 0.5);
    g.add(c);
  }
  return g;
}

/** Round autumn maple in amber/russet to suit the golden fields (~22 tall). */
function maple(r: () => number) {
  const g = new THREE.Group();
  g.add(limb(V(0, 0, 0), V(0, 9, 0), 1.5, 1, bark));
  const tones = [0xc8642a, 0xd89a30, 0xb84a26, 0xe0b040];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const rad = i === 6 ? 0 : 4.5;
    const end = V(Math.cos(a) * rad, 13 + (i === 6 ? 5 : r() * 3), Math.sin(a) * rad);
    g.add(limb(V(0, 8, 0), end, 0.6, 0.3, bark));
    const c = clump(4.2 + r() * 1.2, tones[i % 4], r, 0.85);
    c.position.copy(end);
    g.add(c);
  }
  return g;
}

const BUILDERS: Record<TreeKind, { make: (r: () => number) => THREE.Group; height: number }> = {
  oak: { make: oak, height: 30 },
  pine: { make: pine, height: 26 },
  birch: { make: birch, height: 22 },
  poplar: { make: poplar, height: 26 },
  maple: { make: maple, height: 22 },
};

const protos = new Map<string, THREE.Group>();
function proto(key: string, make: () => THREE.Group) {
  let p = protos.get(key);
  if (!p) {
    p = make();
    p.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    protos.set(key, p);
  }
  return p;
}

/** Tree of the given kind scaled to `height`; `variant` picks one of 3 prebuilt shapes. */
export function buildTree(kind: TreeKind, variant: number, height?: number) {
  const b = BUILDERS[kind];
  const v = Math.abs(Math.floor(variant)) % 3;
  const t = proto(`${kind}-${v}`, () => b.make(rng(v * 131 + kind.length * 17))).clone();
  if (height) t.scale.setScalar(height / b.height);
  return t;
}

const rockMat = (() => {
  const m = materials.granite(1, 1).clone();
  m.color.setHex(0xd8d0c4);
  m.flatShading = true;
  return m;
})();

/** Natural pile of weathered boulders and scree (~3 tall, ~8 across at scale 1). */
export function buildRockPile(variant: number, scale = 1) {
  const v = Math.abs(Math.floor(variant)) % 3;
  const g = proto(`rocks-${v}`, () => {
    const r = rng(v * 71 + 5);
    const pile = new THREE.Group();
    const n = 4 + v * 2;
    for (let i = 0; i < n; i++) {
      const big = i < 2;
      const geo = new THREE.DodecahedronGeometry(big ? 2.4 : 0.8 + r() * 0.9, 1);
      const p = geo.attributes.position as THREE.BufferAttribute;
      const ph = r() * 9;
      for (let j = 0; j < p.count; j++) {
        const k = 1 + Math.sin(p.getX(j) * 2.1 + ph) * Math.cos(p.getZ(j) * 1.7 + ph) * 0.2;
        p.setXYZ(j, p.getX(j) * k, p.getY(j) * k * 0.7, p.getZ(j) * k);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, rockMat);
      const a = r() * Math.PI * 2;
      const d = big ? i * 2 : 2.5 + r() * 2.5;
      m.position.set(Math.cos(a) * d, big ? 1.2 : 0.4, Math.sin(a) * d);
      m.rotation.set(r() * 3, r() * 3, r() * 3);
      pile.add(m);
    }
    return pile;
  }).clone();
  g.scale.setScalar(scale);
  return g;
}
