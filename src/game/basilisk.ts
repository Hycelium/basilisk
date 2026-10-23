import { UNIT_DEFS, VILLAGER_HP, VILLAGER_SPEED, PEON_DAMAGE, WORLD_H } from "./balance";
import { chokePoints, deerSpots, type WorkKind } from "./basiliskMap";
import { getMap, keepPos } from "./map";
import type { ClanRankUi, GameState, KingController, KingOrder, MapId, Team, Unit, UnitKind, Vec2, Villager, WaveSpec } from "./types";
import { farmPlots, wheatPatchAt } from "./wheat";

export const BASILISK_START_EACH = 8;
export const BASILISK_SOFT_CAP = 15;
export const BASILISK_HARD_CAP = 30;
/** Chosen peons at kickoff per clan (the rest only haul). */
export const BASILISK_CHOSEN_START = 2;
/** Soft cap on living chosen souls per clan, not counting the player rejoin. */
export const BASILISK_CHOSEN_CAP = 3;
export const BASILISK_JOIN_WAIT = 8;
/** Share of each dump (and bounty) that goes in the coffer. 1 = the king gets all of it. */
export const KING_TAX = 1;
/** XP granted per keep dump before the fat-tail multiplier. */
export const XP_DUMP = 10;
/** XP granted per kill before the fat-tail multiplier. */
export const XP_KILL = 24;
/** Challenger must beat the crown XP by this factor to dethrone. */
export const KING_STICKY = 1.2;
export const LOAD_SIZE = 10;
export const FILL_RATE = 4;
/** Fast enough that walking across a grain patch fills a load. */
export const WHEAT_FILL_RATE = 18;
export const WORK_REACH = 16;
export const KEEP_REACH = 26;
/** Standing inside this radius of your own keep restores the body you possess. */
export const KEEP_HEAL_RANGE = 42;
/** Fraction of max hit points restored per second inside your keep. */
export const KEEP_HEAL_RATE = 0.28;
export const KING_KILL_NEED = 5;
export const BASILISK_KEEP_HP = 400;
export const BASILISK_START_COFFER = { gold: 150, wood: 125, food: 100 };
export const BASILISK_FIRST_BUILD = 48;
export const BASILISK_BUILD_PAUSE = 20;
export const BASILISK_KING_HP = 96;

/** Mirrored, lighter than Roadkeep so neither keep falls before towns stand. */
export const BASILISK_WAVES: WaveSpec[] = [
  { raider: 2, soldier: 0, brute: 0, runner: 0, ward: 0 },
  { raider: 4, soldier: 0, brute: 0, runner: 0, ward: 0 },
  { raider: 2, soldier: 2, brute: 0, runner: 0, ward: 0 },
  { raider: 4, soldier: 2, brute: 0, runner: 0, ward: 0 },
  { raider: 2, soldier: 2, brute: 0, runner: 2, ward: 0 },
  { raider: 0, soldier: 4, brute: 0, runner: 0, ward: 2 },
  { raider: 2, soldier: 2, brute: 2, runner: 0, ward: 0 },
  { raider: 4, soldier: 2, brute: 0, runner: 2, ward: 2 },
  { raider: 2, soldier: 4, brute: 2, runner: 2, ward: 0 },
  { raider: 0, soldier: 4, brute: 2, runner: 2, ward: 2 },
  { raider: 2, soldier: 4, brute: 4, runner: 2, ward: 2 },
  { raider: 4, soldier: 4, brute: 4, runner: 4, ward: 2 },
];

const WORK_KINDS: WorkKind[] = ["farm", "hunt", "gold", "wood"];

const KIND_RANK: Record<string, number> = {
  levy: 1,
  archer: 2,
  ward: 3,
  rammer: 4,
  runner: 5,
  trebuchet: 6,
};

export type TripCounts = { farm: number; hunt: number; gold: number; wood: number };
export type Coffer = { gold: number; wood: number; food: number };

export function defaultKingOrder(): Record<Team, KingOrder> {
  return { you: "gather", foe: "gather" };
}

export function defaultKingController(): Record<Team, KingController> {
  return { you: "ai", foe: "ai" };
}

export function isClanSoul(u: Unit) {
  return !!u.lifeStage;
}

/** Basilisk gatherer souls and Roadkeep villagers. */
export function isPeonBody(t: Unit | Villager): boolean {
  return !("kind" in t) || t.lifeStage === "gatherer";
}

export function isWaveCreep(u: Unit) {
  return !u.fromBarracks && !u.lifeStage && !u.npcKing;
}

export function emptyScars() {
  return { trees: 0, fields: 0, pit: 0, trails: 0 };
}

export function emptyTrips(): TripCounts {
  return { farm: 0, hunt: 0, gold: 0, wood: 0 };
}

export function emptyCoffer(): Coffer {
  return { gold: 0, wood: 0, food: 0 };
}

export function hashId(id: number) {
  return ((id * 1103515245 + 12345) >>> 0) / 4294967296;
}

export function dist(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pickWork(id: number): WorkKind {
  return WORK_KINDS[Math.floor(hashId(id) * WORK_KINDS.length)]!;
}

export function visionFromLife(u: Unit) {
  const t = u.trips ?? emptyTrips();
  return Math.min(8, (t.farm + t.hunt + t.gold + t.wood + (u.kills ?? 0)) * 0.7);
}

function gatherKind(trips: TripCounts): UnitKind | null {
  if (trips.wood >= 10) return "trebuchet";
  if (trips.farm >= 5 && trips.gold >= 5) return "runner";
  if (trips.wood >= 5) return "rammer";
  if (trips.gold >= 5) return "ward";
  if (trips.hunt >= 5) return "archer";
  if (trips.farm >= 5) return "levy";
  return null;
}

/** Finished a job-table rank (farm 5, hunt 5, gold 5, wood 5/10). */
export function jobReady(u: Unit) {
  return gatherKind(u.trips ?? emptyTrips()) != null;
}

function killKind(kills: number): UnitKind | null {
  if (kills >= 4) return "runner";
  if (kills >= 3) return "ward";
  if (kills >= 2) return "archer";
  if (kills >= 1) return "levy";
  return null;
}

function betterKind(a: UnitKind | null, b: UnitKind | null): UnitKind | null {
  const ra = a ? KIND_RANK[a] ?? 0 : 0;
  const rb = b ? KIND_RANK[b] ?? 0 : 0;
  if (rb > ra) return b;
  return a;
}

export function desiredKind(u: Unit): UnitKind | null {
  return betterKind(gatherKind(u.trips ?? emptyTrips()), killKind(u.kills ?? 0));
}

export function applyPeonBody(u: Unit) {
  u.kind = "levy";
  u.lifeStage = "gatherer";
  u.hp = VILLAGER_HP;
  u.maxHp = VILLAGER_HP;
  u.speed = VILLAGER_SPEED;
  u.damage = PEON_DAMAGE;
  u.carry = 0;
  u.carryKind = null;
  u.trips = emptyTrips();
  u.kills = 0;
  u.deposited = 0;
  u.xp = 0;
  u.siegePhase = undefined;
  u.chargeReady = false;
}

/** Preferential attachment so Chosen pull away and most peons stay a long tail. */
export function awardXp(u: Unit, base: number) {
  if (u.npcKing) return 0;
  const wealth = 1 + Math.max(0, u.xp ?? 0) * 0.03;
  const role = u.canPromote ? 1.55 : 0.55;
  const gain = Math.max(1, Math.round(base * role * Math.sqrt(wealth)));
  u.xp = (u.xp ?? 0) + gain;
  return gain;
}

export function insideOwnKeep(u: Unit) {
  return dist(u.pos, keepPos(u.team)) <= KEEP_HEAL_RANGE;
}

/** Restore the possessed body while it stands in its own keep. */
export function healInKeep(u: Unit, dt: number) {
  if (u.hp <= 0 || u.hp >= u.maxHp - 0.05) return false;
  if (!insideOwnKeep(u)) return false;
  u.hp = Math.min(u.maxHp, u.hp + u.maxHp * KEEP_HEAL_RATE * dt);
  return true;
}

export function canTakeCrown(u: Unit) {
  if (!u.canPromote || u.npcKing || u.hp <= 0) return false;
  return jobReady(u) || isMilitary(u) || (u.kills ?? 0) >= KING_KILL_NEED;
}

export type HaulNote = {
  dump: WorkKind;
  xp: number;
  promoted: string | null;
};

export function promotionPath(u: Unit): { label: string; have: number; need: number } {
  if (!u.canPromote) return { label: "Labor", have: 0, need: 0 };
  if (isMilitary(u)) return { label: "Crown", have: Math.floor(u.xp ?? 0), need: 0 };
  const t = u.trips ?? emptyTrips();
  const paths = [
    { label: "Levy", have: t.farm, need: 5 },
    { label: "Archer", have: t.hunt, need: 5 },
    { label: "Ward", have: t.gold, need: 5 },
    { label: "Ram", have: Math.min(t.wood, 5), need: 5 },
    { label: "Runner", have: Math.min(t.farm, t.gold), need: 5 },
    { label: "Trebuchet", have: t.wood, need: 10 },
    { label: "Blood", have: u.kills ?? 0, need: KING_KILL_NEED },
  ];
  let best = paths[0]!;
  let bestScore = -1;
  for (const p of paths) {
    if (p.have >= p.need) continue;
    const score = p.have / p.need;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function soulRole(u: Unit, isKing: boolean) {
  if (u.npcKing) return "Steward";
  if (isKing) return "King";
  if (u.lifeStage === "gatherer") return u.canPromote ? "Chosen" : "Peon";
  return UNIT_DEFS[u.kind]?.label ?? "Soul";
}

function soulName(u: Unit, you: boolean, isKing: boolean) {
  if (you) return "You";
  return soulRole(u, isKing);
}

export function clanRanks(state: GameState, team: Team, youId: number | null): ClanRankUi[] {
  const living = state.units.filter((u) => u.team === team && u.hp > 0 && (isClanSoul(u) || u.npcKing));
  living.sort((a, b) => (b.xp ?? 0) - (a.xp ?? 0) || a.id - b.id);
  const crown = living.find((u) => u.id === state.crownId[team]) ?? living.find((u) => u.npcKing);
  const maxXp = Math.max(1, ...living.map((u) => u.xp ?? 0), state.kingScore[team] ?? 0);
  const rows: ClanRankUi[] = living.map((u, i) => {
    const king = crown?.id === u.id;
    const you = youId != null && u.id === youId;
    const path = promotionPath(u);
    const nextPct = path.need > 0 ? Math.max(0, Math.min(1, path.have / path.need)) : king ? 1 : 0;
    const nextLabel =
      path.need > 0 ? `${path.label} ${path.have}/${path.need}` : king ? "Wears the crown" : path.label === "Labor" ? "Cannot promote" : "Contest the crown";
    return {
      id: u.id,
      rank: i + 1,
      name: soulName(u, you, king),
      xp: Math.floor(u.xp ?? 0),
      pct: (u.xp ?? 0) / maxXp,
      you,
      king,
      chosen: !!u.canPromote && !u.npcKing,
      role: soulRole(u, king),
      nextLabel,
      nextPct,
    };
  });
  if (state.kingController[team] === "player" && youId != null && !rows.some((r) => r.you)) {
    const xp = Math.floor(state.kingScore[team] ?? 0);
    rows.unshift({
      id: youId,
      rank: 1,
      name: "You",
      xp,
      pct: xp / maxXp,
      you: true,
      king: true,
      chosen: true,
      role: "King",
      nextLabel: "Wears the crown",
      nextPct: 1,
    });
    rows.forEach((r, i) => {
      r.rank = i + 1;
    });
  }
  const top = rows.slice(0, 5);
  const extras = rows.filter((r) => (r.you || r.king) && !top.includes(r));
  return [...top, ...extras];
}

export function clanPanel(state: GameState, team: Team, youId: number | null, soul: Unit | undefined) {
  const ranks = clanRanks(state, team, youId);
  const youRow = ranks.find((r) => r.you);
  const kingRow = ranks.find((r) => r.king);
  const path = soul ? promotionPath(soul) : { label: "Levy", have: 0, need: 5 };
  const kingYou = state.kingController[team] === "player";
  const kingName = kingRow?.name ?? (kingYou ? "You" : "Steward");
  const kingXp = kingRow?.xp ?? Math.floor(state.kingScore[team] ?? 0);
  const xp = youRow?.xp ?? Math.floor(soul?.xp ?? 0);
  const needSticky = Math.ceil(Math.max(kingXp, 1) * KING_STICKY);
  let crownHint: string;
  if (kingYou) crownHint = `Your crown · ${xp} XP. Hold it past ${needSticky}.`;
  else if (!soul?.canPromote) crownHint = "Labor only — you cannot take the crown.";
  else if (!canTakeCrown(soul) && soul.lifeStage === "gatherer") {
    crownHint = `${path.label} ${path.have}/${path.need} to promote, then beat ${kingName}'s ${kingXp} XP.`;
  } else if (xp * KING_STICKY <= kingXp && xp < needSticky) {
    crownHint = `${kingName} leads on ${kingXp} XP. You need ${needSticky} to take the crown.`;
  } else {
    crownHint = `Seizing the keep — ${xp} XP vs ${kingName} ${kingXp}.`;
  }
  const skim = state.lastSkim[team];
  const lastSkim =
    skim && skim.life > 0 ? `+${skim.amount} ${skim.kind} → coffer · +${skim.xp} XP` : null;
  return {
    ranks,
    kingName,
    kingXp,
    xp,
    xpRank: youRow?.rank ?? ranks.length,
    clanSize: state.units.filter((u) => u.team === team && u.hp > 0 && (isClanSoul(u) || u.npcKing)).length,
    promotionLabel: path.label,
    promotionHave: path.have,
    promotionNeed: path.need,
    promotionPct: path.need > 0 ? Math.max(0, Math.min(1, path.have / path.need)) : kingYou ? 1 : 0,
    crownHint,
    skimLine: "King takes every haul into the coffer.",
    lastSkim,
    moment: state.clanMoment[team],
  };
}

export function morphKind(u: Unit, kind: UnitKind) {
  if (u.kind === kind && u.lifeStage !== "gatherer") return false;
  const def = UNIT_DEFS[kind];
  u.kind = kind;
  if (u.lifeStage !== "king") u.lifeStage = "warrior";
  u.hp = def.hp;
  u.maxHp = def.hp;
  u.speed = def.speed;
  u.damage = def.damage;
  u.bounty = def.bounty;
  u.attackCooldown = def.cooldown;
  u.towerResist = def.towerResist;
  u.keepMult = def.keepMult;
  u.siegeGap = def.siegeGap;
  u.chargeReady = kind === "runner";
  u.siegePhase = kind === "trebuchet" ? "packed" : undefined;
  u.siegeTimer = 0;
  return true;
}

export function applyRank(u: Unit) {
  if (!u.canPromote) return false;
  const next = desiredKind(u);
  if (!next) return false;
  return morphKind(u, next);
}

export function payDeposit(state: GameState, u: Unit) {
  const kind = u.carryKind;
  if (!kind || (u.carry ?? 0) < LOAD_SIZE) return null;
  const amount = LOAD_SIZE;
  const cut = amount * KING_TAX;
  const rest = amount - cut;
  const coffer = state.kingCoffer[u.team];
  if (kind === "gold") {
    coffer.gold += cut;
    state.gold[u.team] += rest;
    state.stats[u.team].goldEarned += amount;
  } else if (kind === "wood") {
    coffer.wood += cut;
    state.wood[u.team] += rest;
  } else {
    coffer.food += cut;
    state.food[u.team] += rest;
  }
  u.trips = u.trips ?? emptyTrips();
  u.trips[kind] += 1;
  u.deposited = (u.deposited ?? 0) + amount;
  u.carry = 0;
  u.carryKind = null;
  const xp = awardXp(u, XP_DUMP);
  if (kind === "wood") state.scars.trees += 1;
  if (kind === "farm") state.scars.fields += 1;
  if (kind === "gold") state.scars.pit += 1;
  if (kind === "hunt") state.scars.trails += 1;
  return { kind, amount, xp };
}

export function nearestWork(team: Team, pos: Vec2, kind?: WorkKind | null, seed = 0) {
  const plots = farmPlots(seed, team);
  const sites: { kind: WorkKind; pos: Vec2 }[] = [];
  if (!kind || kind === "farm") {
    for (const p of plots) sites.push({ kind: "farm", pos: { x: p.x, y: p.y } });
  }
  if (!kind || kind === "hunt") {
    for (const spot of deerSpots(team, seed)) sites.push({ kind: "hunt", pos: spot });
  }
  const map = getMap(`seed-${seed >>> 0}` as MapId);
  const south = team === "you";
  for (const n of map.nodes) {
    const at = { x: n.x, y: south ? n.yourY : WORLD_H - n.yourY };
    if (n.kind === "copper" && (!kind || kind === "gold")) sites.push({ kind: "gold", pos: at });
    if (n.kind === "pine" && (!kind || kind === "wood")) sites.push({ kind: "wood", pos: at });
  }
  let best = sites[0] ?? null;
  let bestD = Infinity;
  for (const site of sites) {
    const d = dist(pos, site.pos);
    if (d < bestD) {
      bestD = d;
      best = site;
    }
  }
  return best ? { ...best, dist: bestD } : null;
}

function wheatWantsFill(state: GameState, u: Unit) {
  if (u.carryKind && u.carryKind !== "farm") return false;
  if (u.workKind === "farm" || u.workKind == null) return true;
  return u.id === state.possessedId;
}

/** Fill at a node or dump at the keep. Returns XP/promotion when a load lands. */
export function stepHaul(state: GameState, u: Unit, dt: number): HaulNote | null {
  if (u.lifeStage !== "gatherer") return null;
  const keep = keepPos(u.team);
  if ((u.carry ?? 0) >= LOAD_SIZE) {
    if (dist(u.pos, keep) <= KEEP_REACH) {
      const paid = payDeposit(state, u);
      if (!paid) return null;
      const ranked = applyRank(u);
      return {
        dump: paid.kind,
        xp: paid.xp,
        promoted: ranked ? UNIT_DEFS[u.kind].label : null,
      };
    }
    return null;
  }
  if (wheatWantsFill(state, u) && wheatPatchAt(state.mapSeed, u.pos)) {
    u.carryKind = "farm";
    u.carry = Math.min(LOAD_SIZE, (u.carry ?? 0) + WHEAT_FILL_RATE * dt);
    return null;
  }
  const want = u.carryKind ?? u.workKind;
  const near = nearestWork(u.team, u.pos, want, state.mapSeed);
  if (!near || near.dist > WORK_REACH) return null;
  if (!u.carryKind) u.carryKind = near.kind;
  if (u.carryKind !== near.kind) return null;
  u.carry = Math.min(LOAD_SIZE, (u.carry ?? 0) + FILL_RATE * dt);
  return null;
}

export function haulDestination(u: Unit, seed = 0): Vec2 | null {
  if (u.lifeStage !== "gatherer") return null;
  if ((u.carry ?? 0) >= LOAD_SIZE) return keepPos(u.team);
  const onGrain =
    (u.carryKind === "farm" || u.workKind === "farm" || u.workKind == null) && wheatPatchAt(seed, u.pos);
  if (onGrain) return { x: u.pos.x, y: u.pos.y };
  if (u.carryKind && (u.carry ?? 0) > 0) {
    return nearestWork(u.team, u.pos, u.carryKind, seed)?.pos ?? null;
  }
  return nearestWork(u.team, u.pos, u.workKind, seed)?.pos ?? null;
}

export function orderTarget(state: GameState, u: Unit): Vec2 | null {
  if (u.lifeStage === "gatherer") return haulDestination(u, state.mapSeed);
  const order = state.kingOrder[u.team];
  if (order === "gather") return keepPos(u.team);
  const chokes = chokePoints(state.mapSeed);
  if (order === "hold") return chokes[u.id % Math.max(1, chokes.length)] ?? chokes[0]!;
  let best = chokes[0]!;
  let bestD = Infinity;
  for (const e of state.units) {
    if (e.team === u.team || e.hp <= 0) continue;
    const d = dist(u.pos, e.pos);
    if (d < bestD) {
      bestD = d;
      best = e.pos;
    }
  }
  if (bestD > 220) return chokes[u.id % chokes.length]!;
  return { ...best };
}

export function refreshKings(state: GameState) {
  for (const team of ["you", "foe"] as Team[]) {
    const living = state.units.filter((u) => u.team === team && u.hp > 0);
    if (state.kingController[team] === "player") {
      const steward = living.find((u) => u.npcKing);
      state.kingId[team] = steward?.id ?? state.kingId[team];
      continue;
    }
    const npc = living.find((u) => u.npcKing);
    if (!npc) {
      state.kingId[team] = null;
      continue;
    }
    for (const u of living) {
      if (u.lifeStage === "king" && !u.npcKing) u.lifeStage = "warrior";
    }
    npc.lifeStage = "king";
    state.kingId[team] = npc.id;
  }
}

export function countClan(state: GameState, team: Team) {
  return state.units.filter((u) => u.team === team && u.hp > 0 && isClanSoul(u) && !u.npcKing).length;
}

export function countChosen(state: GameState, team: Team) {
  return state.units.filter((u) => u.team === team && u.hp > 0 && u.canPromote && !u.npcKing).length;
}

export function isMilitary(u: Unit) {
  return u.lifeStage === "warrior" || u.lifeStage === "king";
}
