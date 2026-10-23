import { WORLD_H, WORLD_W } from "./balance";
import { keepPos, mapBounds, riverSpec, rngFromSeed, roadGap } from "./map";
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

function riverYAt(seed: number, x: number) {
  const river = riverSpec(seed);
  return river.y + Math.sin((x / WORLD_W) * Math.PI * 2 + river.phase) * river.amplitude;
}

function blocked(seed: number, x: number, y: number, r: number, taken: WheatPatch[]) {
  const river = riverSpec(seed);
  if (roadGap(seed, x, y) < r + 18) return true;
  if (river.enabled && Math.abs(y - riverYAt(seed, x)) < r + river.width) return true;
  for (const team of ["you", "foe"] as const) {
    const keep = keepPos(team);
    if (Math.hypot(x - keep.x, y - keep.y) < r + 36) return true;
  }
  return taken.some((p) => Math.hypot(p.x - x, p.y - y) < r + Math.hypot(p.w, p.d) / 2 + 10);
}

function tryPlace(
  seed: number,
  rng: () => number,
  cx: number,
  cy: number,
  cellW: number,
  cellH: number,
  taken: WheatPatch[],
): WheatPatch | null {
  for (let n = 0; n < 10; n++) {
    const x = cx + (rng() - 0.5) * cellW * 0.62;
    const y = cy + (rng() - 0.5) * cellH * 0.62;
    const w = 28 + rng() * 22;
    const d = 20 + rng() * 16;
    const r = Math.hypot(w, d) / 2;
    if (blocked(seed, x, y, r, taken)) continue;
    return { x, y, w, d, rot: (rng() - 0.5) * 0.7 };
  }
  return null;
}

/** One patch per grid cell, same count on the north and south banks. */
function computeWheatPatches(seed: number): WheatPatch[] {
  const rng = rngFromSeed(seed ^ 0x3c3c);
  const { minX, width } = mapBounds(seed);
  const cols = width > 430 ? 3 : 2;
  const rowsPerBank = 2;
  const mid = WORLD_H / 2;
  const banks = [
    { y0: 72, y1: mid - 28 },
    { y0: mid + 28, y1: WORLD_H - 72 },
  ];
  const out: WheatPatch[] = [];
  for (const bank of banks) {
    const cellW = width / cols;
    const cellH = (bank.y1 - bank.y0) / rowsPerBank;
    for (let row = 0; row < rowsPerBank; row++) {
      for (let col = 0; col < cols; col++) {
        const cx = minX + (col + 0.5) * cellW;
        const cy = bank.y0 + (row + 0.5) * cellH;
        const patch = tryPlace(seed, rng, cx, cy, cellW, cellH, out);
        if (patch) out.push(patch);
      }
    }
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
