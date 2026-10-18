import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

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
  | "kCharC";

const URLS: Record<ModelKey, string> = {
  oak: "/models/oak-tree.glb",
  blue: "/models/blue-player.glb",
  red: "/models/red-player.glb",
  white: "/models/white-player.glb",
  sword: "/models/sword.glb",
  mindflayer: "/models/mindflayer.glb",
  hero: "/models/player-hero.glb",
  kOak: "/models/kenney/nature-tree_oak.glb",
  kPine: "/models/kenney/nature-tree_pineDefaultA.glb",
  kPine2: "/models/kenney/nature-tree_pineRoundC.glb",
  kCone: "/models/kenney/nature-tree_cone_dark.glb",
  kLogs: "/models/kenney/nature-log_stack.glb",
  kLog: "/models/kenney/nature-log.glb",
  kRock: "/models/kenney/nature-rock_largeA.glb",
  kRock2: "/models/kenney/nature-rock_largeC.glb",
  kStone: "/models/kenney/nature-stone_largeA.glb",
  kBush: "/models/kenney/nature-plant_bushLarge.glb",
  kTower: "/models/kenney/castle-tower-square.glb",
  kKeep: "/models/kenney/castle-tower-base.glb",
  kBallista: "/models/kenney/castle-siege-ballista.glb",
  kCatapult: "/models/kenney/castle-siege-catapult.glb",
  kRam: "/models/kenney/castle-siege-ram.glb",
  kWall: "/models/kenney/castle-wall.glb",
  kGate: "/models/kenney/castle-gate.glb",
  kFlag: "/models/kenney/castle-flag.glb",
  kCharA: "/models/kenney/chars/character-a.glb",
  kCharB: "/models/kenney/chars/character-b.glb",
  kCharC: "/models/kenney/chars/character-c.glb",
};

interface ModelTemplate {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

const cache = new Map<ModelKey, ModelTemplate>();
let loadPromise: Promise<void> | null = null;

function prep(root: THREE.Object3D, key: ModelKey, cast = true) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = cast;
      m.receiveShadow = true;
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          mat.side = THREE.FrontSide;
          if ("metalness" in mat) {
            const std = mat as THREE.MeshStandardMaterial;
            const name = std.name.toLowerCase();
            std.envMapIntensity = 0.75;
            std.roughness = name.includes("metal") ? 0.36 : name.includes("wood") ? 0.78 : 0.68;
            std.metalness = name.includes("metal") ? 0.55 : Math.min(std.metalness, 0.08);

            // Never leave a failed/missing texture as a featureless white canvas.
            // Castle assets normally use their restored colormap; this is a robust fallback.
            if (!std.map && std.color.getHex() > 0xeeeeee) {
              const castle = key.startsWith("k") && ["kTower", "kKeep", "kBallista", "kCatapult", "kRam", "kWall", "kGate", "kFlag"].includes(key);
              std.color.setHex(castle ? 0x8b8174 : 0x8a765f);
              std.roughness = 0.82;
            }
            if (std.map) {
              std.map.colorSpace = THREE.SRGBColorSpace;
              std.map.anisotropy = 4;
            }
          }
        }
      }
    }
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
  const object = template.root.clone(true);
  if (targetH != null) fitModel(object, targetH);
  return { object, clips: template.clips };
}

export function modelsReady() {
  return cache.size >= 4;
}

export function ensureModelsLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const loader = new GLTFLoader();
    const keys = Object.keys(URLS) as ModelKey[];
    await Promise.all(
      keys.map(
        (key) =>
          new Promise<void>((resolve) => {
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
          }),
      ),
    );
  })();
  return loadPromise;
}
