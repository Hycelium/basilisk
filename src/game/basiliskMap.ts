import { WORLD_H, WORLD_W } from "./balance";
import type { LaneCount, MapDef, MapId, Team, Vec2 } from "./types";

function keepOf(team: Team) {
  return team === "you" ? { x: 200, y: 664 } : { x: 200, y: 56 };
}

export const BASILISK_SEED = 884410;
export const SPINE_Y = WORLD_H / 2;
export const FORD_X = [118, 200, 282] as const;

export type WorkKind = "farm" | "hunt" | "gold" | "wood";

export function isBasiliskSeed(seed: number) {
  return seed === BASILISK_SEED;
}

export function basiliskMap(): MapDef {
  const pads: MapDef["pads"] = [
    { id: "keep-guard", x: WORLD_W / 2, y: 640, laneCoverage: [0, 1], zone: "combat" },
    { id: "mid-w", x: 118, y: 520, laneCoverage: [0], zone: "combat" },
    { id: "mid-e", x: 282, y: 520, laneCoverage: [1], zone: "combat" },
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
    tagline: "Blue south, red north. Haul home. The king spends the coffer.",
    lanes: 2 as LaneCount,
    pads,
    nodes,
    startTowerPad: "keep-guard",
  };
}

export function chokePoints(): Vec2[] {
  return FORD_X.map((x) => ({ x, y: SPINE_Y }));
}

export function deerSpots(team: Team): Vec2[] {
  const keep = keepOf(team);
  const behind = team === "you" ? 52 : -52;
  return [-36, 0, 36].map((dx) => ({ x: keep.x + dx, y: keep.y + behind }));
}

export function workSites(team: Team, kind: WorkKind): Vec2[] {
  const south = team === "you";
  if (kind === "farm") {
    return south
      ? [
          { x: 132, y: 548 },
          { x: 168, y: 572 },
          { x: 108, y: 590 },
        ]
      : [
          { x: 268, y: 172 },
          { x: 232, y: 148 },
          { x: 292, y: 130 },
        ];
  }
  if (kind === "hunt") return deerSpots(team);
  if (kind === "gold") return [south ? { x: 268, y: 600 } : { x: 132, y: 118 }];
  return south
    ? [
        { x: 78, y: 520 },
        { x: 322, y: 540 },
      ]
    : [
        { x: 78, y: 180 },
        { x: 322, y: 160 },
      ];
}

export function allWorkSites(team: Team): { kind: WorkKind; pos: Vec2 }[] {
  const kinds: WorkKind[] = ["farm", "hunt", "gold", "wood"];
  const out: { kind: WorkKind; pos: Vec2 }[] = [];
  for (const kind of kinds) {
    for (const pos of workSites(team, kind)) out.push({ kind, pos });
  }
  return out;
}

export const WORK_LABEL: Record<WorkKind, string> = {
  farm: "Farm",
  hunt: "Hunt",
  gold: "Gold",
  wood: "Wood",
};
