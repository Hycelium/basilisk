import type { BuildingKind, LaneCount, Team, TrainKind, UnitKind, WaveSpec } from "./types";

export const WORLD_W = 400;
/** Tall field so the mid strip between keeps is a real no-man's-land. */
export const WORLD_H = 1800;
/** Keeps sit this far in from each end of the field. */
export const KEEP_MARGIN = 56;
export const ROAD_Y_MIN = 100;
export const ROAD_Y_MAX = WORLD_H - 100;
export const ROAD_X = [112, 288] as const;
export const LANE_OFFSET = { you: -13, foe: 13 } as const;

export const START_GOLD = 100;
export const START_WOOD = 80;

/** Opening purse for a 2-road map. One road is half, three roads are 1.5×, both sides alike. */
export function openingStash(lanes: LaneCount) {
  return {
    gold: Math.round((START_GOLD * lanes) / 2),
    wood: Math.round((START_WOOD * lanes) / 2),
  };
}
/** Bloons-style life pool: chips, not melts. ~10–15 min matches. */
export const START_KEEP_HP = 280;

export const WOOD_GATHER_TIME = 1.2;
export const COPPER_GATHER_TIME = 2.1;
export const VILLAGER_SPEED = 44;
export const VILLAGER_HP = 28;
export const PEON_TRAIN_TIME = 4.5;
export const PEON_TRAIN_GOLD = 18;
export const PEON_TRAIN_WOOD = 0;
export const PEON_TRAIN_FOOD = 25;
/** Base peon pop (keep alone). Each house adds HOUSE_POP. */
export const BASE_PEON_CAP = 2;
export const HOUSE_POP = 2;
export const MAX_PEON_QUEUE = 4;

export const PINE_REGEN = 2.8;
export const COPPER_REGEN = 4.2;

export interface ResCost {
  gold: number;
  wood: number;
  food?: number;
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
  ballista: 178,
  catapult: 150,
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
export const YOU_SIEGE_Y = WORLD_H - KEEP_MARGIN - 104;
export const FOE_SIEGE_Y = KEEP_MARGIN + 104;
/** Soft fallow used for starter-tower “cover anyone at the gate” checks. */
export const KEEP_THREAT_RADIUS = 140;
export const PEON_MELEE_RANGE = 18;
export const PEON_DAMAGE = 6;
export const PEON_ATTACK_CD = 0.5;
/** Soldiers, waves, and the king cut workers down in a couple of swings. */
export const MILITARY_VS_PEON = 2.5;
/** A peon's stick barely chips a trained body. */
export const PEON_VS_MILITARY = 0.2;
export const PEON_FIGHT_SPEED = 54;
/** Patrol and guard notice a fight a short walk past melee, then leash back. */
export const PEON_AGGRO_RANGE = 40;
/** Melee soldiers notice enemies a short step beyond contact range. */
export const MELEE_AGGRO_RANGE = 42;
/** Chase limit as a multiple of aggro, then the unit resumes its order. */
export const AGGRO_LEASH_MULT = 1.75;

/**
 * First-person possess (vs-AI only). The player drops the map view, so the
 * body hits harder and runs faster than the same soldier on rails.
 */
export const POSSESS_DAMAGE_MULT = 2.4;
export const POSSESS_SPEED_MULT = 1.55;
export const POSSESS_MELEE_REACH = 26;
/** Possessed kills/keep hits needed to unlock the furthest over-shoulder pull. */
export const POSSESS_VISION_SCORE = 8;
/** World units the FPS camera can sit behind the eyes at full vision. */
export const POSSESS_PULL_MAX = 56;
export const POSSESS_FOV_TIGHT = 70;
export const POSSESS_FOV_WIDE = 86;
/** Trebuchet possess sits above the engine instead of in the head. */
export const TREB_POSSESS_BACK = 96;
export const TREB_POSSESS_HEIGHT = 62;
export const TREB_POSSESS_AHEAD = 118;
export const TREB_POSSESS_FOV = 52;
/** Clicks wind the arm. Four pumps loose a shot. Charge bleeds if you wait. */
export const TREB_CHARGE_CLICK = 0.27;
export const TREB_CHARGE_DECAY = 0.16;

/**
 * Levy melee versus a ward only. 1.25 is +25% of that levy's current attack.
 * Levy hits on every other target stay at the levy's normal damage.
 */
export const LEVY_VS_WARD_DAMAGE = 1.25;

/**
 * A runner's first melee strike after closing in from outside contact.
 * Later strikes in that same fight use normal damage and the normal cooldown.
 * Leaving melee range arms the charge again. Move speed is unchanged.
 */
export const RUNNER_CHARGE_DAMAGE = 2;

/**
 * Watchtower arrows fall off once a unit is chewing the keep.
 * Catapult rocks do not: the gate is where troops bunch up.
 * Arrows never target peons. Bolts and rocks can, and only when no soldier is in range.
 */
export const ARCHER_VS_SIEGE = 0.38;
/** Trained archers barely scratch a shield. Levies and ballista bolts are the ward answers. */
export const ARCHER_VS_WARD = 0.4;
/**
 * Share of tower armor a ballista bolt still respects.
 * Arrows and catapult rocks keep the full resist, so a ward walks through them.
 */
export const BALLISTA_ARMOR_KEPT = 0.15;
/** Catapult peon hits are a splash punishment, not a snipe. Bolts do full damage. */
export const CATAPULT_VS_PEON = 0.65;
/** Rocks ignore trebuchet timber and hit harder. Only matters if the engine is inside catapult range. */
export const CATAPULT_VS_TREBUCHET = 1.65;
export const CATAPULT_VS_BARRICADE = 12;
/** Soldier arrows glance off the frame. */
export const ARCHER_VS_TREBUCHET = 0.28;
/** Crew and frame die to a charge. The engine cannot fight back. */
export const MELEE_VS_TREBUCHET = 1.55;
export const BARRICADE_HP = 36;

/** Hit points so a trebuchet wrecks a structure in four shots. Houses are listed but not legal targets. */
export const BUILD_HP: Record<BuildingKind, number> = {
  watchtower: 40,
  ballista: 48,
  catapult: 44,
  barracks: 52,
  house: 36,
  barricade: BARRICADE_HP,
};

/** Beats every player-built tower (ballista 178 is the longest). The starter watchtower's 220 still reaches it. */
export const TREBUCHET_RANGE = 190;
export const TREBUCHET_UNPACK = 2.55;
export const TREBUCHET_PACK = 1.55;
/** Shots needed to knock down a full-HP legal building (or barricade / rival engine). */
export const TREBUCHET_SHOTS_TO_KILL = 4;

export function trebuchetShot(maxHp: number) {
  return Math.max(1, Math.ceil(maxHp / TREBUCHET_SHOTS_TO_KILL));
}

/** Towers and halls only. Keeps and houses are off-limits. */
export function isTrebuchetBuilding(kind: BuildingKind) {
  return kind === "watchtower" || kind === "ballista" || kind === "catapult" || kind === "barracks";
}

export const SPY_DISABLE = 10;
export const SPY_SABOTAGE_RANGE = 22;
export const SPY_KEEP_RANGE = 30;
export const SPY_KEEP_MIN = 50;
export const SPY_KEEP_MAX = 75;

export function isSpyGun(kind: BuildingKind) {
  return kind === "watchtower" || kind === "ballista" || kind === "catapult";
}

/** Ballista rate ranks are guard dogs, not fire speed. Rank 1+ kills spies in a pad-wide radius. */
export function ballistaHasDogs(b: { kind: BuildingKind; rateRank: number }) {
  return b.kind === "ballista" && b.rateRank >= 1;
}

export const DOG_RANGE = 46;
export const DOG_RANGE_RANK2 = 58;

export function dogRange(b: { kind: BuildingKind; rateRank: number }) {
  if (!ballistaHasDogs(b)) return 0;
  return b.rateRank >= 2 ? DOG_RANGE_RANK2 : DOG_RANGE;
}

export function spyKeepDamage() {
  return SPY_KEEP_MIN + Math.floor(Math.random() * (SPY_KEEP_MAX - SPY_KEEP_MIN + 1));
}

export function disguiseTeam(team: Team): Team {
  return team === "you" ? "foe" : "you";
}

/** Watchtowers clear light troops. Ballistae punch armor. Catapults punish clumps and road blocks. */
export const BUILD_DAMAGE: Record<BuildingKind, number> = {
  watchtower: 6,
  ballista: 22,
  catapult: 13,
  barracks: 0,
  house: 0,
  barricade: 0,
};

export const BUILD_COOLDOWN: Record<BuildingKind, number> = {
  watchtower: 0.58,
  ballista: 1.7,
  catapult: 1.75,
  barracks: 1,
  house: 1,
  barricade: 1,
};

export const CATAPULT_SPLASH_RADIUS = 46;

/** How much of a unit's tower armor this building ignores. */
export function towerDamageFactor(kind: BuildingKind, towerResist: number, unitKind?: UnitKind) {
  if (unitKind === "trebuchet") {
    if (kind === "catapult") return CATAPULT_VS_TREBUCHET;
    return 1 - towerResist;
  }
  const kept = kind === "ballista" ? towerResist * BALLISTA_ARMOR_KEPT : towerResist;
  return 1 - kept;
}

/** Melee chip against a barricade. Rams destroy one outright; archers walk around. */
export function barricadeStrike(kind: UnitKind) {
  if (kind === "brute") return 6;
  if (kind === "soldier" || kind === "runner") return 3;
  return 2;
}
export const MAX_TRAIN_QUEUE = 8;

export const DAMAGE_MULT = [1, 1.28, 1.58];
export const RATE_MULT = [1, 0.82, 0.65];
export const UPGRADE_COST = [50, 85];

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
  foodCost?: number;
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
    cost: 45, woodCost: 0, foodCost: 0, trainTime: 3.8,
    label: "Levy", blurb: "Cheap line · bonus vs wards",
  },
  runner: {
    hp: 42, speed: 54, damage: 6, cooldown: 0.5, bounty: 13,
    towerResist: 0.72, keepMult: 0.7, siegeGap: 0.3,
    cost: 50, woodCost: 20, foodCost: 0, trainTime: 3.2,
    label: "Runner", blurb: "Charge · shrugs arrows, fears bolts",
  },
  archer: {
    hp: 44, speed: 29, damage: 7, cooldown: 1.05, bounty: 14,
    towerResist: 0.04, keepMult: 0.42, siegeGap: 0.5,
    cost: 40, woodCost: 40, foodCost: 0, trainTime: 4.4,
    label: "Archer", blurb: "Ranged · walks around barricades, weak vs wards",
  },
  ward: {
    hp: 150, speed: 22, damage: 5, cooldown: 0.75, bounty: 15,
    towerResist: 0.88, keepMult: 0.55, siegeGap: 0.4,
    cost: 75, woodCost: 15, foodCost: 0, trainTime: 5.2,
    label: "Ward", blurb: "Shield · shrugs arrows, fears bolts and levies",
  },
  rammer: {
    hp: 95, speed: 27, damage: 7, cooldown: 0.8, bounty: 18,
    towerResist: 0.3, keepMult: 2.4, siegeGap: 0.15,
    cost: 75, woodCost: 100, trainTime: 5.8,
    label: "Rammer", blurb: "Breaks gates and barricades",
  },
  trebuchet: {
    hp: 42, speed: 6.75, damage: 0, cooldown: 5.8, bounty: 16,
    towerResist: 0.88, keepMult: 0, siegeGap: 1.2,
    cost: 150, woodCost: 200, trainTime: 9.6,
    label: "Trebuchet", blurb: "Costly timber · crawls · four shots wreck a tower",
  },
  spy: {
    hp: 28, speed: 46, damage: 0, cooldown: 1.6, bounty: 18,
    towerResist: 0.04, keepMult: 0, siegeGap: 5.5,
    cost: 150, woodCost: 0, trainTime: 5.0,
    label: "Spy", blurb: "Hunts trebuchets first · can wreck several · dies silencing a tower",
  },
};

export const UNIT_STATS = UNIT_DEFS;
export const TRAIN_ORDER: TrainKind[] = ["levy", "runner", "archer", "ward", "rammer", "trebuchet", "spy"];

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

/**
 * AI combat multiplier for the shared attack-wave counter.
 * Wave 1 is 1×. Each later wave adds the same step. Wave 16 is 2×.
 * Before wave 1 (counter 0) this is 1×. After wave 16 it stays at 2×.
 */
export function aiWaveStrength(wave: number): number {
  const step = Math.min(16, Math.max(1, wave));
  return 1 + (step - 1) / 15;
}

/** Humans stay at 1. Every AI team uses `aiWaveStrength`. */
export function combatWaveScale(team: Team, wave: number): number {
  return team === "you" ? 1 : aiWaveStrength(wave);
}

export function formatCost(c: ResCost) {
  const parts: string[] = [];
  if (c.gold > 0) parts.push(`${c.gold}g`);
  if (c.wood > 0) parts.push(`${c.wood}w`);
  if ((c.food ?? 0) > 0) parts.push(`${c.food}f`);
  return parts.join(" · ") || "0";
}

export function trainResCost(kind: UnitKind): ResCost {
  const def = UNIT_DEFS[kind];
  return { gold: def.cost ?? 0, wood: def.woodCost ?? 0, food: def.foodCost ?? 0 };
}

export function peonResCost(basilisk: boolean): ResCost {
  return basilisk
    ? { gold: 0, wood: 0, food: PEON_TRAIN_FOOD }
    : { gold: PEON_TRAIN_GOLD, wood: PEON_TRAIN_WOOD, food: 0 };
}
