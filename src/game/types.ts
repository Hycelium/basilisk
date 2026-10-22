export type Team = "you" | "foe";
export type WaveUnitKind = "raider" | "soldier" | "brute" | "runner" | "ward";
export type TrainKind = "levy" | "runner" | "archer" | "ward" | "rammer" | "trebuchet" | "spy";
export type SiegePhase = "packed" | "unpacking" | "ready" | "packing";
export type UnitKind = WaveUnitKind | TrainKind;
export type Job = "farmer" | "hunter" | "smith" | "lumber";
export type LifeStage = "gatherer" | "warrior" | "king";
export type KingOrder = "gather" | "hold" | "hunt";
export type KingController = "ai" | "player";
export type WorkKind = "farm" | "hunt" | "gold" | "wood";
export type Coffer = { gold: number; wood: number; food: number };
export type TripCounts = { farm: number; hunt: number; gold: number; wood: number };
export type BuildingKind = "watchtower" | "ballista" | "catapult" | "barracks" | "house" | "barricade";
export type ResourceKind = "pine" | "copper";
export type PadZone = "combat" | "eco";
export type GamePhase = "title" | "running" | "ended";
/** Procedural map id, e.g. `seed-1842291`. Infinite campaign maps. */
export type MapId = string;
/** Road index, west to east. A map has 1–3 roads. */
export type Lane = 0 | 1 | 2;
export type LaneCount = 1 | 2 | 3;

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
  lane: Lane;
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
  /** Runner only. The next melee hit is a charge until it connects; leaving contact arms it again. */
  chargeReady?: boolean;
  ignoreEnemyCreeps: boolean;
  rallyPoint?: Vec2;
  /** Spot where auto-engage broke off. The unit returns here before chasing again. */
  engageFrom?: Vec2;
  aiHeldForRush?: boolean;
  aiStagingPoint?: Vec2;
  /** Trebuchet only. Packed to roll; unpacked and ready to throw. */
  siegePhase?: SiegePhase;
  siegeTimer?: number;
  job?: Job;
  lifeStage?: LifeStage;
  xp: number;
  homeLoop?: Vec2[];
  loopIndex?: number;
  workKind?: WorkKind;
  carryKind?: WorkKind | null;
  carry?: number;
  trips?: TripCounts;
  kills?: number;
  deposited?: number;
  lastHitBy?: number;
  /** Starting steward king. Not possessable. */
  npcKing?: boolean;
}

/** First-person body the local player is driving, or none. */
export interface PossessedUi {
  id: number;
  kind: UnitKind;
  label: string;
  hp: number;
  maxHp: number;
  /** Kills and keep/barricade hits while driving soldiers this match. */
  visionScore: number;
  visionMax: number;
  /** Trebuchet possess: 0–1 wind on the arm. */
  charge: number;
  /** Building or barricade currently in the trebuchet sights. */
  aimLabel: string;
  job: Job | null;
  xp: number;
  lifeStage: LifeStage | null;
  isKing: boolean;
}

export interface BasiliskUi {
  food: number;
  clanGold: number;
  clanWood: number;
  cofferGold: number;
  cofferWood: number;
  cofferFood: number;
  kingOrder: KingOrder;
  youAreKing: boolean;
  joinTimer: number;
  joinReady: boolean;
  clanmates: number;
  carry: number;
  carryKind: WorkKind | null;
  trips: TripCounts;
  kills: number;
  rankLabel: string;
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
  hp: number;
  maxHp: number;
  queue: TrainJob[];
  rallyPoint?: Vec2;
  /** Spy sabotage. Gun stays silent while this is above zero. */
  disableTimer?: number;
}

export interface Pad {
  id: string;
  team: Team;
  pos: Vec2;
  /** Roads a tower on this pad can reach. Eco pads cover none. */
  laneCoverage: Lane[];
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
  lane: Lane;
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
  /** Melee damage. AI peons carry the current wave scalar; humans stay at baseline. */
  damage: number;
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
  | "waveHorn"
  | "trebuchet"
  | "sabotage";

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
  lane: Lane;
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
  lanes: LaneCount;
  pads: { id: string; x: number; y: number; laneCoverage: Lane[]; zone?: PadZone }[];
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
  }[];
  startTowerPad: string;
}

export interface GameState {
  phase: GamePhase;
  mapId: MapId;
  time: number;
  paused: boolean;
  speed: 1 | 2;
  soundOn: boolean;
  audioUnlocked: boolean;
  keeps: Record<Team, Keep>;
  gold: Record<Team, number>;
  wood: Record<Team, number>;
  food: Record<Team, number>;
  basilisk: boolean;
  playerJob: Job | null;
  playerUnitId: number | null;
  joinTimer: number;
  joinReady: boolean;
  trickleTimer: number;
  kingId: Record<Team, number | null>;
  kingController: Record<Team, KingController>;
  kingOrder: Record<Team, KingOrder>;
  kingTreasury: Record<Team, number>;
  kingCoffer: Record<Team, Coffer>;
  scars: { trees: number; fields: number; pit: number; trails: number };
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
  stats: Record<Team, TeamStats>;
  pulseNodeUntil: number;
  firstVillagerAssigned: boolean;
  endReason: string;
  redFlash: number;
  shake: number;
  keepLevel: number;
  matchXpEarned: number;
  lastXpGain: number;
  won: boolean | null;
  /** Which side this client's build highlights belong to. Not sent in match snapshots. */
  commandTeam: Team;
  /** Living barracks-trained soldier the local player is driving in first person. */
  possessedId: number | null;
  /** Kills and keep/barricade hits scored while possessed this match. Unlocks FPS zoom-out. */
  possessVisionScore: number;
  /** Trebuchet possess wind (0–1). Unused for other bodies. */
  possessCharge: number;
  possessAimBuildingId: number | null;
  possessAimBarricadeId: number | null;
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
  /** Peons standing idle or walking home with no job. */
  idlePeonCount: number;
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
  /** Persistent Q-learning foe — climbs as it plays you. */
  foeIntellect: number;
  foeGames: number;
  foeWins: number;
  foeExplore: number;
  foeLastAction: string;
  /** Side this screen commands. Guest is `foe` while the map stays north-up. */
  localTeam: Team;
  pvp: boolean;
  /** Set while a Ten Marches mission is the live match. */
  missionId: number | null;
  missionName: string;
  /** Unit name just won from this mission, or empty. Onslaughts hold the ground without a new unit. */
  freshUnlock: string;
  /** This victory was the first time the march was held. */
  freshHold: boolean;
  /** Set while the local player is in first person on a soldier. */
  possessed: PossessedUi | null;
  basilisk: BasiliskUi | null;
}

export interface RectHit {
  kind: "keep" | "pad" | "building" | "node" | "unit" | "villager";
  id: string;
}
