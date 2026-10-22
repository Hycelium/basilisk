import { UNIT_DEFS, VILLAGER_HP, VILLAGER_SPEED, PEON_DAMAGE } from "./balance";
import { allWorkSites, chokePoints, type WorkKind } from "./basiliskMap";
import { keepPos } from "./map";
import type { GameState, KingController, KingOrder, Team, Unit, UnitKind, Vec2, Villager, WaveSpec } from "./types";

export const BASILISK_START_EACH = 8;
export const BASILISK_SOFT_CAP = 15;
export const BASILISK_HARD_CAP = 30;
/** Chosen peons at kickoff per clan (the rest only haul). */
export const BASILISK_CHOSEN_START = 2;
/** Soft cap on living chosen souls per clan, not counting the player rejoin. */
export const BASILISK_CHOSEN_CAP = 3;
export const BASILISK_JOIN_WAIT = 8;
export const KING_TAX = 0.15;
export const LOAD_SIZE = 10;
export const FILL_RATE = 4;
export const WORK_REACH = 16;
export const KEEP_REACH = 26;
export const KING_KILL_NEED = 5;
export const BASILISK_KEEP_HP = 400;
export const BASILISK_START_COFFER = { gold: 150, wood: 125, food: 0 };
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
  u.siegePhase = undefined;
  u.chargeReady = false;
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
  if (!kind || (u.carry ?? 0) < LOAD_SIZE) return false;
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
  if (kind === "wood") state.scars.trees += 1;
  if (kind === "farm") state.scars.fields += 1;
  if (kind === "gold") state.scars.pit += 1;
  if (kind === "hunt") state.scars.trails += 1;
  return true;
}

export function nearestWork(team: Team, pos: Vec2, kind?: WorkKind | null) {
  const sites = kind ? allWorkSites(team).filter((s) => s.kind === kind) : allWorkSites(team);
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

/** Fill at a node or dump at the keep. Returns a toast label on deposit or rank-up. */
export function stepHaul(state: GameState, u: Unit, dt: number) {
  if (u.lifeStage !== "gatherer") return null;
  const keep = keepPos(u.team);
  if ((u.carry ?? 0) >= LOAD_SIZE) {
    if (dist(u.pos, keep) <= KEEP_REACH) {
      const kind = u.carryKind;
      payDeposit(state, u);
      const ranked = applyRank(u);
      if (ranked) return `Promoted to ${UNIT_DEFS[u.kind].label}. The crown is yours.`;
      if (u.canPromote) {
        const t = u.trips ?? emptyTrips();
        const next =
          kind === "wood" ? `wood ${t.wood}/10` : kind ? `${kind} ${t[kind]}/5` : "five dumps";
        return `Dumped ${kind ?? "load"}. ${next} takes the crown.`;
      }
      return `Dumped ${kind ?? "load"} at the keep.`;
    }
    return null;
  }
  const near = nearestWork(u.team, u.pos, u.carryKind);
  if (!near || near.dist > WORK_REACH) return null;
  if (!u.carryKind) u.carryKind = near.kind;
  if (u.carryKind !== near.kind) return null;
  u.carry = Math.min(LOAD_SIZE, (u.carry ?? 0) + FILL_RATE * dt);
  return null;
}

export function haulDestination(u: Unit): Vec2 | null {
  if (u.lifeStage !== "gatherer") return null;
  if ((u.carry ?? 0) >= LOAD_SIZE) return keepPos(u.team);
  const site = nearestWork(u.team, u.pos, u.workKind ?? u.carryKind);
  return site?.pos ?? null;
}

export function orderTarget(state: GameState, u: Unit): Vec2 | null {
  if (u.lifeStage === "gatherer") return haulDestination(u);
  const order = state.kingOrder[u.team];
  if (order === "gather") return keepPos(u.team);
  const chokes = chokePoints();
  if (order === "hold") return chokes[u.id % chokes.length] ?? chokes[1]!;
  let best = chokes[1]!;
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
