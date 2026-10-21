import { COPPER_REGEN, PINE_REGEN, ROAD_X, WORLD_H } from "./balance";
import type { MapDef, MapId, Pad, ResourceNode, ResourceKind, Team } from "./types";

/** Deterministic RNG (mulberry32). */
export function rngFromSeed(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(...parts: number[]) {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Curved road centerline shared by simulation and renderer. */
export function roadCenterX(seed: number, lane: 0 | 1, y: number) {
  const t = Math.max(0, Math.min(1, (y - 72) / (WORLD_H - 144)));
  // Pin both ends to their gates, with two deterministic broad bends in between.
  const envelope = Math.sin(Math.PI * t);
  const a = ((hashSeed(seed, lane, 17) % 2001) / 1000 - 1) * 25;
  const b = ((hashSeed(seed, lane, 31) % 2001) / 1000 - 1) * 11;
  const phase = ((hashSeed(seed, lane, 47) % 1000) / 1000) * Math.PI * 2;
  return (
    ROAD_X[lane] +
    envelope * (a * Math.sin(Math.PI * t + phase) + b * Math.sin(Math.PI * 3 * t - phase * 0.4))
  );
}

/** Offset teams to opposite shoulders of the same meandering road. */
export function lanePathX(seed: number, team: Team, lane: 0 | 1, y: number) {
  return roadCenterX(seed, lane, y) + (team === "you" ? -13 : 13);
}

/** Some generated worlds have a cross-map river; location/shape is deterministic. */
export function riverSpec(seed: number) {
  const variant = hashSeed(seed, 0x51a7);
  return {
    enabled: variant % 4 !== 0,
    y: 265 + (variant % 190),
    amplitude: 12 + ((variant >>> 8) % 20),
    phase: (((variant >>> 16) % 1000) / 1000) * Math.PI * 2,
    width: 18 + ((variant >>> 24) % 9),
  };
}

/** One unique seed per keep level (+ optional scout reroll salt). Infinite campaign maps. */
export function seedForCampaign(level: number, scoutSalt = 0) {
  return hashSeed(level * 7919, scoutSalt * 104729, 0x524b5050);
}

const ADJECTIVES = [
  "Dusk", "Copper", "Ashen", "Crimson", "Hollow", "Iron", "Mist", "Thorn",
  "Gilded", "Broken", "Silent", "Storm", "Ember", "Pale", "Night", "Rune",
  "Frost", "Sunken", "Wild", "Cinder", "Verdant", "Obsidian", "Amber", "Grim",
];

const NOUNS = [
  "Valley", "Pass", "Forks", "March", "Hollow", "Crossing", "Ridge", "Gate",
  "Glade", "Spur", "Wold", "Dell", "Reach", "Cairn", "Ford", "Barrens",
  "Notch", "Saddle", "Bend", "Scar", "Chase", "Watch", "Fen", "Spire",
];

const TAGLINES = [
  "Twin roads, open pads — fair fight.",
  "Rich ore, fewer pads — economy first.",
  "Tight choke — counters decide.",
  "Wide flanks — cover both lanes.",
  "Sparse timber — copper carries you.",
  "Crowded pads — fortress builders rejoice.",
  "Far groves — early scouting pays.",
  "Ore by the gate — risk the yard.",
  "Split veins — two economies.",
  "Narrow shoulders — ballista country.",
];

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function tooClose(
  x: number,
  y: number,
  spots: { x: number; y: number }[],
  minDist: number,
) {
  return spots.some((s) => Math.hypot(s.x - x, s.y - y) < minDist);
}

export function generateMap(seed: number): MapDef {
  const rng = rngFromSeed(seed);
  const adj = pick(rng, ADJECTIVES);
  const noun = pick(rng, NOUNS);
  const name = `${adj} ${noun}`;
  const tagline = pick(rng, TAGLINES);

  // Bias: 0 open, 1 choke, 2 economy
  const bias = Math.floor(rng() * 3);
  const padCount = bias === 2 ? 5 + Math.floor(rng() * 2) : 6 + Math.floor(rng() * 3); // 5–8
  const pineCount = bias === 2 ? 2 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2);
  const copperCount = bias === 2 ? 2 + Math.floor(rng() * 2) : 1 + Math.floor(rng() * 2);

  const pads: MapDef["pads"] = [];
  const placed: { x: number; y: number }[] = [];

  // Always: keep-guard pad (starter)
  const keepY = 548 + Math.floor(rng() * 20); // 548–567
  pads.push({ id: "keep-guard", x: 200, y: keepY, laneCoverage: 2 });
  placed.push({ x: 200, y: keepY });

  // Forward / choke center
  const forwardY = bias === 1 ? 460 + Math.floor(rng() * 25) : 455 + Math.floor(rng() * 40);
  if (!tooClose(200, forwardY, placed, 36)) {
    pads.push({ id: "forward", x: 200, y: forwardY, laneCoverage: 2 });
    placed.push({ x: 200, y: forwardY });
  }

  // Lane pads — west / east
  const tryPad = (id: string, x: number, y: number, lane: 0 | 1 | 2) => {
    const px = clamp(x, 36, 364);
    const py = clamp(y, 450, 580);
    if (tooClose(px, py, placed, 34)) return false;
    pads.push({ id, x: px, y: py, laneCoverage: lane });
    placed.push({ x: px, y: py });
    return true;
  };

  let guard = 0;
  let n = 0;
  while (pads.length < padCount && guard++ < 80) {
    n += 1;
    const laneRoll = rng();
    if (laneRoll < 0.38) {
      // west road
      const x = 40 + Math.floor(rng() * 90);
      const y = 470 + Math.floor(rng() * 100);
      tryPad(`w-${n}`, x, y, 0);
    } else if (laneRoll < 0.76) {
      // east road
      const x = 270 + Math.floor(rng() * 90);
      const y = 470 + Math.floor(rng() * 100);
      tryPad(`e-${n}`, x, y, 1);
    } else {
      // center
      const x = 160 + Math.floor(rng() * 80);
      const y = 480 + Math.floor(rng() * 80);
      tryPad(`c-${n}`, x, y, 2);
    }
  }

  // Ensure at least one pad per road
  if (!pads.some((p) => p.laneCoverage === 0)) tryPad("w-force", 70, 520, 0);
  if (!pads.some((p) => p.laneCoverage === 1)) tryPad("e-force", 330, 520, 1);

  const nodes: MapDef["nodes"] = [];
  const nodeSpots: { x: number; y: number }[] = [];

  const placeNode = (id: string, kind: ResourceKind, preferEdge: "w" | "e" | "any") => {
    for (let attempt = 0; attempt < 40; attempt++) {
      let x: number;
      if (preferEdge === "w") x = 28 + Math.floor(rng() * 70);
      else if (preferEdge === "e") x = 300 + Math.floor(rng() * 70);
      else x = 30 + Math.floor(rng() * 340);
      const yourY = 400 + Math.floor(rng() * 220); // 400–620
      if (yourY > 640) continue;
      // Keep resources off this map's actual curved road centers.
      if (
        Math.abs(x - roadCenterX(seed, 0, yourY)) < 32 ||
        Math.abs(x - roadCenterX(seed, 1, yourY)) < 32
      ) continue;
      // Keep clickable resource nodes clear of build pads.
      if (tooClose(x, yourY, placed, 42)) continue;
      if (tooClose(x, yourY, nodeSpots, 42)) continue;
      const loads = kind === "pine" ? 8 + Math.floor(rng() * 6) : 6 + Math.floor(rng() * 5);
      // Pine → wood, copper mine → gold (AoE2-ish)
      const gold = kind === "pine" ? 0 : 16 + Math.floor(rng() * 6);
      const wood = kind === "pine" ? 9 + Math.floor(rng() * 4) : 0;
      const gather = kind === "pine" ? 1.05 + rng() * 0.25 : 1.9 + rng() * 0.35;
      const regen = kind === "pine" ? PINE_REGEN * (0.85 + rng() * 0.35) : COPPER_REGEN * (0.85 + rng() * 0.35);
      nodes.push({ id, kind, x, yourY, loads, gold, wood, gather, regen });
      nodeSpots.push({ x, y: yourY });
      return;
    }
  };

  for (let i = 0; i < pineCount; i++) {
    placeNode(`pine-${i}`, "pine", i % 2 === 0 ? "w" : "e");
  }
  for (let i = 0; i < copperCount; i++) {
    placeNode(`ore-${i}`, "copper", i === 0 && bias === 2 ? "any" : i % 2 === 0 ? "e" : "w");
  }
  // Safety: always at least 2 pines + 1 copper
  if (nodes.filter((n) => n.kind === "pine").length < 2) placeNode("pine-safe", "pine", "w");
  if (nodes.filter((n) => n.kind === "pine").length < 2) placeNode("pine-safe2", "pine", "e");
  if (!nodes.some((n) => n.kind === "copper")) placeNode("ore-safe", "copper", "e");

  return {
    id: `seed-${seed}` as MapId,
    seed,
    name,
    tagline,
    pads,
    nodes,
    startTowerPad: "keep-guard",
  };
}

/** Cache last generated map for getMap lookups during a session. */
const mapCache = new Map<string, MapDef>();

export function getMap(id: MapId): MapDef {
  const cached = mapCache.get(id);
  if (cached) return cached;
  // Parse seed from id `seed-12345` or treat as numeric
  const m = /^seed-(\d+)$/.exec(id);
  const seed = m ? Number(m[1]) : hashSeed(id.length, 42);
  const map = generateMap(seed);
  mapCache.set(map.id, map);
  return map;
}

export function getOrCreateCampaignMap(level: number, scoutSalt: number): MapDef {
  const seed = seedForCampaign(level, scoutSalt);
  const id = `seed-${seed}` as MapId;
  if (mapCache.has(id)) return mapCache.get(id)!;
  const map = generateMap(seed);
  mapCache.set(map.id, map);
  return map;
}

/**
 * Skirmish rematches. Same generator and mirrored starts as a campaign map.
 * Names are fixed; the seed only changes the road bends and the river.
 */
const SKIRMISH_LAYOUTS: { name: string; tagline: string; seed: number }[] = [
  { name: "Night Crossing", tagline: "Gentle roads. The river crosses the north.", seed: 1 },
  { name: "Ashen Ford", tagline: "The west road bows out. A quiet river crosses the middle.", seed: 7 },
  { name: "Copper Bend", tagline: "The east road swings wide. The river runs to the south.", seed: 21 },
  { name: "Hollow March", tagline: "Both roads lean west. The river crooks through the north half.", seed: 215 },
];

const skirmishCache = new Map<string, MapDef>();

export function skirmishMaps(): MapDef[] {
  if (skirmishCache.size === SKIRMISH_LAYOUTS.length) {
    return SKIRMISH_LAYOUTS.map((entry) => skirmishCache.get(`seed-${entry.seed}`)!);
  }
  return SKIRMISH_LAYOUTS.map((entry) => {
    const map = generateMap(entry.seed);
    const named: MapDef = { ...map, name: entry.name, tagline: entry.tagline };
    skirmishCache.set(named.id, named);
    return named;
  });
}

export function skirmishMap(id: string): MapDef | null {
  return skirmishMaps().find((map) => map.id === id) ?? null;
}

/** @deprecated kept for any leftover UI — now returns a few sample previews */
export function previewMapsForLevel(level: number, scoutSalt: number): MapDef[] {
  return [getOrCreateCampaignMap(level, scoutSalt)];
}

export function buildPads(map: MapDef): Pad[] {
  const pads: Pad[] = [];
  for (const p of map.pads) {
    const zone = p.zone ?? "combat";
    pads.push({
      id: `you-${p.id}`,
      team: "you",
      pos: { x: p.x, y: p.y },
      laneCoverage: p.laneCoverage,
      zone,
    });
    pads.push({
      id: `foe-${p.id}`,
      team: "foe",
      pos: { x: p.x, y: WORLD_H - p.y },
      laneCoverage: p.laneCoverage,
      zone,
    });
  }

  // Eco slots behind each keep (houses only) — south of your keep / north of foe
  const ecoSpots = [
    { id: "eco-0", x: 200, y: 692 },
    { id: "eco-1", x: 148, y: 698 },
    { id: "eco-2", x: 252, y: 698 },
  ];
  for (const e of ecoSpots) {
    pads.push({
      id: `you-${e.id}`,
      team: "you",
      pos: { x: e.x, y: e.y },
      laneCoverage: 2,
      zone: "eco",
    });
    pads.push({
      id: `foe-${e.id}`,
      team: "foe",
      pos: { x: e.x, y: WORLD_H - e.y },
      laneCoverage: 2,
      zone: "eco",
    });
  }
  return pads;
}

export function buildNodes(map: MapDef): ResourceNode[] {
  const out: ResourceNode[] = [];
  for (const n of map.nodes) {
    const base = {
      kind: n.kind,
      loadsLeft: n.loads,
      maxLoads: n.loads,
      maxWorkers: 2,
      workers: 0,
      gatherTime: n.gather,
      goldPerLoad: n.gold,
      woodPerLoad: n.wood,
      regenEvery: n.regen,
      regenAcc: 0,
    };
    out.push({
      ...base,
      id: `you-${n.id}`,
      team: "you",
      pos: { x: n.x, y: n.yourY },
    });
    out.push({
      ...base,
      id: `foe-${n.id}`,
      team: "foe",
      pos: { x: n.x, y: WORLD_H - n.yourY },
    });
  }
  return out;
}

export function keepPos(team: Team) {
  return team === "you" ? { x: 200, y: 664 } : { x: 200, y: 56 };
}

export function villagerStart(team: Team, idx: number) {
  if (team === "you") return { x: 170 + idx * 60, y: 630 };
  return { x: 170 + idx * 60, y: 90 };
}

export function laneYGate(team: Team) {
  return team === "you" ? 96 : 624;
}

export function laneStartY(team: Team) {
  return team === "you" ? 628 : 92;
}

export function laneXFor(team: Team, lane: 0 | 1) {
  return ROAD_X[lane] + (team === "you" ? -13 : 13);
}

export function startPadId(map: MapDef, team: Team) {
  return `${team}-${map.startTowerPad}`;
}

export function startPadPos(map: MapDef, team: Team) {
  const p = map.pads.find((x) => x.id === map.startTowerPad) ?? map.pads[0];
  return { x: p.x, y: team === "you" ? p.y : WORLD_H - p.y };
}
