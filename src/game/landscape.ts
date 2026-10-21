import * as THREE from "three";
import { WORLD_H } from "./balance";
import { mapBounds, rngFromSeed } from "./map";
import { materials } from "./models/materials";
import { buildTree } from "./models/nature";

/** Smooth value noise / fbm / ridged noise shared by the terrain, cliff walls and mountain backdrop. */

function hash(x: number, z: number, seed: number) {
  let n = (x * 374761393 + z * 668265263 + seed * 1274126177) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

export function vnoise(x: number, z: number, seed: number) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi, seed), b = hash(xi + 1, zi, seed), c = hash(xi, zi + 1, seed), d = hash(xi + 1, zi + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

export function fbm(x: number, z: number, seed: number, oct = 5) {
  let a = 0, f = 1, amp = 1, tot = 0;
  for (let i = 0; i < oct; i++) {
    a += amp * vnoise(x * f, z * f, seed + i * 97);
    tot += amp;
    f *= 2.03;
    amp *= 0.5;
  }
  return a / tot;
}

export function ridged(x: number, z: number, seed: number, oct = 5) {
  let a = 0, f = 1, amp = 1, tot = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise(x * f, z * f, seed + i * 131));
    a += amp * n * n;
    tot += amp;
    f *= 2.1;
    amp *= 0.5;
  }
  return a / tot;
}

const ROCK_WARM = new THREE.Color(0x9a8468);
const ROCK_GREY = new THREE.Color(0x7c7a76);
const ROCK_DARK = new THREE.Color(0x3e3a36);
const MOSS = new THREE.Color(0x5e6a2e);
const GRASS = new THREE.Color(0x7a7a34);
const SNOW = new THREE.Color(0xeef2f6);

function rockMaterial(bump = 3) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: materials.granite(1, 1).map });
  m.bumpMap = m.map;
  m.bumpScale = bump;
  return m;
}

/** Colour by strata, crevice depth and slope: grass/moss on ledges, layered rock on faces. */
function paintRock(geo: THREE.BufferGeometry, crevice: Float32Array, seed: number, snowLine = Infinity) {
  geo.computeVertexNormals();
  const p = geo.attributes.position as THREE.BufferAttribute;
  const n = geo.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const band = Math.sin(y * 0.45 + fbm(p.getX(i) * 0.05, p.getZ(i) * 0.05, seed) * 3) * 0.5 + 0.5;
    c.copy(ROCK_GREY).lerp(ROCK_WARM, band * 0.8);
    c.lerp(ROCK_DARK, THREE.MathUtils.clamp(crevice[i], 0, 1) * 0.65);
    const up = n.getY(i);
    if (up > 0.5) c.lerp(y > snowLine ? SNOW : up > 0.75 ? GRASS : MOSS, THREE.MathUtils.smoothstep(up, 0.5, 0.8));
    if (y > snowLine) c.lerp(SNOW, THREE.MathUtils.smoothstep(y - snowLine, 0, 18) * (0.4 + up * 0.6));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

let fallTex: THREE.CanvasTexture | null = null;
function waterfallTexture() {
  if (fallTex) return fallTex;
  const cv = document.createElement("canvas");
  cv.width = 128;
  cv.height = 512;
  const g = cv.getContext("2d")!;
  g.fillStyle = "rgba(150,200,220,0.75)";
  g.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * 128, len = 30 + Math.random() * 140, y = Math.random() * 512;
    g.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.5})`;
    g.fillRect(x, y, 1 + Math.random() * 2.5, len);
    if (y + len > 512) g.fillRect(x, y - 512, 2, len);
  }
  fallTex = new THREE.CanvasTexture(cv);
  fallTex.wrapS = fallTex.wrapT = THREE.RepeatWrapping;
  fallTex.colorSpace = THREE.SRGBColorSpace;
  return fallTex;
}

let mistTex: THREE.CanvasTexture | null = null;
function mistTexture() {
  if (mistTex) return mistTex;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return (mistTex = new THREE.CanvasTexture(cv));
}

const WALL_H = 74;

/** Craggy side walls running the full map length, with gorges where waterfalls spill into the valley. */
export function buildCliffs(seed: number) {
  const g = new THREE.Group();
  const rng = rngFromSeed(seed ^ 0x77e1);
  const L = WORLD_H + 260;
  for (const s of [-1, 1] as const) {
    const sd = seed + (s > 0 ? 501 : 0);
    const nFalls = 1 + Math.floor(rng() * 2);
    const falls = Array.from({ length: nFalls }, (_, i) => -WORLD_H / 2 + 110 + ((i + 0.3 + rng() * 0.4) / nFalls) * (WORLD_H - 220));
    const gorge = (z: number) => falls.reduce((m, f) => Math.max(m, Math.exp(-(((z - f) / 13) ** 2))), 0);
    const baseX = s * (mapBounds(seed).width / 2 + 24);
    const faceX = (z: number, y: number) => {
      const v = y / WALL_H;
      const crag = fbm(z * 0.035, y * 0.05, sd) * 10 + ridged(z * 0.07, y * 0.09, sd + 9) * 5;
      const strata = Math.sin(y * 0.5 + fbm(z * 0.02, y * 0.02, sd + 4) * 4) * 1.3;
      const lean = v * 18 + Math.max(0, v - 0.82) * 120;
      return baseX + s * (lean + gorge(z) * 9 * (0.4 + v) - crag - strata);
    };
    const topY = (z: number) => WALL_H * (0.82 + fbm(z * 0.012, 3, sd + 2) * 0.22) - gorge(z) * 9;

    const nu = 260, nv = 70;
    const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
    const uv = new Float32Array((nu + 1) * (nv + 1) * 2);
    const crevice = new Float32Array((nu + 1) * (nv + 1));
    for (let i = 0; i <= nu; i++) {
      const z = -L / 2 + (i / nu) * L;
      const top = topY(z);
      for (let j = 0; j <= nv; j++) {
        const k = i * (nv + 1) + j;
        const y = -6 + (j / nv) * (top + 6);
        const x = faceX(z, y);
        pos.set([x, y, z], k * 3);
        uv.set([z / 26, y / 26], k * 2);
        crevice[k] = 0.5 - ridged(z * 0.07, y * 0.09, sd + 9) * 0.9 + gorge(z) * 0.4;
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const a = i * (nv + 1) + j, b = a + nv + 1;
        if (s > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    paintRock(geo, crevice, sd);
    const wall = new THREE.Mesh(geo, rockMaterial());
    wall.castShadow = wall.receiveShadow = true;
    g.add(wall);

    // Grassy plateau above the rim, with a pine fringe.
    const plat = new THREE.PlaneGeometry(500, L, 70, 130).rotateX(-Math.PI / 2);
    const pp = plat.attributes.position as THREE.BufferAttribute;
    const pc = new Float32Array(pp.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pp.count; i++) {
      const z = pp.getZ(i);
      const off = pp.getX(i) + 250;
      const rimX = faceX(z, topY(z)) - baseX;
      pp.setX(i, baseX + s * (Math.max(off, 0) + Math.abs(rimX) - 1));
      pp.setY(i, topY(z) - 0.5 + fbm(off * 0.03, z * 0.03, sd + 7) * 6 + Math.min(off, 60) * 0.12);
      c.copy(GRASS).lerp(MOSS, fbm(off * 0.05, z * 0.05, sd + 8) * 0.5 + 0.5);
      pc.set([c.r, c.g, c.b], i * 3);
    }
    plat.setAttribute("color", new THREE.BufferAttribute(pc, 3));
    plat.computeVertexNormals();
    if (s < 0) {
      const ix = plat.index!;
      for (let i = 0; i < ix.count; i += 3) {
        const t = ix.getX(i + 1);
        ix.setX(i + 1, ix.getX(i + 2));
        ix.setX(i + 2, t);
      }
      plat.computeVertexNormals();
    }
    const plateau = new THREE.Mesh(plat, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    plateau.receiveShadow = true;
    g.add(plateau);
    for (let i = 0; i < 26; i++) {
      const z = -L / 2 + rng() * L;
      if (gorge(z) > 0.2) continue;
      const off = 4 + rng() * 40;
      const tree = buildTree(rng() < 0.7 ? "pine" : "poplar", rng() * 3, 20 + rng() * 14);
      tree.position.set(faceX(z, topY(z)) + s * off, topY(z) + off * 0.12 - 1, z);
      g.add(tree);
    }

    for (const fz of falls) g.add(waterfall(s, fz, faceX, topY(fz)));
  }
  return g;
}

function waterfall(s: -1 | 1, z0: number, faceX: (z: number, y: number) => number, top: number) {
  const g = new THREE.Group();
  const tex = waterfallTexture().clone();
  tex.needsUpdate = true;
  tex.repeat.set(1, 2.5);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.15,
    emissive: 0x6a8a98,
    emissiveIntensity: 0.35,
  });
  const rows = 40, half = 5.5;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    const y = top + 1 - v * (top + 2);
    const spread = half * (0.7 + v * 0.5);
    for (const e of [-1, 1]) {
      const z = z0 + e * spread;
      const x = Math.min(s * faceX(z, y), s * faceX(z0, y)) * s - s * (2.2 + Math.sin(v * Math.PI) * 3.5);
      pos.push(x, y, z);
      uv.push((e + 1) / 2, v * 3);
    }
    if (j < rows) idx.push(j * 2, j * 2 + 2, j * 2 + 1, j * 2 + 1, j * 2 + 2, j * 2 + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const sheet = new THREE.Mesh(geo, mat);
  sheet.onBeforeRender = () => (tex.offset.y = (performance.now() / 1000) * 1.1);
  g.add(sheet);

  const baseX = faceX(z0, 0) - s * 9;
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(11, 40).rotateX(-Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ color: 0x3f91b0, roughness: 0.15, transparent: true, opacity: 0.9, clearcoat: 0.8 }),
  );
  pool.position.set(baseX, 0.4, z0);
  pool.scale.set(1, 1, 1.4);
  pool.receiveShadow = true;
  g.add(pool);
  const foamTex = waterfallTexture().clone();
  foamTex.needsUpdate = true;
  const foam = new THREE.Mesh(
    new THREE.RingGeometry(2, 9, 40, 3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  foam.position.set(baseX + s * 4, 0.6, z0);
  foam.onBeforeRender = () => (foam.rotation.y = performance.now() / 4000);
  g.add(foam);
  for (let i = 0; i < 4; i++) {
    const mist = new THREE.Sprite(new THREE.SpriteMaterial({ map: mistTexture(), transparent: true, opacity: 0.35, depthWrite: false }));
    mist.position.set(baseX + s * (3 + i * 1.5), 3 + i * 3.5, z0 + (i - 1.5) * 3);
    mist.scale.setScalar(12 + i * 3);
    mist.onBeforeRender = () => (mist.material.opacity = 0.26 + Math.sin(performance.now() / 700 + i) * 0.08);
    g.add(mist);
  }
  for (const r of [0, 1, 2]) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2 + r, 2), rockMaterial(1));
    const rp = rock.geometry.attributes.position as THREE.BufferAttribute;
    rock.geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(rp.count * 3).fill(0.55), 3));
    rock.position.set(baseX + s * (5 + r * 2), 0.5, z0 + (r - 1) * 9);
    rock.castShadow = true;
    g.add(rock);
  }
  return g;
}

/** Snow-capped ridged range behind the foe's end of the valley and wrapping round the flanks. */
export function buildBackdrop(seed: number) {
  const halfW = mapBounds(seed).width / 2;
  const sizeX = halfW * 2 + 900, sizeZ = 420;
  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, 260, 110).rotateX(-Math.PI / 2);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const crevice = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const back = (sizeZ / 2 - z) / sizeZ;
    const side = Math.max(0, Math.abs(x) - (halfW + 60)) / 300;
    const rise = THREE.MathUtils.smoothstep(back, 0.05, 0.5) + side * 0.6;
    const r = ridged(x * 0.008, z * 0.008, seed + 33, 6);
    p.setY(i, 30 + rise * (40 + r * 150) + fbm(x * 0.03, z * 0.03, seed + 34) * 8);
    crevice[i] = 0.55 - r * 0.8;
  }
  const uvs = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * (sizeX / 40), uvs.getY(i) * (sizeZ / 40));
  geo.translate(0, 0, -WORLD_H / 2 - 40 - sizeZ / 2);
  paintRock(geo, crevice, seed, 135);
  const m = new THREE.Mesh(geo, rockMaterial(2));
  m.receiveShadow = true;
  return m;
}
