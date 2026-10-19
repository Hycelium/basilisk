import type { BuildingKind, TrainKind, UnitKind, WaveSpec } from "./types";

export const WORLD_W = 400;
export const WORLD_H = 720;
export const ROAD_Y_MIN = 100;
export const ROAD_Y_MAX = 620;
export const ROAD_X = [112, 288] as const;
export const LANE_OFFSET = { you: -13, foe: 13 } as const;

export const START_GOLD = 100;
export const START_WOOD = 80;
/** Bloons-style life pool: chips, not melts. ~10–15 min matches. */
export const START_KEEP_HP = 280;
/** Central hill. Soldiers never damage it; peons garrison it. */
export const STRONGHOLD_HP = 420;
/** Peons of any teams. A sixth peon cannot enter until a slot is free. */
export const STRONGHOLD_GARRISON_MAX = 5;
/** How close a peon must walk to the gate before they step inside. */
export const STRONGHOLD_GARRISON_RADIUS = 18;
/** Battle ring. Noticeably wider than the garrison gate. */
export const STRONGHOLD_FIGHT_RADIUS = 120;
/** Soldiers stop here so they melee each other, not the stronghold mesh. */
export const STRONGHOLD_KEEPOUT = 36;
/** Continuous ownership required to win by the hill. */
export const STRONGHOLD_HOLD_SECONDS = 180;

export const WOOD_GATHER_TIME = 1.2;
export const COPPER_GATHER_TIME = 2.1;
export const VILLAGER_SPEED = 44;
export const VILLAGER_HP = 28;
export const PEON_TRAIN_TIME = 4.5;
export const PEON_TRAIN_GOLD = 18;
export const PEON_TRAIN_WOOD = 0;
/** Base peon pop (keep alone). Each house adds HOUSE_POP. */
export const BASE_PEON_CAP = 2;
export const HOUSE_POP = 3;
export const MAX_PEON_QUEUE = 4;

export const PINE_REGEN = 2.8;
export const COPPER_REGEN = 4.2;

export interface ResCost {
  gold: number;
  wood: number;
}

export const BUILD_COST: Record<BuildingKind, ResCost> = {
  watchtower: { gold: 45, wood: 35 },
  ballista: { gold: 95, wood: 55 },
  catapult: { gold: 120, wood: 70 },
  barracks: { gold: 100, wood: 80 },
  house: { gold: 30, wood: 55 },
  barricade: { gold: 8, wood: 30 },
};

export const BUILD_RANGE: Record<BuildingKind, number> = {
  watchtower: 125,
  ballista: 162,
  catapult: 126,
  barracks: 0,
  house: 0,
  barricade: 0,
};

/** Starter tower always reaches both road approaches at the keep (kills the gate dead-zone). */
export const STARTER_GUARD_RANGE = 220;
/**
 * Yard line: any enemy past this Y counts as sieging (both roads).
 * Distance-to-keep alone missed the east gate (~109px vs a tight circle).
 */
export const YOU_SIEGE_Y = 560;
export const FOE_SIEGE_Y = 160;
/** Soft fallow used for starter-tower “cover anyone at the gate” checks. */
export const KEEP_THREAT_RADIUS = 140;
export const PEON_MELEE_RANGE = 18;
export const PEON_DAMAGE = 6;
export const PEON_ATTACK_CD = 0.5;
export const PEON_FIGHT_SPEED = 54;
/** Patrol and guard notice a fight a short walk past melee, then leash back. */
export const PEON_AGGRO_RANGE = 40;
/** Melee soldiers notice enemies a short step beyond contact range. */
export const MELEE_AGGRO_RANGE = 42;
/** Chase limit as a multiple of aggro, then the unit resumes its order. */
export const AGGRO_LEASH_MULT = 1.75;

/**
 * Watchtowers (archers) are weak vs units already on the keep and
 * cannot target peons. Only ballistae/catapults can hit peons.
 */
export const ARCHER_VS_SIEGE = 0.38;

/** Tuned so 2–3 towers clear early waves but not late mixes alone. */
export const BUILD_DAMAGE: Record<BuildingKind, number> = {
  watchtower: 6,
  ballista: 16,
  catapult: 11,
  barracks: 0,
  house: 0,
  barricade: 0,
};

export const BUILD_COOLDOWN: Record<BuildingKind, number> = {
  watchtower: 0.58,
  ballista: 1.45,
  catapult: 1.95,
  barracks: 1,
  house: 1,
  barricade: 1,
};

export const CATAPULT_SPLASH_RADIUS = 36;
export const MAX_TRAIN_QUEUE = 8;

export const DAMAGE_MULT = [1, 1.28, 1.58];
export const RATE_MULT = [1, 0.82, 0.65];
export const UPGRADE_COST = [50, 85];

/**
 * Levy attack at barracks power ranks 0, 1, and 2.
 * Base levy damage is 8. The old upgrade curve was ×1 / ×1.28 / ×1.58
 * (attacks 8, 10.24, 12.64). Only that upgrade bonus is halved, so the
 * attacks are 8, 9.12, and 10.32 (multipliers 1, 1.14, 1.29).
 * Levy hit points, and every other unit, still use DAMAGE_MULT.
 * AI wave buffs multiply this attack; they do not replace it.
 */
export const LEVY_ATTACK_MULT = [1, 1.14, 1.29] as const;

export interface UnitDef {
  hp: number;
  speed: number;
  damage: number;
  cooldown: number;
  bounty: number;
  towerResist: number;
  keepMult: number;
  /** Extra seconds between keep hits (siege is slow by design). */
  siegeGap: number;
  cost?: number;
  woodCost?: number;
  trainTime?: number;
  label: string;
  blurb: string;
}

export const UNIT_DEFS: Record<UnitKind, UnitDef> = {
  raider: {
    hp: 36, speed: 46, damage: 4, cooldown: 0.7, bounty: 8,
    towerResist: 0.08, keepMult: 0.55, siegeGap: 0.55,
    label: "Raider", blurb: "Fast wave levy",
  },
  soldier: {
    hp: 78, speed: 28, damage: 5, cooldown: 0.85, bounty: 13,
    towerResist: 0.05, keepMult: 0.65, siegeGap: 0.45,
    label: "Soldier", blurb: "Wave line",
  },
  brute: {
    hp: 175, speed: 17, damage: 8, cooldown: 1.05, bounty: 24,
    towerResist: 0.12, keepMult: 0.85, siegeGap: 0.35,
    label: "Brute", blurb: "Heavy wave",
  },
  levy: {
    hp: 58, speed: 34, damage: 8, cooldown: 0.65, bounty: 11,
    towerResist: 0.05, keepMult: 0.9, siegeGap: 0.25,
    cost: 26, woodCost: 0, trainTime: 3.8,
    label: "Levy", blurb: "Cheap fighter",
  },
  runner: {
    hp: 42, speed: 54, damage: 6, cooldown: 0.5, bounty: 13,
    towerResist: 0.72, keepMult: 0.7, siegeGap: 0.3,
    cost: 28, woodCost: 22, trainTime: 3.2,
    label: "Runner", blurb: "Near-hard vs towers · needs wood",
  },
  archer: {
    hp: 44, speed: 29, damage: 7, cooldown: 1.05, bounty: 14,
    towerResist: 0.04, keepMult: 0.42, siegeGap: 0.5,
    cost: 34, woodCost: 28, trainTime: 4.4,
    label: "Archer", blurb: "Ranged support · cannot break barricades",
  },
  ward: {
    hp: 150, speed: 22, damage: 5, cooldown: 0.75, bounty: 15,
    towerResist: 0.88, keepMult: 0.55, siegeGap: 0.4,
    cost: 46, woodCost: 10, trainTime: 5.2,
    label: "Ward", blurb: "Near-hard arrow sponge",
  },
  rammer: {
    hp: 95, speed: 27, damage: 7, cooldown: 0.8, bounty: 18,
    towerResist: 0.3, keepMult: 2.4, siegeGap: 0.15,
    cost: 40, woodCost: 45, trainTime: 5.8,
    label: "Rammer", blurb: "Gate breaker · heavy wood",
  },
};

export const UNIT_STATS = UNIT_DEFS;
export const TRAIN_ORDER: TrainKind[] = ["levy", "runner", "archer", "ward", "rammer"];

/**
 * 16 waves, ~10–15 min. Breathing curve (research: pressure → relief → peaked finale).
 * Even counts so each road gets half.
 */
export const WAVES: WaveSpec[] = [
  { raider: 4, soldier: 0, brute: 0, runner: 0, ward: 0 },
  { raider: 6, soldier: 0, brute: 0, runner: 0, ward: 0 },
  { raider: 4, soldier: 2, brute: 0, runner: 0, ward: 0 },
  { raider: 2, soldier: 0, brute: 0, runner: 4, ward: 0 },
  { raider: 0, soldier: 4, brute: 0, runner: 2, ward: 0 },
  { raider: 4, soldier: 2, brute: 0, runner: 0, ward: 2 },
  { raider: 0, soldier: 4, brute: 2, runner: 0, ward: 0 },
  { raider: 6, soldier: 0, brute: 0, runner: 2, ward: 0 },
  { raider: 2, soldier: 2, brute: 2, runner: 2, ward: 0 },
  { raider: 0, soldier: 2, brute: 2, runner: 0, ward: 4 },
  { raider: 2, soldier: 4, brute: 2, runner: 2, ward: 0 },
  { raider: 4, soldier: 2, brute: 0, runner: 4, ward: 2 },
  { raider: 0, soldier: 4, brute: 4, runner: 0, ward: 2 },
  { raider: 2, soldier: 2, brute: 4, runner: 2, ward: 2 },
  { raider: 0, soldier: 4, brute: 6, runner: 2, ward: 4 },
  { raider: 4, soldier: 4, brute: 6, runner: 4, ward: 4 },
];

/** Calm pre-match gather / placement (Bloons-style build phase). */
export const FIRST_BUILD = 20;
/** Build pause after a wave clears. */
export const BUILD_PAUSE = 14;
/** Rushing the next wave grants this gold to both sides. */
export const RUSH_BONUS = 18;
/** Flat income when a wave is launched. */
export const WAVE_START_INCOME = 22;
/** Clear bonus = base + waveIndex * scale */
export const WAVE_CLEAR_BASE = 28;
export const WAVE_CLEAR_SCALE = 6;

export const WAVE_UNIT_GAP = 0.78;
export const AI_RESERVE = 40;

/** @deprecated kept for any old refs */
export const FIRST_WAVE_AT = FIRST_BUILD;
export const BETWEEN_WAVES = BUILD_PAUSE;

export function formatCost(c: ResCost) {
  const parts: string[] = [];
  if (c.gold > 0) parts.push(`${c.gold}g`);
  if (c.wood > 0) parts.push(`${c.wood}w`);
  return parts.join(" · ") || "0";
}

/**
 * Unfair foe curve. Wave 0 (no committed attack yet) is 1×.
 * Each committed AI attack wave steps the tier. Wave 16 is the cap.
 */
export const AI_ATTACK_WAVE_CAP = 16;
/** Gold and wood floor once an AI reaches the cap. Refilled after every spend. */
export const AI_INFINITE_RES = 999_999;

export function aiAttackWaveTier(wave: number) {
  return Math.max(0, Math.min(AI_ATTACK_WAVE_CAP, Math.floor(wave)));
}

/** Soldiers: 2× HP, +90% damage, +25% speed at wave 16. Linear in the tier. */
export function aiSoldierBuff(wave: number) {
  const t = aiAttackWaveTier(wave) / AI_ATTACK_WAVE_CAP;
  return {
    hp: 1 + t,
    damage: 1 + t * 0.9,
    speed: 1 + t * 0.25,
  };
}

/** Peons: 2× HP, +60% gather, +40% work speed, +50% melee at wave 16. */
export function aiPeonBuff(wave: number) {
  const t = aiAttackWaveTier(wave) / AI_ATTACK_WAVE_CAP;
  return {
    hp: 1 + t,
    gather: 1 + t * 0.6,
    work: 1 + t * 0.4,
    melee: 1 + t * 0.5,
  };
}

/**
 * Bonus purse granted when attack wave `wave` commits (waves 1–15).
 * Wave 16+ does not use this; the sim floors gold and wood instead.
 */
export function aiWaveIncome(wave: number) {
  const w = aiAttackWaveTier(wave);
  if (w <= 0 || w >= AI_ATTACK_WAVE_CAP) return { gold: 0, wood: 0 };
  return { gold: 36 * w, wood: 24 * w };
}

export function aiWaveBuffLabel(wave: number) {
  const w = Math.max(0, Math.floor(wave));
  if (w <= 0) return "steady";
  if (w >= AI_ATTACK_WAVE_CAP) return "unbounded";
  if (w >= 12) return "crushing";
  if (w >= 8) return "fierce";
  if (w >= 4) return "honed";
  return "stirring";
}
