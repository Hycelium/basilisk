import * as THREE from "three";

/** Ground styles rotated per map seed. Textures: Poly Haven (CC0). */
export interface GroundLook {
  name: string;
  ground: string | null;
  tint: boolean;
  road: string;
  wheat: boolean;
}

export const GROUND_LOOKS: GroundLook[] = [
  { name: "Golden fields", ground: null, tint: true, road: "dirt", wheat: true },
  { name: "Withered grass", ground: "withered_grass", tint: true, road: "stony_dirt_path", wheat: true },
  { name: "Leafy meadow", ground: "leafy_grass", tint: false, road: "gravel_road", wheat: false },
];

/** `?look=0|1|2` pins a style for previewing; otherwise it follows the map seed. */
export function groundLookForSeed(seed: number) {
  const pinned = Number(new URLSearchParams(location.search).get("look"));
  if (Number.isInteger(pinned) && GROUND_LOOKS[pinned] && location.search.includes("look=")) return GROUND_LOOKS[pinned];
  return GROUND_LOOKS[(seed >>> 0) % GROUND_LOOKS.length];
}

const loader = new THREE.ImageLoader();
const cache = new Map<string, THREE.Texture>();

/** Shared repeating texture (tiling comes from geometry UVs). Image-backed textures upload black in
 * some embedded Chromium builds, so the JPEG is copied into a canvas first. */
export function groundTexture(name: string) {
  let t = cache.get(name);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  const tex = t;
  loader.load(`${import.meta.env.BASE_URL}models/textures/${name}.jpg`, (img) => {
    c.getContext("2d")!.drawImage(img, 0, 0, 1024, 1024);
    tex.needsUpdate = true;
  });
  cache.set(name, t);
  return t;
}

let wheat: THREE.CanvasTexture | null = null;
export function wheatTexture() {
  if (wheat) return wheat;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d9b553";
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#b58f36";
  for (let y = 0; y < 256; y += 8) g.fillRect(0, y, 256, 3);
  let s = 1234567;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = r() < 0.5 ? "#ecd27f" : "#a98432";
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  wheat = new THREE.CanvasTexture(c);
  wheat.colorSpace = THREE.SRGBColorSpace;
  wheat.wrapS = wheat.wrapT = THREE.RepeatWrapping;
  return wheat;
}
