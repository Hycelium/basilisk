import { COPPER_REGEN, KEEP_MARGIN, PINE_REGEN, ROAD_X, WORLD_H, WORLD_W } from "./balance";
import type { Lane, LaneCount, MapDef, MapId, Pad, ResourceNode, ResourceKind, Team, Vec2 } from "./types";

/** River belts keyed by how far they sit from your keep. */
export type RiverLayerId = "home" | "mid" | "forward";

export interface RiverBand {
  id: RiverLayerId;
  y: number;
  amplitude: number;
  phase: number;
  width: number;
}

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

/** Both keeps sit on this X. Wider maps grow outward from it, so 3-road maps reach below x = 0. */
export const MAP_CX = WORLD_W / 2;
/** Extra ground past each keep so the house yard sits on the field, not the cliff. */
export const BACK_FIELD = 180;
const LANE_SPACING = ROAD_X[1] - ROAD_X[0];
const HALF_WIDTH: Record<LaneCount, number> = { 1: 160, 2: 200, 3: 280 };
const ALL_LANES: Lane[] = [0, 1, 2];

/** The seed carries the road count, so both peers and the renderer agree without extra data. */
export function laneCount(seed: number): LaneCount {
  return (((seed >>> 0) % 3) + 1) as LaneCount;
}

export function mapLanes(seed: number): Lane[] {
  return ALL_LANES.slice(0, laneCount(seed));
}

export function mapBounds(seed: number) {
  const half = HALF_WIDTH[laneCount(seed)];
  return { minX: MAP_CX - half, maxX: MAP_CX + half, width: half * 2 };
}

/** 3-road outer lanes close to this fraction of mid-map spacing at each keep (~14px, on the gate). */
const KEEP_FAN_IN = 0.08;
/** 2-road lanes meet the keep on its side walls, one road to each flank. */
const KEEP_FLANK = 30;
/** Fraction of the march used to open/close the fan. */
const FAN_ZONE = 0.26;

function smoothstep(lo: number, hi: number, x: number) {
  const k = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return k * k * (3 - 2 * k);
}

/** Road spine before bends. 2-road maps meet the keep flanks; 3-road maps tuck into the gate. */
function roadBaseX(seed: number, lane: Lane, t: number) {
  const n = laneCount(seed);
  const offset = (lane - (n - 1) / 2) * LANE_SPACING;
  if (n < 2) return MAP_CX + offset;
  const fan = smoothstep(0, FAN_ZONE, t) * smoothstep(0, FAN_ZONE, 1 - t);
  if (n === 2) {
    const atKeep = Math.sign(offset) * KEEP_FLANK;
    return MAP_CX + atKeep + (offset - atKeep) * fan;
  }
  return MAP_CX + offset * (KEEP_FAN_IN + (1 - KEEP_FAN_IN) * fan);
}

export function laneName(seed: number, lane: Lane) {
  const n = laneCount(seed);
  if (n === 1) return "the";
  if (n === 3 && lane === 1) return "the middle";
  return lane === 0 ? "the west" : "the east";
}

/** Curved road centerline shared by simulation and renderer. */
export function roadCenterX(seed: number, lane: Lane, y: number) {
  const t = Math.max(0, Math.min(1, (y - 72) / (WORLD_H - 144)));
  // Pin both ends to their gates, with two deterministic broad bends in between.
  const envelope = Math.sin(Math.PI * t);
  const a = ((hashSeed(seed, lane, 17) % 2001) / 1000 - 1) * 25;
  const b = ((hashSeed(seed, lane, 31) % 2001) / 1000 - 1) * 11;
  const phase = ((hashSeed(seed, lane, 47) % 1000) / 1000) * Math.PI * 2;
  return (
    roadBaseX(seed, lane, t) +
    envelope * (a * Math.sin(Math.PI * t + phase) + b * Math.sin(Math.PI * 3 * t - phase * 0.4))
  );
}

/** Offset teams to opposite shoulders of the same meandering road. */
export function lanePathX(seed: number, team: Team, lane: Lane, y: number) {
  return roadCenterX(seed, lane, y) + (team === "you" ? -13 : 13);
}

/** Distance from x to the nearest road centerline at y. */
export function roadGap(seed: number, x: number, y: number) {
  return Math.min(...mapLanes(seed).map((lane) => Math.abs(x - roadCenterX(seed, lane, y))));
}

/** Keep yard stays dry; rivers sit this far in from each keep. */
const BASE_RIVER_INSET = 220;

/**
 * Rivers follow road count:
 * 1 lane → central river, 1 bridge
 * 2 lanes → river at each base edge, 2 bridges each
 * 3 lanes → home + mid + forward rivers, 3 bridges each
 */
export function riverLayers(seed: number): RiverBand[] {
  const n = laneCount(seed);
  const variant = hashSeed(seed, 0x51a7);
  const amplitude = 10 + ((variant >>> 8) % 14);
  const phase = (((variant >>> 16) % 1000) / 1000) * Math.PI * 2;
  const width = 16 + ((variant >>> 24) % 8);
  const mk = (id: RiverLayerId, y: number, phaseShift: number): RiverBand => ({
    id,
    y,
    amplitude,
    phase: phase + phaseShift,
    width,
  });
  const north = KEEP_MARGIN + BASE_RIVER_INSET;
  const south = WORLD_H - KEEP_MARGIN - BASE_RIVER_INSET;
  const mid = WORLD_H / 2;
  if (n === 1) return [mk("mid", mid, 0)];
  if (n === 2) return [mk("forward", north, -0.55), mk("home", south, 0.7)];
  return [mk("forward", north, -0.55), mk("mid", mid, 0), mk("home", south, 0.7)];
}

export function riverYAt(band: RiverBand, simX: number) {
  return band.y + Math.sin((simX / WORLD_W) * Math.PI * 2 + band.phase) * band.amplitude;
}

/** Shim for single-band callers — always the mid (or only) river, always on. */
export function riverSpec(seed: number) {
  const layers = riverLayers(seed);
  const r = layers.find((l) => l.id === "mid") ?? layers[0]!;
  return { enabled: true as const, y: r.y, amplitude: r.amplitude, phase: r.phase, width: r.width };
}

export function bridgeCrossing(seed: number, lane: Lane, band: RiverBand): Vec2 {
  let y = band.y;
  for (let pass = 0; pass < 3; pass++) {
    const x = roadCenterX(seed, lane, y);
    y = riverYAt(band, x);
  }
  return { x: roadCenterX(seed, lane, y), y };
}

/** All lane×river bridge centers, or one layer when `layerId` is set. */
export function bridgePoints(seed: number, layerId?: RiverLayerId): Vec2[] {
  const bands = layerId ? riverLayers(seed).filter((b) => b.id === layerId) : riverLayers(seed);
  const pts: Vec2[] = [];
  for (const band of bands) {
    for (const lane of mapLanes(seed)) pts.push(bridgeCrossing(seed, lane, band));
  }
  return pts;
}

export type DefendStanceId = "keep" | RiverLayerId | "assault";

export function defendLayerOptions(seed: number): { id: DefendStanceId; label: string }[] {
  const present = new Set(riverLayers(seed).map((b) => b.id));
  const belts: { id: DefendStanceId; label: string }[] = [
    { id: "home", label: "Home bridges" },
    { id: "mid", label: present.size === 1 ? "Central bridge" : "Mid bridges" },
    { id: "forward", label: "Forward bridges" },
  ];
  return [
    { id: "keep", label: "Defend keep" },
    ...belts.filter((o) => present.has(o.id as RiverLayerId)),
    { id: "assault", label: "Assault keep" },
  ];
}

/**
 * Player-relative stance → absolute river belt.
 * South ("you") keeps home/forward as authored; north ("foe") swaps them so
 * Home = nearest bridge and Forward = far bridge for both players.
 */
export function absoluteRiverLayer(layerId: RiverLayerId, team: Team): RiverLayerId {
  if (team === "you" || layerId === "mid") return layerId;
  if (layerId === "home") return "forward";
  if (layerId === "forward") return "home";
  return layerId;
}

/** Rally spot for a troop stance — own keep, nearest/far bridges, or enemy gate. */
export function defendPointFor(
  seed: number,
  layerId: DefendStanceId,
  lane: Lane,
  unitId: number,
  team: Team = "you",
): Vec2 {
  if (layerId === "keep") {
    const gate = laneYGate(team);
    return { x: lanePathX(seed, team, lane, gate), y: gate };
  }
  if (layerId === "assault") {
    const foe: Team = team === "you" ? "foe" : "you";
    const gate = laneYGate(foe);
    const approach = foe === "you" ? gate + 48 : gate - 48;
    return { x: lanePathX(seed, team, lane, approach), y: approach };
  }
  const belt = absoluteRiverLayer(layerId, team);
  const band = riverLayers(seed).find((b) => b.id === belt);
  if (band) return bridgeCrossing(seed, lane, band);
  const pts = bridgePoints(seed);
  return pts[unitId % Math.max(1, pts.length)] ?? { x: MAP_CX, y: WORLD_H / 2 };
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

/** One line that names what this seed actually placed. */
function describeGeneratedMap(
  seed: number,
  roads: LaneCount,
  pads: MapDef["pads"],
  nodes: MapDef["nodes"],
) {
  const road = roads === 1 ? "One road" : roads === 2 ? "Two roads" : "Three roads";
  const belts = riverLayers(seed).length;
  const riverLine =
    belts === 1
      ? "One central river · one bridge"
      : belts === 2
        ? "Rivers at each base · two bridges each"
        : "Three river lines · three bridges each";
  const pines = nodes.filter((n) => n.kind === "pine");
  const ore = nodes.filter((n) => n.kind === "copper");
  const crowdedAt = roads === 1 ? 5 : roads === 2 ? 8 : 10;
  const fewAt = roads === 1 ? 4 : roads === 2 ? 6 : 8;
  let ground = "Even pads and veins";
  if (ore.some((n) => n.yourY >= 560)) ground = "Ore by the gate";
  else if (ore.length > 0 && ore.every((n) => n.yourY <= 480)) ground = "Mines sit up the road";
  else if (pines.length > 0 && pines.every((n) => n.yourY <= 500)) ground = "Groves sit forward of the gate";
  else if (pads.length >= crowdedAt) ground = "Crowded pads";
  else if (pads.length <= fewAt) ground = "Fewer pads";
  else if (ore.length > pines.length) ground = "Mines outnumber the groves";
  else if (pines.length > ore.length) ground = "Timber outnumbers the ore";
  return `${road}. ${riverLine}. ${ground}.`;
}

/** Towers on a pad this close to a road's centerline count as covering it. */
const PAD_REACH = 110;
/** Pads and resource nodes stay this far off a road's centerline. */
const ROAD_CLEAR = 26;

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
  const lanes = mapLanes(seed);
  const roads = lanes.length as LaneCount;
  // This draw used to pick a random tagline. Keep it so existing layouts stay put.
  rng();
  const { minX, maxX } = mapBounds(seed);
  const nearRoad = (x: number, y: number, gap: number) =>
    lanes.some((lane) => Math.abs(x - roadCenterX(seed, lane, y)) < gap);
  const coverage = (x: number, y: number): Lane[] => {
    const gaps = lanes.map((lane) => ({ lane, gap: Math.abs(x - roadCenterX(seed, lane, y)) }));
    const reached = gaps.filter((g) => g.gap <= PAD_REACH).map((g) => g.lane);
    return reached.length > 0 ? reached : [gaps.sort((a, b) => a.gap - b.gap)[0].lane];
  };

  // Bias: 0 open, 1 choke, 2 economy
  const bias = Math.floor(rng() * 3);
  // Same pad count beside every road, so no road is cheaper to hold than another.
  const padsPerRoad = bias === 2 ? 2 : 2 + Math.floor(rng() * 2);
  const extraOre = bias === 2 ? 1 : 0;
  const pineCount = roads === 1 ? 2 : roads === 2 ? 2 + Math.floor(rng() * 2) : 4 + Math.floor(rng() * 2);
  const copperCount = extraOre + (roads === 1 ? 1 : roads === 2 ? 1 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 2));

  const pads: MapDef["pads"] = [];
  const placed: { x: number; y: number }[] = [];

  // Odd road counts run a road straight into each keep, so the central pads step off it.
  const centerSide = rng() < 0.5 ? -1 : 1;
  const centerX = (side: number) => (roads % 2 === 1 ? MAP_CX + side * 46 : MAP_CX);

  // Pads hug your keep; the long midfield stays empty as no-man's-land.
  const yourKeepY = WORLD_H - KEEP_MARGIN;
  // Always: keep-guard pad (starter). Its tower reaches every road at the gate.
  const keepY = yourKeepY - 116 + Math.floor(rng() * 20);
  const guardX = centerX(centerSide);
  pads.push({ id: "keep-guard", x: guardX, y: keepY, laneCoverage: [...lanes] });
  placed.push({ x: guardX, y: keepY });

  // Forward / choke center — still on your half, not out in the mid strip.
  const forwardY =
    bias === 1 ? yourKeepY - 204 + Math.floor(rng() * 25) : yourKeepY - 209 + Math.floor(rng() * 40);
  const forwardX = centerX(-centerSide);
  if (!tooClose(forwardX, forwardY, placed, 36)) {
    pads.push({ id: "forward", x: forwardX, y: forwardY, laneCoverage: coverage(forwardX, forwardY) });
    placed.push({ x: forwardX, y: forwardY });
  }

  const tryPad = (id: string, x: number, y: number) => {
    const px = clamp(x, minX + 30, maxX - 30);
    const py = clamp(y, yourKeepY - 214, yourKeepY - 84);
    if (nearRoad(px, py, ROAD_CLEAR + 4)) return false;
    if (tooClose(px, py, placed, 34)) return false;
    pads.push({ id, x: px, y: py, laneCoverage: coverage(px, py) });
    placed.push({ x: px, y: py });
    return true;
  };

  for (const lane of lanes) {
    let made = 0;
    for (let attempt = 0; attempt < 40 && made < padsPerRoad; attempt++) {
      const y = yourKeepY - 194 + Math.floor(rng() * 100);
      const side = rng() < 0.5 ? -1 : 1;
      const x = roadCenterX(seed, lane, y) + side * (34 + Math.floor(rng() * 50));
      if (tryPad(`r${lane}-${made}`, x, y)) made++;
    }
  }

  const nodes: MapDef["nodes"] = [];
  const nodeSpots: { x: number; y: number }[] = [];

  const placeNode = (id: string, kind: ResourceKind, preferEdge: "w" | "e" | "any") => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const lo = preferEdge === "e" ? MAP_CX + 20 : minX + 28;
      const hi = preferEdge === "w" ? MAP_CX - 20 : maxX - 28;
      const x = lo + Math.floor(rng() * (hi - lo));
      const yourY = yourKeepY - 264 + Math.floor(rng() * 220);
      // Keep resources off this map's actual curved road centers.
      if (nearRoad(x, yourY, 32)) continue;
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

  const tagline = describeGeneratedMap(seed, roads, pads, nodes);

  return {
    id: `seed-${seed}` as MapId,
    seed,
    name,
    tagline,
    lanes: roads,
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
 * Names are fixed; the seed sets the road count, the road bends and the river.
 */
const SKIRMISH_LAYOUTS: { name: string; tagline: string; seed: number }[] = [
  { name: "Night Crossing", tagline: "Two gentle roads. The river crosses the north.", seed: 1 },
  { name: "Ashen Ford", tagline: "Two roads; the west one bows out. A quiet river crosses the middle.", seed: 7 },
  { name: "Copper Bend", tagline: "One road between the keeps. The river runs to the south.", seed: 21 },
  { name: "Iron Notch", tagline: "One dry road, straight to the gate.", seed: 12 },
  { name: "Hollow March", tagline: "Three roads; the west two lean west. The river crooks through the north half.", seed: 215 },
  { name: "Ember Reach", tagline: "Three dry roads. The outer two swing wide.", seed: 20 },
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

  // Eco slots behind each keep (houses only) — south of your keep / north of foe.
  // One more slot per road: wider maps feed more peons.
  const ecoCount = map.lanes + 1;
  for (let k = 0; k < ecoCount; k++) {
    const offset = k - map.lanes / 2;
    const x = MAP_CX + offset * 52;
    const y = WORLD_H - KEEP_MARGIN + 54 + Math.abs(offset) * 8;
    pads.push({
      id: `you-eco-${k}`,
      team: "you",
      pos: { x, y },
      laneCoverage: [],
      zone: "eco",
    });
    pads.push({
      id: `foe-eco-${k}`,
      team: "foe",
      pos: { x, y: WORLD_H - y },
      laneCoverage: [],
      zone: "eco",
    });
  }

  // Four purple midfield eco pads — two nearer each base, mirrored and balanced.
  const midSlots: { id: string; team: Team; x: number; y: number }[] = [
    { id: "mid-w", team: "you", x: MAP_CX - 78, y: WORLD_H * 0.64 },
    { id: "mid-e", team: "you", x: MAP_CX + 78, y: WORLD_H * 0.68 },
    { id: "mid-w", team: "foe", x: MAP_CX - 78, y: WORLD_H * 0.36 },
    { id: "mid-e", team: "foe", x: MAP_CX + 78, y: WORLD_H * 0.32 },
  ];
  for (const slot of midSlots) {
    pads.push({
      id: `${slot.team}-${slot.id}`,
      team: slot.team,
      pos: { x: slot.x, y: slot.y },
      laneCoverage: [],
      zone: "midEco",
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
  return team === "you" ? { x: 200, y: WORLD_H - KEEP_MARGIN } : { x: 200, y: KEEP_MARGIN };
}

export function villagerStart(team: Team, idx: number) {
  if (team === "you") return { x: 170 + idx * 60, y: WORLD_H - KEEP_MARGIN - 34 };
  return { x: 170 + idx * 60, y: KEEP_MARGIN + 34 };
}

export function laneYGate(team: Team) {
  return team === "you" ? KEEP_MARGIN + 40 : WORLD_H - KEEP_MARGIN - 40;
}

export function laneStartY(team: Team) {
  return team === "you" ? WORLD_H - KEEP_MARGIN - 36 : KEEP_MARGIN + 36;
}

export function startPadId(map: MapDef, team: Team) {
  return `${team}-${map.startTowerPad}`;
}

export function startPadPos(map: MapDef, team: Team) {
  const p = map.pads.find((x) => x.id === map.startTowerPad) ?? map.pads[0];
  return { x: p.x, y: team === "you" ? p.y : WORLD_H - p.y };
}
