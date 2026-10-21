import * as THREE from "three";
import type { Team } from "../types";

/** Procedural canvas textures + helpers shared by the hand-built structure models. */

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
  t.anisotropy = 8;
  return t;
}

const shade = (base: [number, number, number], k: number) =>
  `rgb(${base.map((v) => Math.max(0, Math.min(255, Math.round(v * k)))).join(",")})`;

/** Irregular coursed stone blocks with mortar. */
function stoneTex() {
  return canvas(
    512,
    (g, r) => {
      g.fillStyle = "#5e584e";
      g.fillRect(0, 0, 512, 512);
      for (let y = 0; y < 512; y += 32) {
        let x = -r() * 60;
        while (x < 512) {
          const w = 38 + r() * 54;
          g.fillStyle = shade([178, 170, 155], 0.75 + r() * 0.4);
          g.fillRect(x + 2, y + 2, w - 4, 28);
          g.fillStyle = "rgba(255,255,255,0.08)";
          g.fillRect(x + 2, y + 2, w - 4, 4);
          g.fillStyle = "rgba(0,0,0,0.18)";
          g.fillRect(x + 2, y + 25, w - 4, 5);
          x += w;
        }
      }
      for (let i = 0; i < 5000; i++) {
        g.fillStyle = r() < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.08)";
        g.fillRect(r() * 512, r() * 512, 2, 2);
      }
      for (let i = 0; i < 60; i++) {
        g.fillStyle = "rgba(70,90,50,0.18)";
        g.beginPath();
        g.arc(r() * 512, r() * 512, 4 + r() * 14, 0, 7);
        g.fill();
      }
    },
    11,
  );
}

/** Weathered granite: blotchy tones with dark cracks. */
function rockTex() {
  return canvas(
    512,
    (g, r) => {
      g.fillStyle = "#8a867e";
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = shade([140, 136, 128], 0.7 + r() * 0.5);
        g.beginPath();
        g.ellipse(r() * 512, r() * 512, 10 + r() * 40, 6 + r() * 24, r() * 3, 0, 7);
        g.fill();
      }
      g.strokeStyle = "rgba(30,28,25,0.55)";
      for (let i = 0; i < 40; i++) {
        g.lineWidth = 1 + r() * 2.5;
        g.beginPath();
        let x = r() * 512, y = r() * 512;
        g.moveTo(x, y);
        for (let k = 0; k < 6; k++) g.lineTo((x += (r() - 0.5) * 60), (y += r() * 40));
        g.stroke();
      }
      for (let i = 0; i < 80; i++) {
        g.fillStyle = "rgba(90,110,60,0.22)";
        g.beginPath();
        g.arc(r() * 512, r() * 512, 3 + r() * 12, 0, 7);
        g.fill();
      }
    },
    53,
  );
}

/** Overlapping rounded slate / shingle scales. */
function slateTex() {
  return canvas(
    512,
    (g, r) => {
      g.fillStyle = "#2a2a2e";
      g.fillRect(0, 0, 512, 512);
      const w = 32, h = 24;
      for (let row = 0; row < 512 / h + 1; row++) {
        const off = row % 2 ? w / 2 : 0;
        for (let x = -w; x < 512 + w; x += w) {
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
  return canvas(
    512,
    (g, r) => {
      g.fillStyle = "#d8ccb0";
      g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 3000; i++) {
        g.fillStyle = r() < 0.5 ? "rgba(120,100,70,0.08)" : "rgba(255,255,255,0.1)";
        g.fillRect(r() * 512, r() * 512, 3, 3);
      }
      g.fillStyle = "#3e2a1a";
      g.fillRect(0, 0, 512, 22);
      g.fillRect(0, 490, 512, 22);
      g.fillRect(0, 245, 512, 16);
      for (let x = 0; x < 512; x += 128) g.fillRect(x, 0, 18, 512);
      g.lineWidth = 14;
      g.strokeStyle = "#3e2a1a";
      for (let x = 0; x < 512; x += 128) {
        g.beginPath();
        g.moveTo(x + 9, 22);
        g.lineTo(x + 128, 245);
        g.moveTo(x + 9, 490);
        g.lineTo(x + 128, 261);
        g.stroke();
      }
    },
    37,
  );
}

function woodTex() {
  return canvas(
    256,
    (g, r) => {
      g.fillStyle = "#5a3c22";
      g.fillRect(0, 0, 256, 256);
      for (let x = 0; x < 256; x += 32) {
        g.fillStyle = shade([100, 68, 40], 0.8 + r() * 0.35);
        g.fillRect(x + 1, 0, 30, 256);
        for (let i = 0; i < 20; i++) {
          g.fillStyle = "rgba(0,0,0,0.15)";
          g.fillRect(x + 2 + r() * 26, r() * 256, 1, 20 + r() * 50);
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
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    m = new THREE.MeshStandardMaterial({ map: t, bumpMap: bump ? t : null, bumpScale: bump, color, roughness: 0.9 });
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
