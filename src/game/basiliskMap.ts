import { KEEP_MARGIN, WORLD_H, WORLD_W } from "./balance";
import { MAP_CX, mapBounds, mapLanes, riverSpec, roadCenterX, roadGap } from "./map";
import type { LaneCount, MapDef, MapId, Team, Vec2 } from "./types";

export const BASILISK_SEED = 884410;
export const SPINE_Y = WORLD_H / 2;
export const FORD_X = [118, 200, 282] as const;

export type WorkKind = "farm" | "hunt" | "gold" | "wood";

let valleySeed = BASILISK_SEED;

export function currentValleySeed() {
  return valleySeed;
}

export function setValleySeed(seed: number) {
  valleySeed = seed >>> 0 || BASILISK_SEED;
}

export function isBasiliskSeed(seed: number) {
  return seed === BASILISK_SEED;
}

export function basiliskMap(): MapDef {
  const yourKeep = WORLD_H - KEEP_MARGIN;
  const pads: MapDef["pads"] = [
    { id: "keep-guard", x: WORLD_W / 2, y: yourKeep - 24, laneCoverage: [0, 1], zone: "combat" },
    { id: "mid-w", x: 118, y: yourKeep - 144, laneCoverage: [0], zone: "combat" },
    { id: "mid-e", x: 282, y: yourKeep - 144, laneCoverage: [1], zone: "combat" },
  ];
  const nodes: MapDef["nodes"] = [
    { id: "pine-sw", kind: "pine", x: 78, yourY: yourKeep - 144, loads: 14, gold: 0, wood: 10, gather: 1.1, regen: 2.4 },
    { id: "pine-se", kind: "pine", x: 322, yourY: yourKeep - 124, loads: 14, gold: 0, wood: 10, gather: 1.1, regen: 2.4 },
    { id: "pine-nw", kind: "pine", x: 78, yourY: 180, loads: 14, gold: 0, wood: 10, gather: 1.1, regen: 2.4 },
    { id: "pine-ne", kind: "pine", x: 322, yourY: 160, loads: 14, gold: 0, wood: 10, gather: 1.1, regen: 2.4 },
    { id: "ore-s", kind: "copper", x: 268, yourY: yourKeep - 64, loads: 12, gold: 18, wood: 0, gather: 1.8, regen: 3.6 },
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

export function chokePoints(seed = currentValleySeed()): Vec2[] {
  if (isBasiliskSeed(seed)) return FORD_X.map((x) => ({ x, y: SPINE_Y }));
  const river = riverSpec(seed);
  const y = river.enabled ? river.y : SPINE_Y;
  return mapLanes(seed).map((lane) => ({ x: roadCenterX(seed, lane, y), y }));
}

export function deerSpots(team: Team, seed = currentValleySeed()): Vec2[] {
  const { minX, maxX } = mapBounds(seed);
  const y = team === "you" ? WORLD_H - 6 : 6;
  const raw = [minX + 28, maxX - 28];
  return raw.map((startX) => {
    let x = startX;
    const dir = startX < MAP_CX ? 1 : -1;
    for (let i = 0; i < 10 && roadGap(seed, x, y) < 24; i++) x += dir * 12;
    return { x, y };
  });
}

export function workSites(team: Team, kind: WorkKind): Vec2[] {
  const south = team === "you";
  if (kind === "farm") {
    return south
      ? [
          { x: 132, y: WORLD_H - 172 },
          { x: 168, y: WORLD_H - 148 },
          { x: 108, y: WORLD_H - 130 },
        ]
      : [
          { x: 268, y: 172 },
          { x: 232, y: 148 },
          { x: 292, y: 130 },
        ];
  }
  if (kind === "hunt") return deerSpots(team, currentValleySeed());
  if (kind === "gold") return [south ? { x: 268, y: WORLD_H - 120 } : { x: 132, y: 118 }];
  return south
    ? [
        { x: 78, y: WORLD_H - 200 },
        { x: 322, y: WORLD_H - 180 },
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
