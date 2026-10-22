import { WORLD_H, WORLD_W } from "./balance";
import type { Job, LaneCount, MapDef, MapId, Team, Vec2 } from "./types";

/** Two-road seed so the valleys stay readable. Do not change without checking laneCount(). */
export const BASILISK_SEED = 884410;

export const SPINE_Y = WORLD_H / 2;
export const FORD_X = [118, 200, 282] as const;
export const RIDGE_HALF = 68;

export function isBasiliskSeed(seed: number) {
  return seed === BASILISK_SEED;
}

export function basiliskMap(): MapDef {
  const pads: MapDef["pads"] = [
    { id: "keep-guard", x: WORLD_W / 2, y: 640, laneCoverage: [0, 1], zone: "combat" },
    { id: "foe-guard", x: WORLD_W / 2, y: 80, laneCoverage: [0, 1], zone: "combat" },
  ];
  const nodes: MapDef["nodes"] = [
    { id: "pine-sw", kind: "pine", x: 78, yourY: 520, loads: 14, gold: 0, wood: 10, gather: 1.1, regen: 2.4 },
    { id: "pine-se", kind: "pine", x: 322, yourY: 540, loads: 14, gold: 0, wood: 10, gather: 1.1, regen: 2.4 },
    { id: "pine-nw", kind: "pine", x: 78, yourY: 180, loads: 14, gold: 0, wood: 10, gather: 1.1, regen: 2.4 },
    { id: "pine-ne", kind: "pine", x: 322, yourY: 160, loads: 14, gold: 0, wood: 10, gather: 1.1, regen: 2.4 },
    { id: "ore-s", kind: "copper", x: 268, yourY: 600, loads: 12, gold: 18, wood: 0, gather: 1.8, regen: 3.6 },
    { id: "ore-n", kind: "copper", x: 132, yourY: 118, loads: 12, gold: 18, wood: 0, gather: 1.8, regen: 3.6 },
  ];
  return {
    id: `seed-${BASILISK_SEED}` as MapId,
    seed: BASILISK_SEED,
    name: "Twin Valleys",
    tagline: "Blue south, red north. Three fords through the ridge.",
    lanes: 2 as LaneCount,
    pads,
    nodes,
    startTowerPad: "keep-guard",
  };
}

export function chokePoints(): Vec2[] {
  return FORD_X.map((x) => ({ x, y: SPINE_Y }));
}

function oval(cx: number, cy: number, rx: number, ry: number, n = 6): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

/** Walking circuits. Resources tick only while a body is moving along these. */
export function jobWaypoints(team: Team, job: Job): Vec2[] {
  const south = team === "you";
  const cy = south ? 560 : 160;
  const huntY = south ? 430 : 290;
  if (job === "farmer") return oval(south ? 150 : 250, cy, 42, 28, 7);
  if (job === "lumber") {
    return south
      ? [
          { x: 78, y: 520 },
          { x: 96, y: 560 },
          { x: 322, y: 540 },
          { x: 300, y: 500 },
        ]
      : [
          { x: 78, y: 180 },
          { x: 96, y: 140 },
          { x: 322, y: 160 },
          { x: 300, y: 200 },
        ];
  }
  if (job === "smith") {
    const ore = south ? { x: 268, y: 600 } : { x: 132, y: 118 };
    const anvil = south ? { x: 210, y: 655 } : { x: 190, y: 70 };
    return [ore, anvil, { x: ore.x + 18, y: ore.y - 12 }, anvil];
  }
  return oval(south ? 240 : 160, huntY, 36, 22, 6);
}

export const JOB_LABEL: Record<Job, string> = {
  farmer: "Farmer",
  hunter: "Hunter",
  smith: "Blacksmith",
  lumber: "Lumberjack",
};

export const JOB_PROMOTE = {
  farmer: "runner",
  hunter: "archer",
  smith: "ward",
  lumber: "rammer",
} as const;
