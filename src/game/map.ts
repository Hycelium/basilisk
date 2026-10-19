import { COPPER_REGEN, PINE_REGEN, ROAD_X, WORLD_H, WORLD_W } from "./balance";
import type { MapDef, MapId, Pad, ResourceNode, ResourceKind, Team } from "./types";

/** Large skirmish battlefield. The duel map stays 400×720. */
export const TRI_W = 860;
export const TRI_H = 780;

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
    layout: "duel",
    worldW: WORLD_W,
    worldH: WORLD_H,
  };
}

function vlen(v: { x: number; y: number }) {
  return Math.hypot(v.x, v.y) || 1;
}

function vunit(v: { x: number; y: number }) {
  const l = vlen(v);
  return { x: v.x / l, y: v.y / l };
}

function vadd(a: { x: number; y: number }, b: { x: number; y: number }, scale = 1) {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale };
}

/** Same sine envelope as roadCenterX, laid along an arbitrary segment. */
export function meanderPath(
  seed: number,
  lane: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 28,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const px = -dy / len;
  const py = dx / len;
  const a = ((hashSeed(seed, lane, 17) % 2001) / 1000 - 1) * 25;
  const b = ((hashSeed(seed, lane, 31) % 2001) / 1000 - 1) * 11;
  const phase = ((hashSeed(seed, lane, 47) % 1000) / 1000) * Math.PI * 2;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const envelope = Math.sin(Math.PI * t);
    const off = envelope * (a * Math.sin(Math.PI * t + phase) + b * Math.sin(Math.PI * 3 * t - phase * 0.4));
    points.push({
      x: from.x + dx * t + px * off,
      y: from.y + dy * t + py * off,
    });
  }
  return points;
}

function distToPoly(x: number, y: number, pts: { x: number; y: number }[]) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / Math.max(1, abx * abx + aby * aby)));
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), y - (a.y + aby * t)));
  }
  return best;
}

/**
 * Three keeps: human south, North northwest, East northeast.
 * Each base reuses the duel pad/node scatter, swung to face the center.
 * Roads reuse the duel meander between every pair of gates.
 */
export function generateTriangleMap(seed: number): MapDef {
  const id = `tri-${seed}` as MapId;
  const cached = mapCache.get(id);
  if (cached) return cached;
  const map = buildTriangleMap(seed);
  mapCache.set(map.id, map);
  return map;
}

function buildTriangleMap(seed: number): MapDef {
  const rng = rngFromSeed(seed ^ 0x731a);
  const adj = pick(rng, ADJECTIVES);
  const noun = pick(rng, NOUNS);
  const keeps = [
    { team: "you" as const, x: 430, y: 640 },
    { team: "foe" as const, x: 160, y: 130 },
    { team: "east" as const, x: 700, y: 130 },
  ];
  const centroid = {
    x: keeps.reduce((s, k) => s + k.x, 0) / keeps.length,
    y: keeps.reduce((s, k) => s + k.y, 0) / keeps.length,
  };
  const facing = new Map<Team, { f: { x: number; y: number }; r: { x: number; y: number } }>();
  for (const k of keeps) {
    const f = vunit({ x: centroid.x - k.x, y: centroid.y - k.y });
    facing.set(k.team, { f, r: { x: -f.y, y: f.x } });
  }
  const gate = (team: Team) => {
    const k = keeps.find((c) => c.team === team)!;
    const face = facing.get(team)!;
    return vadd(k, face.f, 48);
  };
  const roads = [
    { a: "you" as const, b: "foe" as const, points: meanderPath(seed, 0, gate("you"), gate("foe")) },
    { a: "you" as const, b: "east" as const, points: meanderPath(seed, 1, gate("you"), gate("east")) },
    { a: "foe" as const, b: "east" as const, points: meanderPath(seed, 2, gate("foe"), gate("east")) },
  ];
  const nearRoad = (x: number, y: number, min: number) => roads.some((r) => distToPoly(x, y, r.points) < min);

  const pads: MapDef["pads"] = [];
  const nodes: MapDef["nodes"] = [];
  const placed: { x: number; y: number }[] = [];

  const toWorld = (team: Team, along: number, lateral: number) => {
    const k = keeps.find((c) => c.team === team)!;
    const face = facing.get(team)!;
    const p = vadd(vadd(k, face.f, along), face.r, lateral);
    return {
      x: clamp(p.x, 40, TRI_W - 40),
      y: clamp(p.y, 40, TRI_H - 40),
    };
  };

  for (const k of keeps) {
    const team = k.team;
    const eco = [
      { id: `${team}-eco-0`, along: -52, lateral: 0 },
      { id: `${team}-eco-1`, along: -46, lateral: -58 },
      { id: `${team}-eco-2`, along: -46, lateral: 58 },
    ];
    for (const e of eco) {
      const p = toWorld(team, e.along, e.lateral);
      pads.push({ id: e.id, x: p.x, y: p.y, laneCoverage: 2, zone: "eco", team });
      placed.push(p);
    }
    const guard = toWorld(team, 84, 0);
    pads.push({ id: `${team}-keep-guard`, x: guard.x, y: guard.y, laneCoverage: 2, zone: "combat", team });
    placed.push(guard);
    const forward = toWorld(team, 158, 0);
    if (!tooClose(forward.x, forward.y, placed, 36)) {
      pads.push({ id: `${team}-forward`, x: forward.x, y: forward.y, laneCoverage: 2, zone: "combat", team });
      placed.push(forward);
    }
    const bias = Math.floor(rng() * 3);
    const extra = bias === 2 ? 3 : 4;
    let guardN = 0;
    let n = 0;
    while (pads.filter((p) => p.team === team && p.zone !== "eco").length < 2 + extra && guardN++ < 40) {
      n += 1;
      const roll = rng();
      const lateral = roll < 0.45 ? -(40 + rng() * 90) : roll < 0.9 ? 40 + rng() * 90 : (rng() - 0.5) * 50;
      const along = 96 + rng() * 78;
      const p = toWorld(team, along, lateral);
      if (tooClose(p.x, p.y, placed, 34)) continue;
      if (nearRoad(p.x, p.y, 26)) continue;
      const lane: 0 | 1 | 2 = lateral < -20 ? 0 : lateral > 20 ? 1 : 2;
      pads.push({ id: `${team}-c-${n}`, x: p.x, y: p.y, laneCoverage: lane, zone: "combat", team });
      placed.push(p);
    }

    const pineCount = 2;
    const copperCount = bias === 2 ? 2 : 1;
    const placeNode = (id: string, kind: ResourceKind) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const lateral = (rng() - 0.5) * 280;
        const along = 36 + rng() * 130;
        const p = toWorld(team, along, lateral);
        if (nearRoad(p.x, p.y, 30)) continue;
        if (tooClose(p.x, p.y, placed, 40)) continue;
        if (tooClose(p.x, p.y, nodes.map((nd) => ({ x: nd.x, y: nd.yourY })), 40)) continue;
        const loads = kind === "pine" ? 8 + Math.floor(rng() * 6) : 6 + Math.floor(rng() * 5);
        const gold = kind === "pine" ? 0 : 16 + Math.floor(rng() * 6);
        const wood = kind === "pine" ? 9 + Math.floor(rng() * 4) : 0;
        const gather = kind === "pine" ? 1.05 + rng() * 0.25 : 1.9 + rng() * 0.35;
        const regen = kind === "pine" ? PINE_REGEN * (0.85 + rng() * 0.35) : COPPER_REGEN * (0.85 + rng() * 0.35);
        nodes.push({ id, kind, x: p.x, yourY: p.y, loads, gold, wood, gather, regen, team });
        return;
      }
    };
    for (let i = 0; i < pineCount; i++) placeNode(`${team}-pine-${i}`, "pine");
    for (let i = 0; i < copperCount; i++) placeNode(`${team}-ore-${i}`, "copper");
    if (!nodes.some((n) => n.team === team && n.kind === "pine")) placeNode(`${team}-pine-safe`, "pine");
    if (!nodes.some((n) => n.team === team && n.kind === "copper")) placeNode(`${team}-ore-safe`, "copper");
  }

  return {
    id: `tri-${seed}` as MapId,
    seed,
    name: `${adj} ${noun}`,
    tagline: "Three keeps. North and East both want the south gate.",
    pads,
    nodes,
    startTowerPad: "keep-guard",
    layout: "triangle",
    worldW: TRI_W,
    worldH: TRI_H,
    keeps,
    roads,
  };
}

/** Cache last generated map for getMap lookups during a session. */
const mapCache = new Map<string, MapDef>();

export function getMap(id: MapId): MapDef {
  const cached = mapCache.get(id);
  if (cached) return cached;
  const tri = /^tri-(\d+)$/.exec(id);
  if (tri) {
    const map = generateTriangleMap(Number(tri[1]));
    mapCache.set(map.id, map);
    return map;
  }
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

/** @deprecated kept for any leftover UI — now returns a few sample previews */
export function previewMapsForLevel(level: number, scoutSalt: number): MapDef[] {
  return [getOrCreateCampaignMap(level, scoutSalt)];
}

export function buildPads(map: MapDef): Pad[] {
  if (map.layout === "triangle") {
    return map.pads.map((p) => ({
      id: p.id,
      team: p.team ?? "you",
      pos: { x: p.x, y: p.y },
      laneCoverage: p.laneCoverage,
      zone: p.zone ?? "combat",
    }));
  }
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
  if (map.layout === "triangle") {
    return map.nodes.map((n) => ({
      id: n.id,
      team: n.team ?? "you",
      kind: n.kind,
      pos: { x: n.x, y: n.yourY },
      loadsLeft: n.loads,
      maxLoads: n.loads,
      maxWorkers: 2,
      workers: 0,
      gatherTime: n.gather,
      goldPerLoad: n.gold,
      woodPerLoad: n.wood,
      regenEvery: n.regen,
      regenAcc: 0,
    }));
  }
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
  if (team === "you") return { x: 200, y: 664 };
  if (team === "east") return { x: 700, y: 130 };
  return { x: 200, y: 56 };
}

export function keepPosFor(map: MapDef, team: Team) {
  if (map.layout === "triangle") {
    const k = map.keeps?.find((c) => c.team === team);
    if (k) return { x: k.x, y: k.y };
  }
  return keepPos(team === "east" ? "foe" : team);
}

export function villagerStart(team: Team, idx: number) {
  if (team === "you") return { x: 170 + idx * 60, y: 630 };
  return { x: 170 + idx * 60, y: 90 };
}

export function villagerStartFor(map: MapDef, team: Team, idx: number) {
  if (map.layout !== "triangle") return villagerStart(team, idx);
  const k = keepPosFor(map, team);
  const dir = team === "you" ? 1 : -1;
  return { x: k.x - 28 + idx * 36, y: k.y + dir * 34 };
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
  if (map.layout === "triangle") return `${team}-keep-guard`;
  return `${team}-${map.startTowerPad}`;
}

export function startPadPos(map: MapDef, team: Team) {
  if (map.layout === "triangle") {
    const p = map.pads.find((x) => x.id === `${team}-keep-guard`) ?? map.pads.find((x) => x.team === team) ?? map.pads[0];
    return { x: p.x, y: p.y };
  }
  const p = map.pads.find((x) => x.id === map.startTowerPad) ?? map.pads[0];
  return { x: p.x, y: team === "you" ? p.y : WORLD_H - p.y };
}
