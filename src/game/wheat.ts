import { WORLD_H, WORLD_W } from "./balance";
import { mapBounds, riverSpec, rngFromSeed, roadGap } from "./map";
import type { Team, Vec2 } from "./types";

export type WheatPatch = { x: number; y: number; w: number; d: number; rot: number };

const cache = new Map<number, WheatPatch[]>();

/** Same seeded ellipses the terrain paints — harvest uses this list, not fake farm pins. */
export function wheatPatches(seed: number): WheatPatch[] {
  let list = cache.get(seed);
  if (!list) {
    list = computeWheatPatches(seed);
    cache.set(seed, list);
  }
  return list;
}

function computeWheatPatches(seed: number): WheatPatch[] {
  const rng = rngFromSeed(seed ^ 0x3c3c);
  const river = riverSpec(seed);
  const { minX, width } = mapBounds(seed);
  const want = Math.round((14 * width) / WORLD_W);
  const out: WheatPatch[] = [];
  for (let tries = 0, placed = 0; tries < want * 4 && placed < want; tries++) {
    const x = minX + 30 + rng() * (width - 60);
    const y = 70 + rng() * (WORLD_H - 120);
    const w = 30 + rng() * 30;
    const d = 22 + rng() * 22;
    const r = Math.hypot(w, d) / 2;
    const riverY = river.y + Math.sin((x / WORLD_W) * Math.PI * 2 + river.phase) * river.amplitude;
    if (roadGap(seed, x, y) < r + 18) continue;
    if (river.enabled && Math.abs(y - riverY) < r + river.width) continue;
    out.push({ x, y, w, d, rot: rng() * Math.PI });
    placed++;
  }
  return out;
}

export function pointInWheatPatch(pos: Vec2, patch: WheatPatch, pad = 4) {
  const dx = pos.x - patch.x;
  const dz = pos.y - patch.y;
  const c = Math.cos(patch.rot);
  const s = Math.sin(patch.rot);
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  return Math.abs(lx) <= patch.w / 2 + pad && Math.abs(lz) <= patch.d / 2 + pad;
}

export function wheatPatchAt(seed: number, pos: Vec2, pad = 4): WheatPatch | null {
  for (const p of wheatPatches(seed)) {
    if (pointInWheatPatch(pos, p, pad)) return p;
  }
  return null;
}

/** Grain on this clan's side of the spine; all patches if that bank is empty. */
export function farmPlots(seed: number, team?: Team): WheatPatch[] {
  const all = wheatPatches(seed);
  if (!team) return all;
  const mid = WORLD_H / 2;
  const own = all.filter((p) => (team === "you" ? p.y > mid : p.y < mid));
  return own.length > 0 ? own : all;
}
