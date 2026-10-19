export type Team = "you" | "foe" | "east";
/**
 * Seat control for the skirmish roster. A later lobby reuses the same list:
 * Local (this machine), AI, and Open (a human who joins with a room code).
 * Open is not selectable until a realtime host exists.
 */
export type SeatControl = "local" | "ai" | "open";
export type MapSize = "small" | "large";
/** AoE2 stance for one unordered pair of seats. */
export type Stance = "ally" | "neutral" | "enemy";
/**
 * Keys are `diplomacyKey(a, b)`: "you|foe", "you|east", "foe|east".
 * Missing keys are Neutral. Every pair starts Neutral.
 */
export type Diplomacy = Record<string, Stance>;
export interface SkirmishSetup {
  mapSize: MapSize;
  players: 2 | 3;
  diplomacy: Diplomacy;
}

const TEAM_ORDER: Team[] = ["you", "foe", "east"];

export function diplomacyKey(a: Team, b: Team) {
  const [x, y] = TEAM_ORDER.indexOf(a) < TEAM_ORDER.indexOf(b) ? [a, b] : [b, a];
  return `${x}|${y}`;
}

export function diplomacyPairs(players: 2 | 3): [Team, Team][] {
  const pairs: [Team, Team][] = [["you", "foe"]];
  if (players === 3) pairs.push(["you", "east"], ["foe", "east"]);
  return pairs;
}

export function defaultDiplomacy(players: 2 | 3): Diplomacy {
  const out: Diplomacy = {};
  for (const [a, b] of diplomacyPairs(players)) out[diplomacyKey(a, b)] = "neutral";
  return out;
}

export function normalizeDiplomacy(raw: unknown, players: 2 | 3): Diplomacy {
  const base = defaultDiplomacy(players);
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(base)) {
    const value = src[key];
    if (value === "ally" || value === "neutral" || value === "enemy") base[key] = value;
  }
  return base;
}

/** you and foe always exist. east is only present in a 3-player skirmish. */
export type TeamBag<T> = { you: T; foe: T; east?: T };
export type WaveUnitKind = "raider" | "soldier" | "brute" | "runner" | "ward";
export type TrainKind = "levy" | "runner" | "archer" | "ward" | "rammer";
export type UnitKind = WaveUnitKind | TrainKind;
export type BuildingKind = "watchtower" | "ballista" | "catapult" | "barracks" | "house" | "barricade";
export type ResourceKind = "pine" | "copper";
export type PadZone = "combat" | "eco";
export type GamePhase = "title" | "running" | "ended";
/** Procedural map id, e.g. `seed-1842291`. Infinite campaign maps. */
export type MapId = string;

export interface Vec2 {
  x: number;
  y: number;
}

export interface PeonJob {
  timeLeft: number;
  totalTime: number;
}

export interface Keep {
  team: Team;
  pos: Vec2;
  hp: number;
  maxHp: number;
  hitFlash: number;
  attackTimer: number;
  attackFlash: number;
  attackTarget?: Vec2;
  peonQueue: PeonJob[];
}

export interface Unit {
  id: number;
  team: Team;
  kind: UnitKind;
  lane: 0 | 1;
  pos: Vec2;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  bounty: number;
  attackCooldown: number;
  attackTimer: number;
  towerResist: number;
  keepMult: number;
  siegeGap: number;
  targetUnitId?: number;
  targetKeep: boolean;
  fromBarracks: boolean;
  ignoreEnemyCreeps: boolean;
  rallyPoint?: Vec2;
  /** Spot where auto-engage broke off. The unit returns here before chasing again. */
  engageFrom?: Vec2;
  aiHeldForRush?: boolean;
  aiStagingPoint?: Vec2;
  /** 3-player march: the enemy keep this unit is sent toward. */
  goalTeam?: Team;
}

export type WavePhase = "build" | "spawning" | "fighting";

export interface TrainJob {
  kind: TrainKind;
  timeLeft: number;
  totalTime: number;
}

export interface Building {
  id: number;
  team: Team;
  kind: BuildingKind;
  padId: string;
  pos: Vec2;
  spent: number;
  spentWood: number;
  canRefund: boolean;
  damageRank: 0 | 1 | 2;
  rateRank: 0 | 1 | 2;
  attackTimer: number;
  trainTimer: number;
  animKick: number;
  queue: TrainJob[];
  rallyPoint?: Vec2;
}

export interface Pad {
  id: string;
  team: Team;
  pos: Vec2;
  laneCoverage: 0 | 1 | 2;
  zone: PadZone;
}

export interface ResourceNode {
  id: string;
  team: Team;
  kind: ResourceKind;
  pos: Vec2;
  loadsLeft: number;
  maxLoads: number;
  maxWorkers: number;
  workers: number;
  gatherTime: number;
  goldPerLoad: number;
  woodPerLoad: number;
  regenEvery: number;
  regenAcc: number;
}

export interface Barricade {
  id: number;
  team: Team;
  lane: 0 | 1;
  pos: Vec2;
  hp: number;
  maxHp: number;
  buildProgress: number;
  buildTime: number;
  built: boolean;
  builderId?: number;
}

export interface Villager {
  id: number;
  team: Team;
  pos: Vec2;
  speed: number;
  hp: number;
  maxHp: number;
  state: "idle" | "toNode" | "gathering" | "toKeep" | "home" | "defend" | "toGarrison" | "garrisoned" | "toBarricade" | "buildingBarricade" | "moving" | "patrolling";
  targetNodeId?: string;
  targetEnemyId?: number;
  targetBarricadeId?: number;
  moveTarget?: Vec2;
  patrolA?: Vec2;
  patrolB?: Vec2;
  patrolToB?: boolean;
  /** Leash origin while a patrol fight pulls the peon off the route. */
  engageFrom?: Vec2;
  forcedAttack?: boolean;
  timer: number;
  carryingGold: number;
  carryingWood: number;
  attackTimer: number;
}

export interface FloatingText {
  id: number;
  pos: Vec2;
  text: string;
  color: string;
  life: number;
  rise: number;
}

export type CombatEventKind =
  | "arrow"
  | "meleeHit"
  | "unitDeath"
  | "keepImpact"
  | "ramImpact"
  | "woodHit"
  | "woodBreak"
  | "buildComplete"
  | "waveHorn";

export interface CombatEvent {
  id: number;
  kind: CombatEventKind;
  pos: Vec2;
  target?: Vec2;
  team?: Team;
  life: number;
}

export interface CommandMarker {
  id: number;
  kind: "move" | "gather" | "attack" | "patrol" | "rally";
  pos: Vec2;
  life: number;
}

export interface ToastItem {
  id: number;
  text: string;
  life: number;
}

export interface WaveQueueItem {
  team: Team;
  kind: UnitKind;
  lane: 0 | 1;
}

export interface WaveSpec {
  raider: number;
  soldier: number;
  brute: number;
  runner: number;
  ward: number;
}

export interface TeamStats {
  slain: number;
  goldEarned: number;
}

export interface MapDef {
  id: MapId;
  seed: number;
  name: string;
  tagline: string;
  pads: { id: string; x: number; y: number; laneCoverage: 0 | 1 | 2; zone?: PadZone; team?: Team }[];
  nodes: {
    id: string;
    kind: ResourceKind;
    x: number;
    yourY: number;
    loads: number;
    gold: number;
    wood: number;
    gather: number;
    regen: number;
    team?: Team;
  }[];
  startTowerPad: string;
  /** Duel is the classic north/south map. Hub roads meet at the stronghold. */
  layout?: "duel" | "triangle" | "hub";
  worldW?: number;
  worldH?: number;
  keeps?: { team: Team; x: number; y: number }[];
  /** `b: "hold"` is the road from a keep gate to the central stronghold. */
  roads?: { a: Team; b: Team | "hold"; points: { x: number; y: number }[] }[];
  stronghold?: { x: number; y: number };
}

export interface Stronghold {
  pos: Vec2;
  hp: number;
  maxHp: number;
  /** Null while the hill is unclaimed. */
  owner: Team | null;
  /** Team currently filling the capture channel. */
  channelTeam: Team | null;
  /** Seconds of uncontested presence. Pauses while two sides stand in the radius. */
  channel: number;
  /** Seconds the current owner has held it. Resets when ownership changes. */
  hold: number;
  contested: boolean;
  hitFlash: number;
}

export interface GameState {
  phase: GamePhase;
  mapId: MapId;
  time: number;
  paused: boolean;
  speed: 1 | 2;
  soundOn: boolean;
  audioUnlocked: boolean;
  keeps: TeamBag<Keep>;
  gold: TeamBag<number>;
  wood: TeamBag<number>;
  /** 2 = the classic duel. 3 = free-for-all on the large map. */
  players: 2 | 3;
  /** Stance for each seat pair. Default Neutral so two AIs do not both open on the human. */
  diplomacy: Diplomacy;
  /** Central hill. Present on hub maps; unused on the title duel. */
  stronghold: Stronghold;
  /** Keep the holder is raiding. Null unless a raid is committed. */
  raidTarget: Team | null;
  /** Team that ordered the current raid. Only the stronghold owner may set this. */
  raidOwner: Team | null;
  /** Keep the human clicked. Attack commits a raid only while they hold the stronghold. */
  pendingAttack: Team | null;
  /** @deprecated Kept so older call sites compile. Raids use raidTarget. */
  attackTarget: Team;
  eliminated: Team[];
  worldW: number;
  worldH: number;
  units: Unit[];
  buildings: Building[];
  villagers: Villager[];
  barricades: Barricade[];
  pads: Pad[];
  nodes: ResourceNode[];
  waveIndex: number;
  wavePhase: WavePhase;
  buildTimer: number;
  waveSpawnTimer: number;
  waveSpawnSide: Team;
  pendingWaveUnits: WaveQueueItem[];
  allWavesLaunched: boolean;
  wavesCleared: number;
  /** Committed AI attack waves this match. One counter per team. Not saved. */
  aiAttackWaves: TeamBag<number>;
  buildSelection: BuildingKind | null;
  selectedBuildingId: number | null;
  selectedVillagerIds: number[];
  /** When set, DetailSheet shows peon training at the keep. */
  selectedKeepTeam: Team | null;
  hoveredPadId: string | null;
  toasts: ToastItem[];
  floatingTexts: FloatingText[];
  combatEvents: CombatEvent[];
  commandMarkers: CommandMarker[];
  stats: TeamBag<TeamStats>;
  pulseNodeUntil: number;
  firstVillagerAssigned: boolean;
  endReason: string;
  redFlash: number;
  shake: number;
  keepLevel: number;
  matchXpEarned: number;
  lastXpGain: number;
  won: boolean | null;
}

export interface QueueSlotUi {
  kind: TrainKind;
  label: string;
  pct: number;
}

export interface TrainOptionUi {
  kind: TrainKind;
  label: string;
  blurb: string;
  cost: number;
  woodCost: number;
  unlocked: boolean;
  lockHint: string;
}

export interface UiSnapshot {
  phase: GamePhase;
  mapId: MapId;
  mapName: string;
  mapTagline: string;
  mapSeed: number;
  campaignLevel: number;
  scoutSalt: number;
  paused: boolean;
  speed: 1 | 2;
  soundOn: boolean;
  yourHp: number;
  foeHp: number;
  yourMaxHp: number;
  yourGold: number;
  yourWood: number;
  foeGold: number;
  foeWood: number;
  waveLabel: string;
  wavePhase: WavePhase;
  buildTimer: number;
  canRush: boolean;
  totalWaves: number;
  toasts: string[];
  buildSelection: BuildingKind | null;
  selectedBuildingId: number | null;
  selectedBuildingTeam: Team | null;
  selectedBuildingKind: BuildingKind | null;
  selectedKeepTeam: Team | null;
  selectedPeonCount: number;
  selectedRanks: { damage: number; rate: number } | null;
  selectedCanUpgradeDamage: boolean;
  selectedCanUpgradeRate: boolean;
  selectedCanRaze: boolean;
  selectedRazeRefund: number;
  selectedRazeRefundWood: number;
  selectedTrainPct: number | null;
  selectedUpgradeCost: { damage: number; rate: number };
  trainQueue: QueueSlotUi[];
  trainOptions: TrainOptionUi[];
  peonQueue: QueueSlotUi[];
  peonCount: number;
  peonCap: number;
  keepGarrisoned: number;
  keepGarrisonMax: number;
  canTrainPeon: boolean;
  peonTrainCost: { gold: number; wood: number };
  buildCosts: Record<BuildingKind, { gold: number; wood: number }>;
  keepLevel: number;
  keepXp: number;
  keepXpNext: number;
  keepXpPct: number;
  endReason: string;
  lastXpGain: number;
  stats: {
    slain: number;
    goldEarned: number;
    waves: number;
    yourKeep: number;
    foeKeep: number;
  };
  /** Persistent Q-learning foe — climbs as it plays you. No level ceiling. */
  foeIntellect: number;
  /** 0–1 progress toward the next intellect level. */
  foeIntellectPct: number;
  foeGames: number;
  foeWins: number;
  foeExplore: number;
  foeLastAction: string;
  players: 2 | 3;
  attackName: string;
  enemyKeeps: { team: Team; name: string; hp: number; down: boolean }[];
  /** One running-match line, e.g. "Foe wave 4 · honed". */
  foeWaveLine: string;
  /** UI name of whoever holds the hill, or "Unclaimed". */
  strongholdName: string;
  strongholdOwner: Team | null;
  /** Seconds left on the 3-minute hold. Restarts at the cap when ownership changes. */
  strongholdHoldLeft: number;
  strongholdContested: boolean;
  /** 0–1 capture channel while a side is taking the hill. */
  strongholdChannel: number;
  holdsStronghold: boolean;
  /** Set only while a keep raid is committed. */
  raidName: string | null;
  /** Clicked keep that can take an Attack order. Null for allies. */
  attackPrompt: string | null;
  canOrderAttack: boolean;
}

export interface RectHit {
  kind: "keep" | "pad" | "building" | "node" | "unit" | "villager";
  id: string;
}
