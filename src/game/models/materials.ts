import * as THREE from "three";
import type { Team } from "../types";

/** Procedural canvas textures + helpers shared by the hand-built structure models. */

/**
 * Mobile GPUs often fail the lit color pass for MeshStandardMaterial when the
 * same CanvasTexture is bound as both `map` (sRGB) and `bumpMap` (must be
 * linear / NoColorSpace). Depth/shadow still works, so buildings cast correct
 * shadows but only untextured emissive windows remain visible (yellow stubs).
 * Configure before the first `materials.*()` call from the renderer.
 */
let texAnisotropy = 8;
let allowBump = true;
let canvasSize = 512;

export function configureStructureMaterials(opts: { anisotropy: number; bump: boolean; canvasSize?: number }) {
  texAnisotropy = Math.max(1, opts.anisotropy);
  allowBump = opts.bump;
  if (opts.canvasSize) canvasSize = opts.canvasSize;
  for (const tex of Object.values(shared)) {
    if (!tex) continue;
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
    if (!allowBump && mat.bumpMap) {
      mat.bumpMap = null;
      mat.bumpScale = 0;
      changed = true;
    } else if (allowBump && mat.map && !mat.bumpMap && (mat.userData.bumpScale as number) > 0) {
      mat.bumpMap = bumpFromAlbedo(mat.map);
      mat.bumpScale = mat.userData.bumpScale as number;
      changed = true;
    }
    if (changed) mat.needsUpdate = true;
  }
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function canvas(size: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = texAnisotropy;
  t.needsUpdate = true;
  return t;
}

/** Bump sampling is non-color data — never share the sRGB albedo Texture object. */
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

/** Linear bump clone, or null when bump maps are disabled for the device. */
export function cloneBumpMap(albedo: THREE.Texture | null | undefined): THREE.Texture | null {
  if (!albedo || !allowBump) return null;
  return bumpFromAlbedo(albedo);
}

const shade = (base: [number, number, number], k: number) =>
  `rgb(${base.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(",")})`;

/** Irregular coursed stone blocks with mortar. */
function stoneTex() {
  const s = canvasSize;
  return canvas(
    s,
    (g, r) => {
      g.fillStyle = "#5e584e";
      g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += s / 16) {
        let x = -r() * (s * 0.12);
        while (x < s) {
          const w = s * 0.07 + r() * s * 0.11;
          g.fillStyle = shade([178, 170, 155], 0.75 + r() * 0.4);
          g.fillRect(x + 2, y + 2, w - 4, s / 16 - 4);
          g.fillStyle = "rgba(255,255,255,0.08)";
          g.fillRect(x + 2, y + 2, w - 4, 4);
          g.fillStyle = "rgba(0,0,0,0.18)";
          g.fillRect(x + 2, y + s / 16 - 7, w - 4, 5);
          x += w;
        }
      }
      for (let i = 0; i < (s * s) / 50; i++) {
        g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.08)";
        g.fillRect(r() * s, r() * s, 2, 2);
      }
      for (let i = 0; i < 60; i++) {
        g.fillStyle = "rgba(70,90,50,0.18)";
        g.beginPath();
        g.arc(r() * s, r() * s, 4 + r() * 14, 0, 7);
        g.fill();
      }
    },
    11,
  );
}

/** Weathered granite: blotchy tones with dark cracks. */
function rockTex() {
  const s = canvasSize;
  return canvas(
    s,
    (g, r) => {
      g.fillStyle = "#8a867e";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = shade([140, 136, 128], 0.7 + r() * 0.5);
        g.beginPath();
        g.ellipse(r() * s, r() * s, 10 + r() * 40, 6 + r() * 24, r() * 3, 0, 7);
        g.fill();
      }
      g.strokeStyle = "rgba(30,28,25,0.55)";
      for (let i = 0; i < 40; i++) {
        g.lineWidth = 1 + r() * 2.5;
        g.beginPath();
        let x = r() * s, y = r() * s;
        g.moveTo(x, y);
        for (let k = 0; k < 6; k++) g.lineTo((x += (r() - 0.5) * 60), (y += r() * 40));
        g.stroke();
      }
      for (let i = 0; i < 80; i++) {
        g.fillStyle = "rgba(90,110,60,0.22)";
        g.beginPath();
        g.arc(r() * s, r() * s, 3 + r() * 12, 0, 7);
        g.fill();
      }
    },
    53,
  );
}

/** Overlapping rounded slate / shingle scales. */
function slateTex() {
  const s = canvasSize;
  return canvas(
    s,
    (g, r) => {
      g.fillStyle = "#2a2a2e";
      g.fillRect(0, 0, s, s);
      const w = s / 16, h = s / 21;
      for (let row = 0; row < s / h + 1; row++) {
        const off = row % 2 ? w / 2 : 0;
        for (let x = -w; x < s + w; x += w) {
          const v = 0.7 + r() * 0.45;
          g.fillStyle = shade([200, 200, 205], v);
          g.beginPath();
          g.moveTo(x + off + 1, row * h);
          g.lineTo(x + off + w - 1, row * h);
          g.lineTo(x + off + w - 1, row * h + h * 0.8);
          g.quadraticCurveTo(x + off + w / 2, row * h + h * 1.35, x + off + 1, row * h + h * 0.8);
          g.fill();
          g.fillStyle = "rgba(0,0,0,0.25)";
          g.fillRect(x + off + 1, row * h, w - 2, 3);
        }
      }
    },
    23,
  );
}

/** Cream plaster with dark timber framing and cross braces. */
function timberTex() {
  const s = canvasSize;
  return canvas(
    s,
    (g, r) => {
      g.fillStyle = "#d8ccb0";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < (s * s) / 85; i++) {
        g.fillStyle = r() < 0.5 ? "rgba(120,100,70,0.08)" : "rgba(255,255,255,0.1)";
        g.fillRect(r() * s, r() * s, 3, 3);
      }
      g.fillStyle = "#3e2a1a";
      const beam = Math.max(10, s * 0.04);
      g.fillRect(0, 0, s, beam);
      g.fillRect(0, s - beam, s, beam);
      g.fillRect(0, s / 2 - beam / 2, s, beam * 0.75);
      for (let x = 0; x < s; x += s / 4) g.fillRect(x, 0, beam * 0.85, s);
      g.lineWidth = beam * 0.65;
      g.strokeStyle = "#3e2a1a";
      for (let x = 0; x < s; x += s / 4) {
        g.beginPath();
        g.moveTo(x + beam / 2, beam);
        g.lineTo(x + s / 4, s / 2);
        g.moveTo(x + beam / 2, s - beam);
        g.lineTo(x + s / 4, s / 2 + beam);
        g.stroke();
      }
    },
    37,
  );
}

function woodTex() {
  const s = Math.min(256, canvasSize);
  return canvas(
    s,
    (g, r) => {
      g.fillStyle = "#5a3c22";
      g.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x += s / 8) {
        g.fillStyle = shade([100, 68, 40], 0.8 + r() * 0.35);
        g.fillRect(x + 1, 0, s / 8 - 2, s);
        for (let i = 0; i < 20; i++) {
          g.fillStyle = "rgba(0,0,0,0.15)";
          g.fillRect(x + 2 + r() * (s / 8 - 6), r() * s, 1, 20 + r() * 50);
        }
      }
    },
    41,
  );
}

type TexName = "stone" | "rock" | "slate" | "timber" | "wood";
const shared: Partial<Record<TexName, THREE.Texture>> = {};
function base(name: TexName) {
  return (shared[name] ??= { stone: stoneTex, rock: rockTex, slate: slateTex, timber: timberTex, wood: woodTex }[name]());
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** Material with its own repeat; textures share one canvas source. Cached per (texture, repeat, color). */
function mat(name: TexName, rx: number, ry: number, color = 0xffffff, bump = 0) {
  rx = Math.round(rx * 4) / 4 || 0.25;
  ry = Math.round(ry * 4) / 4 || 0.25;
  const key = `${name}|${rx}|${ry}|${color}|${bump}`;
  let m = matCache.get(key);
  if (!m) {
    const t = base(name).clone();
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(rx, ry);
    t.anisotropy = texAnisotropy;
    t.needsUpdate = true;
    const bumpMap = bump && allowBump ? bumpFromAlbedo(t) : null;
    m = new THREE.MeshStandardMaterial({
      map: t,
      bumpMap,
      bumpScale: bumpMap ? bump : 0,
      color,
      roughness: 0.9,
    });
    m.userData.bumpScale = bump;
    matCache.set(key, m);
  }
  return m;
}

export const TEAM_ROOF: Record<Team, number> = { you: 0xb4cff8, foe: 0xf4a090 };
export const TEAM_CLOTH: Record<Team, number> = { you: 0x2f63b8, foe: 0xa82a2a };

export const materials = {
  stone: (rx = 1, ry = 1) => mat("stone", rx, ry, 0xfff4e4, 1.2),
  granite: (rx = 1, ry = 1) => mat("rock", rx, ry, 0xffffff, 2),
  slate: (team: Team, rx = 1, ry = 1) => mat("slate", rx, ry, TEAM_ROOF[team]),
  timber: (rx = 1, ry = 1) => mat("timber", rx, ry),
  wood: (rx = 1, ry = 1) => mat("wood", rx, ry),
  window: () => new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: 0xffa040, emissiveIntensity: 1.6 }),
  cloth: (team: Team) => new THREE.MeshStandardMaterial({ color: TEAM_CLOTH[team], roughness: 0.8, side: THREE.DoubleSide }),
  iron: () => new THREE.MeshStandardMaterial({ color: 0x2c2c30, roughness: 0.5, metalness: 0.7 }),
};

/** Box whose texture tiles at a fixed world size on every face. */
export function tiledBox(w: number, h: number, d: number, material: (rx: number, ry: number) => THREE.Material, tile = 14) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const faces: [number, number][] = [
    [d, h], [d, h], [w, d], [w, d], [w, h], [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let i = 0; i < 4; i++) uv.setXY(f * 4 + i, uv.getX(f * 4 + i) * (faces[f][0] / tile), uv.getY(f * 4 + i) * (faces[f][1] / tile));
  const m = new THREE.Mesh(geo, material(1, 1));
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Concave, flared spire roof like the concept art (sides=4 gives a flared hip roof). */
export function flaredRoof(radius: number, height: number, team: Team, sides = 16) {
  const pts = [
    new THREE.Vector2(radius * 1.12, -height * 0.04),
    new THREE.Vector2(radius * 0.85, height * 0.1),
    new THREE.Vector2(radius * 0.5, height * 0.38),
    new THREE.Vector2(radius * 0.18, height * 0.72),
    new THREE.Vector2(0, height),
  ];
  const geo = new THREE.LatheGeometry(pts, sides, sides === 4 ? Math.PI / 4 : 0);
  const m = new THREE.Mesh(geo, materials.slate(team, Math.max(2, radius * 1.4), Math.max(1, height / 3)));
  m.castShadow = true;
  return m;
}

export function roundTower(radius: number, height: number) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.08, height, 20),
    materials.stone((Math.PI * 2 * radius) / 14, height / 14),
  );
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Ring of merlons along a rectangle's edge (crenellated parapet). */
export function crenellate(w: number, d: number, y: number, size = 1.4) {
  const g = new THREE.Group();
  const stone = materials.stone(0.3, 0.3);
  const geo = new THREE.BoxGeometry(size, size * 1.2, size);
  const edge = (len: number, place: (t: number) => [number, number]) => {
    const n = Math.max(2, Math.floor(len / (size * 2)));
    for (let i = 0; i <= n; i++) {
      const [x, z] = place(-len / 2 + (i / n) * len);
      const m = new THREE.Mesh(geo, stone);
      m.position.set(x, y + size * 0.6, z);
      m.castShadow = true;
      g.add(m);
    }
  };
  edge(w, (t) => [t, d / 2]);
  edge(w, (t) => [t, -d / 2]);
  edge(d, (t) => [w / 2, t]);
  edge(d, (t) => [-w / 2, t]);
  return g;
}

export function banner(team: Team, h = 4) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h + 2, 6), materials.iron());
  pole.position.y = (h + 2) / 2;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(h * 0.7, h * 0.45, 6, 1), materials.cloth(team));
  const p = flag.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + h) * 1.4) * 0.25);
  flag.position.set(h * 0.35, h + 1.4, 0);
  g.add(pole, flag);
  return g;
}

export function windowAt(x: number, y: number, z: number, rotY: number, w = 1, h = 1.8) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), materials.window());
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  return m;
}
