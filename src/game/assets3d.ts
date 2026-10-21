import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/** Kenney CC0 (kenney.nl) + a few local glTFs. See public/models/kenney/CREDITS.txt */
export type ModelKey =
  | "oak"
  | "blue"
  | "red"
  | "white"
  | "sword"
  | "mindflayer"
  | "hero"
  | "kOak"
  | "kPine"
  | "kPine2"
  | "kCone"
  | "kLogs"
  | "kLog"
  | "kRock"
  | "kRock2"
  | "kStone"
  | "kBush"
  | "kTower"
  | "kKeep"
  | "kBallista"
  | "kCatapult"
  | "kRam"
  | "kWall"
  | "kGate"
  | "kFlag"
  | "kCharA"
  | "kCharB"
  | "kCharC"
  | "horse"
  | "knight";

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

const URLS: Record<ModelKey, string> = {
  oak: asset("models/oak-tree.glb"),
  blue: asset("models/blue-player.glb"),
  red: asset("models/red-player.glb"),
  white: asset("models/white-player.glb"),
  sword: asset("models/sword.glb"),
  mindflayer: asset("models/mindflayer.glb"),
  hero: asset("models/player-hero.glb"),
  kOak: asset("models/kenney/nature-tree_oak.glb"),
  kPine: asset("models/kenney/nature-tree_pineDefaultA.glb"),
  kPine2: asset("models/kenney/nature-tree_pineRoundC.glb"),
  kCone: asset("models/kenney/nature-tree_cone_dark.glb"),
  kLogs: asset("models/kenney/nature-log_stack.glb"),
  kLog: asset("models/kenney/nature-log.glb"),
  kRock: asset("models/kenney/nature-rock_largeA.glb"),
  kRock2: asset("models/kenney/nature-rock_largeC.glb"),
  kStone: asset("models/kenney/nature-stone_largeA.glb"),
  kBush: asset("models/kenney/nature-plant_bushLarge.glb"),
  kTower: asset("models/kenney/castle-tower-square.glb"),
  kKeep: asset("models/kenney/castle-tower-base.glb"),
  kBallista: asset("models/kenney/castle-siege-ballista.glb"),
  kCatapult: asset("models/kenney/castle-siege-catapult.glb"),
  kRam: asset("models/kenney/castle-siege-ram.glb"),
  kWall: asset("models/kenney/castle-wall.glb"),
  kGate: asset("models/kenney/castle-gate.glb"),
  kFlag: asset("models/kenney/castle-flag.glb"),
  kCharA: asset("models/kenney/chars/character-a.glb"),
  kCharB: asset("models/kenney/chars/character-b.glb"),
  kCharC: asset("models/kenney/chars/character-c.glb"),
  horse: asset("models/horse.glb"),
  // Same file as `hero`, loaded without its KTX2 textures so it does not need a
  // basis transcoder. Team armor is painted on the clone.
  knight: asset("models/player-hero.glb"),
};

interface ModelTemplate {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

const cache = new Map<ModelKey, ModelTemplate>();
let loadPromise: Promise<void> | null = null;

/**
 * One Kenney atlas shared by every nature tree, log, and mine.
 * Clones share this texture. Quality may change its anisotropy, but nothing
 * may dispose it or null a material.map that points at it.
 */
const sharedAlbedo = new Set<THREE.Texture>();
let sharedAnisotropy = 4;
let colormap: THREE.Texture | null = null;

interface Swatch {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Rectangles inside colormap.png (v = 0 at the top, matching glTF flipY:false). */
function swatchFor(name: string, key: ModelKey): Swatch {
  const n = name.toLowerCase();
  if (n.includes("inner")) return { u0: 0.885, v0: 0.8, u1: 0.93, v1: 0.96 };
  if ((n.includes("leaf") || n.includes("grass")) && n.includes("dark")) return { u0: 0.07, v0: 0.64, u1: 0.115, v1: 0.72 };
  if (n.includes("leaf") || n.includes("grass") || n.includes("bush")) return { u0: 0.07, v0: 0.54, u1: 0.115, v1: 0.72 };
  if ((n.includes("wood") || n.includes("bark") || n.includes("log")) && n.includes("dark")) return { u0: 0.64, v0: 0.9, u1: 0.7, v1: 0.98 };
  if (n.includes("wood") || n.includes("bark") || n.includes("log")) return { u0: 0.64, v0: 0.78, u1: 0.7, v1: 0.98 };
  if (n.includes("stone")) return { u0: 0.14, v0: 0.8, u1: 0.22, v1: 0.96 };
  if (n.includes("dirt") || n.includes("rock") || n.includes("sand")) return { u0: 0.76, v0: 0.8, u1: 0.805, v1: 0.96 };
  const k = key.toLowerCase();
  if (k === "oak" || k === "koak" || k.includes("pine") || k.includes("cone") || k.includes("bush")) {
    return { u0: 0.07, v0: 0.54, u1: 0.115, v1: 0.72 };
  }
  if (k.includes("log")) return { u0: 0.64, v0: 0.78, u1: 0.7, v1: 0.98 };
  if (k.includes("stone") || k.includes("rock")) return { u0: 0.14, v0: 0.8, u1: 0.22, v1: 0.96 };
  return { u0: 0.885, v0: 0.8, u1: 0.93, v1: 0.96 };
}

function uvsFitAtlas(geo: THREE.BufferGeometry) {
  const uv = geo.getAttribute("uv");
  if (!uv || uv.count === 0) return false;
  const n = Math.min(uv.count, 48);
  for (let i = 0; i < n; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < -0.05 || v < -0.05 || u > 1.05 || v > 1.05) return false;
  }
  return true;
}

function loadColormap(): Promise<THREE.Texture | null> {
  if (colormap) return Promise.resolve(colormap);
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      asset("models/kenney/Textures/colormap.png"),
      (tex) => {
        tex.name = "kenney-colormap";
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.anisotropy = sharedAnisotropy;
        tex.needsUpdate = true;
        tex.userData.sharedAlbedo = true;
        sharedAlbedo.add(tex);
        colormap = tex;
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

/** Quality tiers can soften filtering. They must not drop the albedo. */
export function setSharedAnisotropy(level: number) {
  sharedAnisotropy = level;
  for (const tex of sharedAlbedo) {
    if (tex.anisotropy === level) continue;
    tex.anisotropy = level;
    tex.needsUpdate = true;
  }
}

function paintUvs(geo: THREE.BufferGeometry, mats: THREE.Material[], key: ModelKey) {
  const pos = geo.getAttribute("position");
  const index = geo.getIndex();
  const uv = new Float32Array(pos.count * 2);
  const ranges = geo.groups.length
    ? geo.groups.map((g) => ({
        start: g.start,
        count: g.count,
        mat: mats[g.materialIndex ?? 0] ?? mats[0],
      }))
    : [{ start: 0, count: index ? index.count : pos.count, mat: mats[0] }];
  for (const range of ranges) {
    if (!range.mat || range.count <= 0) continue;
    const swatch = swatchFor(range.mat.name, key);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const vertAt = (i: number) => (index ? index.getX(i) : i);
    for (let i = 0; i < range.count; i++) {
      const vi = vertAt(range.start + i);
      const x = pos.getX(vi);
      const y = pos.getY(vi);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const sx = Math.max(1e-5, maxX - minX);
    const sy = Math.max(1e-5, maxY - minY);
    for (let i = 0; i < range.count; i++) {
      const vi = vertAt(range.start + i);
      const nx = (pos.getX(vi) - minX) / sx;
      const ny = (pos.getY(vi) - minY) / sy;
      uv[vi * 2] = swatch.u0 + nx * (swatch.u1 - swatch.u0);
      uv[vi * 2 + 1] = swatch.v1 - ny * (swatch.v1 - swatch.v0);
    }
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/** Nature GLBs have no albedo. Bind the shared colormap and keep it on the template. */
function skinWithColormap(mesh: THREE.Mesh, key: ModelKey, atlas: THREE.Texture) {
  const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(Boolean) as THREE.Material[];
  if (!mats.length) return;
  const foreign = mats.some((mat) => {
    const map = "map" in mat ? (mat as THREE.MeshStandardMaterial).map : null;
    return !!map && map !== atlas;
  });
  if (foreign) return;
  let geo = mesh.geometry as THREE.BufferGeometry;
  if (!geo.getAttribute("position")) return;
  // Nature exports store garbage UVs (tens of units). Castle UVs already
  // index the atlas, so a missing castle map only needs the shared texture.
  if (!uvsFitAtlas(geo)) {
    if (geo.userData.atlasPainted) {
      geo = geo.clone();
      geo.userData = { ...geo.userData, atlasPainted: false };
      mesh.geometry = geo;
    }
    paintUvs(geo, mats, key);
    geo.userData.atlasPainted = true;
  }
  for (const mat of mats) {
    if (!("map" in mat) || !("color" in mat)) continue;
    const std = mat as THREE.MeshStandardMaterial;
    std.map = atlas;
    std.color.setHex(0xffffff);
    if ("metalness" in std) {
      std.metalness = 0;
      std.roughness = 0.86;
      std.envMapIntensity = 0.4;
    }
    std.side = THREE.DoubleSide;
    std.needsUpdate = true;
  }
}

function prep(root: THREE.Object3D, key: ModelKey, cast = true) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = cast;
    m.receiveShadow = true;
    if (!m.material) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      // Castle kit is authored double-sided. Forcing FrontSide turns the far
      // side into a hollow shell as soon as the camera orbits. The horse and the
      // solid knight are flat-colored; keep both sides so thin parts don't vanish.
      if (key === "horse" || key === "knight") mat.side = THREE.DoubleSide;
      else if (mat.side !== THREE.DoubleSide) mat.side = THREE.FrontSide;
      if ("metalness" in mat) {
        const std = mat as THREE.MeshStandardMaterial;
        const name = std.name.toLowerCase();
        std.envMapIntensity = 0.75;
        std.roughness = name.includes("metal") ? 0.36 : name.includes("wood") ? 0.78 : 0.68;
        std.metalness = name.includes("metal") ? 0.55 : Math.min(std.metalness, 0.08);

        // Never leave a failed/missing texture as a featureless white canvas.
        // Castle assets normally use their restored colormap; this is a robust fallback.
        if (!std.map && std.color.getHex() > 0xeeeeee && key !== "horse" && key !== "knight") {
          const castle = key.startsWith("k") && ["kTower", "kKeep", "kBallista", "kCatapult", "kRam", "kWall", "kGate", "kFlag"].includes(key);
          std.color.setHex(castle ? 0x8b8174 : 0x8a765f);
          std.roughness = 0.82;
        }
        if (std.map && std.map !== colormap) {
          std.map.colorSpace = THREE.SRGBColorSpace;
          if (!std.map.userData.sharedAlbedo) std.map.anisotropy = sharedAnisotropy;
        }
      }
    }
    // Horse and knight bring their own colors. The atlas pass is for Kenney
    // nature and castle meshes that ship without an albedo.
    if (colormap && key !== "horse" && key !== "knight") skinWithColormap(m, key, colormap);
  });
  return root;
}

/** Fit model so height ≈ targetH and feet sit on y=0. */
export function fitModel(root: THREE.Object3D, targetH: number) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const s = targetH / Math.max(0.001, size.y);
  root.scale.multiplyScalar(s);
  box.setFromObject(root);
  root.position.y -= box.min.y;
  // Center XZ on origin
  const c = box.getCenter(new THREE.Vector3());
  root.position.x -= c.x;
  root.position.z -= c.z;
  return root;
}

export function cloneModel(key: ModelKey, targetH?: number): THREE.Object3D | null {
  const template = cache.get(key);
  if (!template) return null;
  const g = template.root.clone(true);
  if (targetH != null) fitModel(g, targetH);
  return g;
}

export function cloneAnimatedModel(
  key: ModelKey,
  targetH?: number,
): { object: THREE.Object3D; clips: THREE.AnimationClip[] } | null {
  const template = cache.get(key);
  if (!template) return null;
  // Skinned meshes (the horse) keep the source skeleton if cloned with
  // Object3D.clone, so the mount renders as a speck. SkeletonUtils retargets.
  const object = key === "horse" ? cloneSkinned(template.root) : template.root.clone(true);
  // The skinned clone's matrices are stale until a full update, and a fit
  // against that box shrinks the horse to a speck.
  if (key === "horse") object.updateMatrixWorld(true);
  if (targetH != null) fitModel(object, targetH);
  return { object, clips: template.clips };
}

export function modelsReady() {
  return cache.size >= 4;
}

/**
 * player-hero.glb requires KTX2. Drop the textures and keep the blocky body
 * so the ward and the rider can be team-painted without a basis transcoder.
 */
function glbWithoutTextures(buffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(buffer);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen))) as {
    extensionsUsed?: unknown;
    extensionsRequired?: unknown;
    images?: unknown;
    textures?: unknown;
    samplers?: unknown;
    materials?: Array<{
      extensions?: unknown;
      alphaMode?: string;
      alphaCutoff?: number;
      normalTexture?: unknown;
      occlusionTexture?: unknown;
      emissiveTexture?: unknown;
      pbrMetallicRoughness?: {
        baseColorTexture?: unknown;
        metallicRoughnessTexture?: unknown;
        baseColorFactor?: number[];
        metallicFactor?: number;
        roughnessFactor?: number;
      };
    }>;
  };
  delete json.extensionsUsed;
  delete json.extensionsRequired;
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const mat of json.materials ?? []) {
    delete mat.extensions;
    delete mat.normalTexture;
    delete mat.occlusionTexture;
    delete mat.emissiveTexture;
    const pbr = (mat.pbrMetallicRoughness ??= {});
    delete pbr.baseColorTexture;
    delete pbr.metallicRoughnessTexture;
    pbr.baseColorFactor = [0.72, 0.75, 0.8, 1];
    pbr.metallicFactor = 0.35;
    pbr.roughnessFactor = 0.45;
    mat.alphaMode = "OPAQUE";
    delete mat.alphaCutoff;
  }
  let text = JSON.stringify(json);
  while (text.length % 4 !== 0) text += " ";
  const jsonChunk = new TextEncoder().encode(text);
  const binHeader = 20 + jsonLen;
  const binLen = view.getUint32(binHeader, true);
  const bin = new Uint8Array(buffer, binHeader + 8, binLen);
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
  const out = new ArrayBuffer(total);
  const bytes = new Uint8Array(out);
  const header = new DataView(out);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, total, true);
  header.setUint32(12, jsonChunk.length, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonChunk, 20);
  const binStart = 20 + jsonChunk.length;
  header.setUint32(binStart, bin.length, true);
  header.setUint32(binStart + 4, 0x004e4942, true);
  bytes.set(bin, binStart + 8);
  return out;
}

function loadKnight(loader: GLTFLoader): Promise<void> {
  return fetch(URLS.knight)
    .then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.arrayBuffer();
    })
    .then(
      (raw) =>
        new Promise<void>((resolve, reject) => {
          loader.parse(
            glbWithoutTextures(raw),
            "",
            (gltf) => {
              cache.set("knight", { root: prep(gltf.scene, "knight"), clips: gltf.animations });
              resolve();
            },
            reject,
          );
        }),
    );
}

export function ensureModelsLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    colormap = await loadColormap();
    const loader = new GLTFLoader();
    const keys = Object.keys(URLS) as ModelKey[];
    await Promise.all(
      keys.map((key) => {
        if (key === "knight") return loadKnight(loader).catch(() => undefined);
        return new Promise<void>((resolve) => {
          loader.load(
            URLS[key],
            (gltf) => {
              const root = prep(gltf.scene, key);
              cache.set(key, { root, clips: gltf.animations });
              resolve();
            },
            undefined,
            () => resolve(), // soft-fail — procedural fallbacks still work
          );
        });
      }),
    );
  })();
  return loadPromise;
}
