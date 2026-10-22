import { UNIT_DEFS } from "./balance";
import { chokePoints, JOB_PROMOTE } from "./basiliskMap";
import type { GameState, Job, KingOrder, Team, Unit, Vec2 } from "./types";

export const BASILISK_START_EACH = 8;
export const BASILISK_SOFT_CAP = 15;
export const BASILISK_HARD_CAP = 30;
export const BASILISK_JOIN_WAIT = 8;
export const KING_TAX = 0.15;
export const KING_STICKY = 12;

const JOBS: Job[] = ["farmer", "hunter", "smith", "lumber"];

export function defaultKingOrder(): Record<Team, KingOrder> {
  return { you: "gather", foe: "gather" };
}

export function emptyScars() {
  return { trees: 0, fields: 0, pit: 0, trails: 0 };
}

export function hashId(id: number) {
  return ((id * 1103515245 + 12345) >>> 0) / 4294967296;
}

/** Heterogeneous promotion bar so most stay gatherers (fat tail). */
export function promoteThreshold(id: number) {
  return 48 + hashId(id) * 110;
}

export function gatherYield(job: Job) {
  if (job === "farmer") return { gold: 0, wood: 0, food: 0.55 };
  if (job === "lumber") return { gold: 0, wood: 0.42, food: 0 };
  if (job === "smith") return { gold: 0.38, wood: 0, food: 0 };
  return { gold: 0.08, wood: 0, food: 0.22 };
}

export function xpPerSecond(job: Job) {
  if (job === "farmer") return 1.15;
  if (job === "lumber") return 1.05;
  if (job === "smith") return 1.0;
  return 1.25;
}

export function visionFromXp(xp: number) {
  return Math.min(8, xp / 14);
}

export function dist(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function toward(from: Vec2, to: Vec2, speed: number, dt: number): Vec2 {
  const d = dist(from, to);
  if (d < 0.4) return { ...to };
  const step = Math.min(d, speed * dt);
  return { x: from.x + ((to.x - from.x) / d) * step, y: from.y + ((to.y - from.y) / d) * step };
}

export function nextWaypoint(u: Unit) {
  const loop = u.homeLoop;
  if (!loop || loop.length === 0) return;
  u.loopIndex = ((u.loopIndex ?? 0) + 1) % loop.length;
}

export function waypointOf(u: Unit): Vec2 | null {
  const loop = u.homeLoop;
  if (!loop || loop.length === 0) return null;
  return loop[u.loopIndex ?? 0] ?? loop[0];
}

export function pickJob(id: number, preferred?: Job): Job {
  if (preferred) return preferred;
  return JOBS[Math.floor(hashId(id) * JOBS.length)]!;
}

export function applyPromotion(u: Unit) {
  if (!u.job || u.lifeStage !== "gatherer") return false;
  if (u.xp < promoteThreshold(u.id)) return false;
  const kind = JOB_PROMOTE[u.job];
  const def = UNIT_DEFS[kind];
  u.kind = kind;
  u.lifeStage = "warrior";
  const scale = 1 + Math.min(0.35, u.xp / 400);
  u.hp = def.hp * scale;
  u.maxHp = u.hp;
  u.speed = def.speed;
  u.damage = def.damage * scale;
  u.bounty = def.bounty;
  u.attackCooldown = def.cooldown;
  u.towerResist = def.towerResist;
  u.keepMult = def.keepMult;
  u.siegeGap = def.siegeGap;
  u.chargeReady = kind === "runner";
  return true;
}

export function payTax(state: GameState, team: Team, gold: number, wood: number, food: number) {
  const cutG = gold * KING_TAX;
  const cutW = wood * KING_TAX;
  const cutF = food * KING_TAX;
  state.gold[team] += gold - cutG;
  state.wood[team] += wood - cutW;
  state.food[team] += food - cutF;
  state.kingTreasury[team] += cutG + cutW * 0.6 + cutF * 0.4;
  state.stats[team].goldEarned += gold;
}

export function grantMotionYield(state: GameState, u: Unit, dt: number, moving: boolean) {
  if (!moving || !u.job) return;
  const gathering = u.lifeStage === "gatherer" || state.kingOrder[u.team] === "gather";
  if (!gathering) return;
  const y = gatherYield(u.job);
  payTax(state, u.team, y.gold * dt, y.wood * dt, y.food * dt);
  u.xp += xpPerSecond(u.job) * dt;
  if (u.job === "lumber") state.scars.trees += dt * 0.08;
  if (u.job === "farmer") state.scars.fields += dt * 0.06;
  if (u.job === "smith") state.scars.pit += dt * 0.05;
  if (u.job === "hunter") state.scars.trails += dt * 0.04;
}

export function refreshKings(state: GameState) {
  for (const team of ["you", "foe"] as Team[]) {
    const clan = state.units.filter((u) => u.team === team && u.hp > 0);
    if (clan.length === 0) {
      state.kingId[team] = null;
      continue;
    }
    let best = clan[0]!;
    for (const u of clan) {
      if (u.xp > best.xp) best = u;
    }
    const cur = clan.find((u) => u.id === state.kingId[team]);
    if (cur && cur.xp + KING_STICKY >= best.xp) best = cur;
    for (const u of clan) {
      if (u.lifeStage === "king") u.lifeStage = u.kind === "levy" ? "gatherer" : "warrior";
    }
    best.lifeStage = "king";
    state.kingId[team] = best.id;
  }
}

export function orderTarget(state: GameState, u: Unit): Vec2 | null {
  const order = state.kingOrder[u.team];
  if (order === "gather" || u.lifeStage === "gatherer") return waypointOf(u);
  const chokes = chokePoints();
  if (order === "hold") {
    const i = u.id % chokes.length;
    return chokes[i] ?? chokes[1]!;
  }
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

export function countClan(state: GameState, team: Team) {
  return state.units.filter((u) => u.team === team && u.hp > 0).length;
}
