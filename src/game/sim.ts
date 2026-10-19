import {
  AI_RESERVE,
  ARCHER_VS_SIEGE,
  BASE_PEON_CAP,
  BUILD_COOLDOWN,
  BUILD_COST,
  BUILD_DAMAGE,
  BUILD_PAUSE,
  BUILD_RANGE,
  CATAPULT_SPLASH_RADIUS,
  DAMAGE_MULT,
  FIRST_BUILD,
  FOE_SIEGE_Y,
  HOUSE_POP,
  KEEP_THREAT_RADIUS,
  MAX_PEON_QUEUE,
  MAX_TRAIN_QUEUE,
  AGGRO_LEASH_MULT,
  MELEE_AGGRO_RANGE,
  PEON_AGGRO_RANGE,
  PEON_ATTACK_CD,
  PEON_DAMAGE,
  PEON_FIGHT_SPEED,
  PEON_MELEE_RANGE,
  PEON_TRAIN_GOLD,
  PEON_TRAIN_TIME,
  PEON_TRAIN_WOOD,
  YOU_SIEGE_Y,
  RATE_MULT,
  RUSH_BONUS,
  START_GOLD,
  START_KEEP_HP,
  START_WOOD,
  STARTER_GUARD_RANGE,
  TRAIN_ORDER,
  UNIT_DEFS,
  UPGRADE_COST,
  VILLAGER_HP,
  VILLAGER_SPEED,
  WAVES,
  WAVE_CLEAR_BASE,
  WAVE_CLEAR_SCALE,
  WAVE_START_INCOME,
  WAVE_UNIT_GAP,
  WORLD_H,
  WORLD_W,
  type ResCost,
} from "./balance";
import {
  buildNodes,
  buildPads,
  generateTriangleMap,
  getOrCreateCampaignMap,
  keepPosFor,
  lanePathX,
  laneStartY,
  laneYGate,
  seedForCampaign,
  startPadId,
  startPadPos,
  villagerStartFor,
} from "./map";
import { foeBrainStats, notifyAiMatchEnd, notifyAiMatchStart, runAiTurn } from "./ai";
import {
  blankEpisode,
  executionEdge,
  formatIntellect,
  getFoeBrain,
  rushCommitDelay,
  thinkInterval,
  veryHard,
  veryHardHoldSeconds,
  waveSizeTarget,
  type EpisodeMemory,
} from "./learningAi";
import {
  awardMatchXp,
  bumpScoutSalt,
  gatherMult,
  loadMeta,
  unitUnlocked,
  unlockHint,
  xpForNextLevel,
  xpProgress,
} from "./progress";
import type {
  Building,
  BuildingKind,
  GameState,
  MapDef,
  Pad,
  RectHit,
  ResourceNode,
  Team,
  TrainKind,
  UiSnapshot,
  SkirmishSetup,
  Unit,
  UnitKind,
  Villager,
} from "./types";

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function moveTowards(p: { x: number; y: number }, target: { x: number; y: number }, speed: number, dt: number) {
  const d = dist(p, target);
  if (d <= 0.001) return;
  const step = Math.min(d, speed * dt);
  p.x += ((target.x - p.x) / d) * step;
  p.y += ((target.y - p.y) / d) * step;
}

const KEEP_GARRISON_MAX = 5;
const KEEP_ARROW_RANGE = 185;
const KEEP_ARROW_COOLDOWN = 1.15;
const ARCHER_RANGE = 112;

/** What the human is doing, kept between foe thinks. Single-player omniscience. */
interface HumanAiRead {
  levies: number;
  runners: number;
  rammers: number;
  archers: number;
  ballistae: number;
  catapults: number;
  watchtowers: number;
  peonsField: number;
  peonsGarrison: number;
  peonsWood: number;
  peonsGold: number;
  forwardPeons: number;
  barracks: number;
  houses: number;
  keepHp: number;
  queuedLevies: number;
  recentLevies: number;
  hasRally: boolean;
  /** Mean Y of the human army. Lower is closer to the foe keep. */
  armyY: number;
  rushLane: 0 | 1;
  rush: boolean;
  rushNear: boolean;
  attrition: boolean;
}

function blankHumanRead(): HumanAiRead {
  return {
    levies: 0,
    runners: 0,
    rammers: 0,
    archers: 0,
    ballistae: 0,
    catapults: 0,
    watchtowers: 0,
    peonsField: 0,
    peonsGarrison: 0,
    peonsWood: 0,
    peonsGold: 0,
    forwardPeons: 0,
    barracks: 0,
    houses: 0,
    keepHp: 0,
    queuedLevies: 0,
    recentLevies: 0,
    hasRally: false,
    armyY: 664,
    rushLane: 0,
    rush: false,
    rushNear: false,
    attrition: false,
  };
}

export class GameSim {
  private nextId = 1;
  private state: GameState;
  private aiTimer = 0;
  private aiRushDeadline = 0;
  private aiRead: HumanAiRead = blankHumanRead();
  private aiSeenLevyIds: number[] = [];
  private aiSlainAtWave = 0;
  /** Which AI the build/train helpers currently act for. Duel stays "foe". */
  private aiSide: Team = "foe";
  private episodes = new Map<Team, EpisodeMemory>();
  private sideAi = new Map<Team, { timer: number; rushDeadline: number; read: HumanAiRead; seenLevyIds: number[]; slainAtWave: number }>();
  private activeMap: MapDef;
  private controlGroups = new Map<number, number[]>();

  constructor() {
    const meta = loadMeta();
    this.activeMap = getOrCreateCampaignMap(meta.level, meta.scoutSalt);
    this.state = this.makeFreshState(this.activeMap);
  }

  private makeFreshState(map: MapDef): GameState {
    const meta = loadMeta();
    const triangle = map.layout === "triangle";
    const teams: Team[] = triangle ? ["you", "foe", "east"] : ["you", "foe"];
    const pads = buildPads(map);
    const nodes = buildNodes(map);
    const buildings: Building[] = [];
    for (const team of teams) {
      const pad = startPadPos(map, team);
      buildings.push({
        id: this.next(),
        team,
        kind: "watchtower",
        padId: startPadId(map, team),
        pos: { ...pad },
        spent: 60,
        spentWood: 0,
        canRefund: false,
        damageRank: 0,
        rateRank: 0,
        attackTimer: 0,
        trainTimer: 0,
        animKick: 0,
        queue: [],
      });
    }
    const villagers = [];
    for (const team of teams) {
      for (let i = 0; i < 2; i++) {
        villagers.push({
          id: this.next(),
          team,
          pos: villagerStartFor(map, team, i),
          speed: VILLAGER_SPEED,
          hp: VILLAGER_HP,
          maxHp: VILLAGER_HP,
          state: "idle" as const,
          timer: 0,
          carryingGold: 0,
          carryingWood: 0,
          attackTimer: 0,
        });
      }
    }
    const keepFor = (team: Team) => ({
      team,
      pos: keepPosFor(map, team),
      hp: START_KEEP_HP,
      maxHp: START_KEEP_HP,
      hitFlash: 0,
      attackTimer: 0,
      attackFlash: 0,
      peonQueue: [] as { timeLeft: number; totalTime: number }[],
    });
    const freshGold = () => ({ you: START_GOLD, foe: START_GOLD, ...(triangle ? { east: START_GOLD } : {}) });
    const freshWood = () => ({ you: START_WOOD, foe: START_WOOD, ...(triangle ? { east: START_WOOD } : {}) });
    const freshStats = () => ({
      you: { slain: 0, goldEarned: 0 },
      foe: { slain: 0, goldEarned: 0 },
      ...(triangle ? { east: { slain: 0, goldEarned: 0 } } : {}),
    });
    return {
      phase: "title",
      mapId: map.id,
      time: 0,
      paused: false,
      speed: 1,
      soundOn: false,
      audioUnlocked: false,
      keeps: {
        you: keepFor("you"),
        foe: keepFor("foe"),
        ...(triangle ? { east: keepFor("east") } : {}),
      },
      gold: freshGold(),
      wood: freshWood(),
      players: triangle ? 3 : 2,
      attackTarget: "foe",
      eliminated: [],
      worldW: map.worldW ?? WORLD_W,
      worldH: map.worldH ?? WORLD_H,
      units: [],
      buildings,
      villagers,
      barricades: [],
      pads,
      nodes,
      waveIndex: 0,
      wavePhase: "build",
      buildTimer: FIRST_BUILD,
      waveSpawnTimer: 0,
      waveSpawnSide: "you",
      pendingWaveUnits: [],
      allWavesLaunched: false,
      wavesCleared: 0,
      buildSelection: null,
      selectedBuildingId: null,
      selectedVillagerIds: [],
      selectedKeepTeam: null,
      hoveredPadId: null,
      toasts: [],
      floatingTexts: [],
      combatEvents: [],
      commandMarkers: [],
      stats: freshStats(),
      pulseNodeUntil: 10,
      firstVillagerAssigned: false,
      endReason: "",
      redFlash: 0,
      shake: 0,
      keepLevel: meta.level,
      matchXpEarned: 0,
      lastXpGain: 0,
      won: null,
    };
  }


  private next() {
    return this.nextId++;
  }

  getState() {
    return this.state;
  }

  /** Reload campaign map for current keep level (+ scout salt). */
  reloadCampaignMap() {
    const meta = loadMeta();
    this.activeMap = getOrCreateCampaignMap(meta.level, meta.scoutSalt);
    this.nextId = 1;
    this.aiTimer = 0;
    this.aiRushDeadline = 0;
    this.aiRead = blankHumanRead();
    this.aiSeenLevyIds = [];
    this.aiSlainAtWave = 0;
    this.aiSide = "foe";
    this.episodes.clear();
    this.sideAi.clear();
    this.state = this.makeFreshState(this.activeMap);
  }

  /**
   * Build the match the skirmish menu asked for.
   * Small is the existing duel. Large is the three-keep free-for-all.
   */
  applySkirmish(setup: SkirmishSetup) {
    const players = setup.mapSize === "small" ? 2 : 3;
    if (players === 2) {
      this.reloadCampaignMap();
      return;
    }
    const meta = loadMeta();
    const seed = seedForCampaign(meta.level, meta.scoutSalt);
    this.activeMap = generateTriangleMap(seed);
    this.nextId = 1;
    this.aiTimer = 0;
    this.aiRushDeadline = 0;
    this.aiRead = blankHumanRead();
    this.aiSeenLevyIds = [];
    this.aiSlainAtWave = 0;
    this.aiSide = "foe";
    this.episodes.clear();
    this.sideAi.clear();
    for (const team of ["foe", "east"] as Team[]) {
      this.sideAi.set(team, {
        timer: 0.4 + (team === "east" ? 0.35 : 0),
        rushDeadline: 0,
        read: blankHumanRead(),
        seenLevyIds: [],
        slainAtWave: 0,
      });
      this.episodes.set(team, blankEpisode());
    }
    this.state = this.makeFreshState(this.activeMap);
  }

  /** Same keep level, new procedural terrain. */
  rerollMap() {
    bumpScoutSalt();
    this.reloadCampaignMap();
    this.addToast(`New ground: ${this.activeMap.name}`);
  }

  reset() {
    this.reloadCampaignMap();
  }

  startMatch() {
    this.state.phase = "running";
    this.state.wavePhase = "build";
    this.state.buildTimer = FIRST_BUILD;
    notifyAiMatchStart();
    const iq = foeBrainStats().intellect;
    if (this.isTriangle()) {
      this.addToast(`Skirmish — North and East. Attacking ${this.teamName(this.state.attackTarget)}.`);
      this.addToast(`Foe intellect ${formatIntellect(iq)} — both enemies learn from one book`);
    } else {
      this.addToast(`Build phase — ${FIRST_BUILD}s until wave 1`);
      this.addToast(`Foe intellect ${formatIntellect(iq)} — learning your patterns`);
    }
  }

  isTriangle() {
    return this.state.players === 3;
  }

  /** Test and HUD: the keep human attack orders currently use. */
  humanAttackKeep(): Team {
    return this.livingAttackTarget();
  }

  aiThinkerCount() {
    return this.episodes.size;
  }

  setAiSide(team: Team) {
    this.aiSide = team;
  }

  currentAiSide(): Team {
    return this.aiSide;
  }

  opponentOf(team: Team): Team {
    if (!this.isTriangle()) return team === "you" ? "foe" : "you";
    return this.pressureTarget(team);
  }

  cycleAttackTarget() {
    if (!this.isTriangle() || this.state.phase !== "running") return;
    const options = (["foe", "east"] as Team[]).filter((t) => this.keepAlive(t));
    if (options.length < 2) return;
    const i = options.indexOf(this.state.attackTarget);
    this.setAttackTarget(options[(i + 1) % options.length]);
  }

  setSound(on: boolean) {
    this.state.soundOn = on;
  }

  unlockAudio() {
    this.state.audioUnlocked = true;
  }

  togglePause() {
    this.state.paused = !this.state.paused;
  }

  toggleSpeed() {
    this.state.speed = this.state.speed === 1 ? 2 : 1;
  }

  selectBuild(kind: BuildingKind | null) {
    this.state.buildSelection = kind;
    this.state.selectedBuildingId = null;
    this.state.selectedVillagerIds = [];
    this.state.selectedKeepTeam = null;
  }

  cancelSelection() {
    this.state.buildSelection = null;
    this.state.selectedBuildingId = null;
    this.state.selectedVillagerIds = [];
    this.state.selectedKeepTeam = null;
  }

  click(hit: RectHit | null, world?: { x: number; y: number }) {
    if (this.state.phase !== "running") return;
    if (this.state.buildSelection === "barricade" && world) {
      this.tryPlaceBarricade(world);
      return;
    }
    if (!hit) {
      this.state.selectedBuildingId = null;
      this.state.selectedVillagerIds = [];
      this.state.selectedKeepTeam = null;
      return;
    }
    if (hit.kind === "villager") {
      const id = Number(hit.id);
      const peon = this.state.villagers.find((v) => v.id === id && v.team === "you");
      this.state.selectedVillagerIds = peon ? [peon.id] : [];
      this.state.selectedBuildingId = null;
      this.state.selectedKeepTeam = null;
      return;
    }
    if (hit.kind === "node") {
      this.assignVillagerToNode(hit.id);
      return;
    }
    if (hit.kind === "keep" && hit.id === "you") {
      // Select keep for peon training (double-purpose: also home call via button later)
      this.state.selectedKeepTeam = "you";
      this.state.selectedBuildingId = null;
      this.state.selectedVillagerIds = [];
      this.state.buildSelection = null;
      return;
    }
    if (hit.kind === "pad") {
      this.tryBuildOnPad(hit.id);
      return;
    }
    if (hit.kind === "building") {
      const id = Number(hit.id);
      this.state.selectedBuildingId = Number.isNaN(id) ? null : id;
      this.state.selectedVillagerIds = [];
      this.state.selectedKeepTeam = null;
      this.state.buildSelection = null;
    }
  }

  selectVillagersInRect(a: { x: number; y: number }, b: { x: number; y: number }, additive = false) {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const ids = this.state.villagers
      .filter(
        (v) =>
          v.team === "you" &&
          v.state !== "garrisoned" &&
          v.pos.x >= minX &&
          v.pos.x <= maxX &&
          v.pos.y >= minY &&
          v.pos.y <= maxY,
      )
      .map((v) => v.id);
    this.state.selectedVillagerIds = additive
      ? [...new Set([...this.state.selectedVillagerIds, ...ids])]
      : ids;
    this.state.selectedBuildingId = null;
    this.state.selectedKeepTeam = null;
    this.state.buildSelection = null;
  }

  useControlGroup(slot: number, assign: boolean) {
    if (assign) {
      this.controlGroups.set(slot, [...this.state.selectedVillagerIds]);
      if (this.state.selectedVillagerIds.length > 0) this.addToast(`Control group ${slot} set.`);
      return this.state.selectedVillagerIds.length > 0;
    }
    const alive = new Set(this.state.villagers.filter((v) => v.team === "you" && v.hp > 0).map((v) => v.id));
    const ids = (this.controlGroups.get(slot) ?? []).filter((id) => alive.has(id));
    if (ids.length === 0) return false;
    this.state.selectedVillagerIds = ids;
    this.state.selectedBuildingId = null;
    this.state.selectedKeepTeam = null;
    return true;
  }

  private releasePeonTask(v: GameState["villagers"][number]) {
    if (v.targetNodeId) {
      const node = this.state.nodes.find((n) => n.id === v.targetNodeId);
      if (node) node.workers = Math.max(0, node.workers - 1);
    }
    if (v.targetBarricadeId) {
      this.state.barricades = this.state.barricades.filter(
        (b) => b.id !== v.targetBarricadeId || b.built,
      );
    }
    v.targetNodeId = undefined;
    v.targetEnemyId = undefined;
    v.targetBarricadeId = undefined;
    v.moveTarget = undefined;
    v.patrolA = undefined;
    v.patrolB = undefined;
    v.patrolToB = undefined;
    v.engageFrom = undefined;
    v.forcedAttack = false;
  }

  commandSelected(world: { x: number; y: number }, hit: RectHit | null, patrol = false) {
    const selected = this.state.villagers.filter(
      (v) => v.team === "you" && this.state.selectedVillagerIds.includes(v.id),
    );
    if (this.isTriangle()) {
      if (hit?.kind === "keep" && hit.id !== "you") {
        this.setAttackTarget(hit.id as Team);
      } else if (hit?.kind === "unit") {
        const clicked = this.state.units.find((u) => u.id === Number(hit.id) && u.hp > 0);
        if (clicked && this.isHostile("you", clicked.team)) this.setAttackTarget(clicked.team);
      } else if (patrol) {
        const near = this.enemyKeepNear(world);
        if (near) this.setAttackTarget(near);
      }
    }
    if (selected.length === 0) {
      const barracks = this.state.buildings.find(
        (b) => b.id === this.state.selectedBuildingId && b.team === "you" && b.kind === "barracks",
      );
      if (barracks) {
        barracks.rallyPoint = { ...world };
        const nearKeep = this.isTriangle() ? this.enemyKeepNear(world) : null;
        if (nearKeep) this.setAttackTarget(nearKeep);
        this.state.commandMarkers.push({ id: this.next(), kind: "rally", pos: { ...world }, life: 1.4 });
        this.addToast("Barracks rally point set.");
      }
      return;
    }

    if (hit?.kind === "node") {
      const node = this.state.nodes.find((n) => n.id === hit.id);
      if (!node) return;
      let open = Math.max(0, node.maxWorkers - node.workers);
      for (const v of selected) {
        this.releasePeonTask(v);
        if (open > 0 && node.loadsLeft > 0) {
          v.targetNodeId = node.id;
          v.state = "toNode";
          node.workers += 1;
          open -= 1;
        } else {
          v.moveTarget = { ...node.pos };
          v.state = "moving";
        }
      }
      this.state.commandMarkers.push({ id: this.next(), kind: "gather", pos: { ...node.pos }, life: 1.1 });
      return;
    }

    if (hit?.kind === "unit") {
      const enemy = this.state.units.find((u) => u.id === Number(hit.id) && u.hp > 0 && this.isHostile("you", u.team));
      if (enemy) {
        for (const v of selected) {
          this.releasePeonTask(v);
          v.state = "defend";
          v.targetEnemyId = enemy.id;
          v.forcedAttack = true;
        }
        this.state.commandMarkers.push({ id: this.next(), kind: "attack", pos: { ...enemy.pos }, life: 1.1 });
        return;
      }
    }

    selected.forEach((v, index) => {
      this.releasePeonTask(v);
      const spread = {
        x: world.x + ((index % 3) - 1) * 7,
        y: world.y + (Math.floor(index / 3) % 3) * 7,
      };
      if (patrol) {
        v.patrolA = { ...v.pos };
        v.patrolB = spread;
        v.patrolToB = true;
        v.state = "patrolling";
      } else {
        v.moveTarget = spread;
        v.state = "moving";
      }
    });
    this.state.commandMarkers.push({
      id: this.next(),
      kind: patrol ? "patrol" : "move",
      pos: { ...world },
      life: 1.1,
    });
  }

  stopSelectedVillagers() {
    let held = 0;
    for (const v of this.state.villagers) {
      if (v.team !== "you" || !this.state.selectedVillagerIds.includes(v.id)) continue;
      const guard = { ...v.pos };
      this.releasePeonTask(v);
      v.state = "defend";
      v.moveTarget = guard;
      v.forcedAttack = false;
      held += 1;
    }
    if (held > 0) this.addToast("Selected peons stopped.");
  }

  /** Direct barricade placement (touch radial menu) — no build-mode round trip. */
  placeBarricadeAt(world: { x: number; y: number }) {
    if (this.state.phase !== "running") return;
    this.tryPlaceBarricade(world);
  }

  private tryPlaceBarricade(world: { x: number; y: number }) {
    if (world.y < FOE_SIEGE_Y || world.y > YOU_SIEGE_Y) {
      this.addToast("Barricades must be placed on the road between the keeps.");
      return;
    }
    const roads = ([0, 1] as const).map((lane) => ({
      lane,
      x:
        (lanePathX(this.activeMap.seed, "you", lane, world.y) +
          lanePathX(this.activeMap.seed, "foe", lane, world.y)) /
        2,
    }));
    roads.sort((a, b) => Math.abs(a.x - world.x) - Math.abs(b.x - world.x));
    const road = roads[0];
    if (Math.abs(road.x - world.x) > 30) {
      this.addToast("Place the barricade directly across a road.");
      return;
    }
    const pos = { x: road.x, y: world.y };
    if (this.state.barricades.some((b) => b.lane === road.lane && Math.abs(b.pos.y - pos.y) < 45)) {
      this.addToast("Too close to another barricade.");
      return;
    }
    const cost = BUILD_COST.barricade;
    if (!this.canAfford("you", cost)) {
      this.addToast(`Need ${cost.gold}g ${cost.wood}w for a barricade.`);
      return;
    }
    const builder = this.state.villagers
      .filter(
        (v) =>
          v.team === "you" &&
          v.state !== "garrisoned" &&
          v.state !== "toGarrison" &&
          v.state !== "toBarricade" &&
          v.state !== "buildingBarricade",
      )
      .sort((a, b) => dist(a.pos, pos) - dist(b.pos, pos))[0];
    if (!builder) {
      this.addToast("No peon is available to build.");
      return;
    }
    if (builder.targetNodeId) {
      const node = this.state.nodes.find((n) => n.id === builder.targetNodeId);
      if (node) node.workers = Math.max(0, node.workers - 1);
    }
    this.spendRes("you", cost);
    const barricade = {
      id: this.next(),
      team: "you" as Team,
      lane: road.lane,
      pos,
      hp: 6,
      maxHp: 6,
      buildProgress: 0,
      buildTime: 3,
      built: false,
      builderId: builder.id,
    };
    this.state.barricades.push(barricade);
    builder.targetNodeId = undefined;
    builder.targetEnemyId = undefined;
    builder.targetBarricadeId = barricade.id;
    builder.state = "toBarricade";
    this.state.buildSelection = null;
    this.addToast("Peon dispatched to construct the barricade.");
  }

  peonCap(team: Team) {
    const houses = this.state.buildings.filter((b) => b.team === team && b.kind === "house").length;
    return BASE_PEON_CAP + houses * HOUSE_POP;
  }

  peonSlotsUsed(team: Team) {
    const alive = this.state.villagers.filter((v) => v.team === team).length;
    const queued = this.state.keeps[team]?.peonQueue.length ?? 0;
    return alive + queued;
  }

  canAfford(team: Team, cost: ResCost) {
    return (this.state.gold[team] ?? 0) >= cost.gold && (this.state.wood[team] ?? 0) >= cost.wood;
  }

  private spendRes(team: Team, cost: ResCost) {
    const gold = this.state.gold[team];
    const wood = this.state.wood[team];
    if (gold === undefined || wood === undefined) return;
    this.state.gold[team] = gold - cost.gold;
    this.state.wood[team] = wood - cost.wood;
  }

  enqueuePeon(team: Team = "you") {
    const s = this.state;
    const keep = s.keeps[team];
    if (!keep) return false;
    if (keep.peonQueue.length >= MAX_PEON_QUEUE) {
      if (team === "you") this.addToast("Peon queue full.");
      return false;
    }
    if (this.peonSlotsUsed(team) >= this.peonCap(team)) {
      if (team === "you") this.addToast(`Pop cap ${this.peonCap(team)} — build a House.`);
      return false;
    }
    const cost: ResCost = { gold: PEON_TRAIN_GOLD, wood: PEON_TRAIN_WOOD };
    if (!this.canAfford(team, cost)) {
      if (team === "you") this.addToast(`Need ${cost.gold}g to train a peon.`);
      return false;
    }
    this.spendRes(team, cost);
    keep.peonQueue.push({ timeLeft: PEON_TRAIN_TIME, totalTime: PEON_TRAIN_TIME });
    if (team === "you") this.addToast("Peon queued at the keep.");
    return true;
  }

  callHomeSelected() {
    if (this.state.selectedKeepTeam === "you") this.callVillagersHome("you");
  }

  garrisonVillagers(team: Team) {
    const keep = this.teamKeep(team);
    const occupied = this.state.villagers.filter(
      (v) => v.team === team && (v.state === "garrisoned" || v.state === "toGarrison"),
    ).length;
    const open = Math.max(0, KEEP_GARRISON_MAX - occupied);
    if (open === 0) {
      if (team === "you") this.addToast("Keep garrison is full.");
      return;
    }
    const chosen = this.state.villagers
      .filter(
        (v) =>
          v.team === team &&
          v.state !== "garrisoned" &&
          v.state !== "toGarrison" &&
          v.state !== "toBarricade" &&
          v.state !== "buildingBarricade",
      )
      .sort((a, b) => dist(a.pos, keep.pos) - dist(b.pos, keep.pos))
      .slice(0, open);
    for (const v of chosen) {
      if (v.targetNodeId) {
        const node = this.state.nodes.find((n) => n.id === v.targetNodeId);
        if (node) node.workers = Math.max(0, node.workers - 1);
      }
      v.targetNodeId = undefined;
      v.targetEnemyId = undefined;
      v.state = "toGarrison";
    }
    if (team === "you") {
      this.addToast(chosen.length > 0 ? `${chosen.length} peon(s) ordered into the keep.` : "No peons available.");
    }
  }

  ungarrisonVillagers(team: Team) {
    const keep = this.teamKeep(team);
    const inside = this.state.villagers.filter((v) => v.team === team && v.state === "garrisoned");
    inside.forEach((v, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      v.pos = { x: keep.pos.x + side * (14 + (i % 3) * 5), y: keep.pos.y + (team === "you" ? -28 : 28) };
      // Stand guard at the exit so they keep fighting nearby enemies.
      v.state = "defend";
      v.moveTarget = { ...v.pos };
      v.forcedAttack = false;
      v.targetEnemyId = undefined;
      v.targetNodeId = undefined;
      v.engageFrom = undefined;
      v.patrolA = undefined;
      v.patrolB = undefined;
      v.patrolToB = undefined;
    });
    if (team === "you" && inside.length > 0) this.addToast(`${inside.length} peon(s) ungarrisoned.`);
  }

  private tickPeonQueues(dt: number) {
    for (const team of this.actingTeams()) {
      const keep = this.state.keeps[team];
      if (!keep || keep.peonQueue.length === 0) continue;
      const job = keep.peonQueue[0];
      job.timeLeft -= dt;
      if (job.timeLeft > 0) continue;
      keep.peonQueue.shift();
      if (this.state.villagers.filter((v) => v.team === team).length >= this.peonCap(team)) continue;
      const idx = this.state.villagers.filter((v) => v.team === team).length;
      this.state.villagers.push({
        id: this.next(),
        team,
        pos: villagerStartFor(this.activeMap, team, idx % 3),
        speed: VILLAGER_SPEED,
        hp: VILLAGER_HP,
        maxHp: VILLAGER_HP,
        state: "idle",
        timer: 0,
        carryingGold: 0,
        carryingWood: 0,
        attackTimer: 0,
      });
      if (team === "you") this.addToast("Peon ready.");
    }
  }

  private addToast(text: string) {
    this.state.toasts.push({ id: this.next(), text, life: 2.2 });
  }

  private addFloat(text: string, x: number, y: number, color: string) {
    this.state.floatingTexts.push({ id: this.next(), text, pos: { x, y }, color, life: 1.2, rise: 0 });
  }

  private emitCombat(
    kind: GameState["combatEvents"][number]["kind"],
    pos: { x: number; y: number },
    target?: { x: number; y: number },
    team?: Team,
  ) {
    this.state.combatEvents.push({
      id: this.next(),
      kind,
      pos: { ...pos },
      target: target ? { ...target } : undefined,
      team,
      life: 0.8,
    });
  }

  private teamKeep(team: Team) {
    const keep = this.state.keeps[team];
    if (!keep) throw new Error(`missing keep ${team}`);
    return keep;
  }

  private enemy(team: Team): Team {
    return team === "you" ? "foe" : "you";
  }

  private activeTeams(): Team[] {
    return this.isTriangle() ? ["you", "foe", "east"] : ["you", "foe"];
  }

  private actingTeams(): Team[] {
    return this.activeTeams().filter((t) => !this.state.eliminated.includes(t));
  }

  private keepAlive(team: Team) {
    const keep = this.state.keeps[team];
    return !!keep && keep.hp > 0 && !this.state.eliminated.includes(team);
  }

  private isHostile(a: Team, b: Team) {
    return a !== b && this.keepAlive(a) && this.keepAlive(b);
  }

  teamName(team: Team) {
    if (team === "you") return "You";
    if (team === "east") return "East";
    return this.isTriangle() ? "North" : "Foe";
  }

  private livingAttackTarget(): Team {
    if (this.keepAlive(this.state.attackTarget)) return this.state.attackTarget;
    const other = (["foe", "east"] as Team[]).find((t) => this.keepAlive(t));
    return other ?? "foe";
  }

  private pressureTarget(team: Team): Team {
    if (!this.isTriangle()) return this.enemy(team);
    const keep = this.teamKeep(team);
    let best: Team = team === "you" ? this.livingAttackTarget() : "you";
    let bestN = 0;
    for (const rival of this.activeTeams()) {
      if (!this.isHostile(team, rival)) continue;
      const n = this.state.units.filter(
        (u) => u.team === rival && u.hp > 0 && dist(u.pos, keep.pos) < 240,
      ).length;
      if (n > bestN) {
        bestN = n;
        best = rival;
      }
    }
    return best;
  }

  private unitGoal(u: Unit): Team {
    if (u.team === "you") return this.livingAttackTarget();
    return this.pressureTarget(u.team);
  }

  private roadBetween(a: Team, b: Team) {
    return this.activeMap.roads?.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
  }

  private pointAlong(from: Team, to: Team, t: number) {
    const road = this.roadBetween(from, to);
    const keep = this.teamKeep(to);
    if (!road) return { ...keep.pos };
    const forward = road.a === from;
    const pts = road.points;
    const idx = Math.max(0, Math.min(pts.length - 1, Math.round(t * (pts.length - 1))));
    const point = forward ? pts[idx] : pts[pts.length - 1 - idx];
    return { x: point.x, y: point.y };
  }

  private enemyKeepNear(pos: { x: number; y: number }, radius = 78): Team | null {
    let best: Team | null = null;
    let bestD = radius;
    for (const team of ["foe", "east"] as Team[]) {
      if (!this.keepAlive(team)) continue;
      const d = dist(pos, this.teamKeep(team).pos);
      if (d <= bestD) {
        bestD = d;
        best = team;
      }
    }
    return best;
  }

  setAttackTarget(team: Team) {
    if (!this.isTriangle() || !this.keepAlive(team) || team === "you") return;
    const changed = this.state.attackTarget !== team;
    this.state.attackTarget = team;
    for (const u of this.state.units) {
      if (u.team !== "you" || u.hp <= 0) continue;
      u.goalTeam = team;
      u.targetUnitId = undefined;
      u.engageFrom = undefined;
      u.targetKeep = false;
    }
    if (changed) {
      const keep = this.teamKeep(team);
      this.state.commandMarkers.push({ id: this.next(), kind: "attack", pos: { ...keep.pos }, life: 1.6 });
      this.addToast(`Attacking: ${this.teamName(team)}`);
    }
  }

  private eliminateTeam(team: Team) {
    if (team === "you" || this.state.eliminated.includes(team)) return;
    this.state.eliminated.push(team);
    for (const v of this.state.villagers) {
      if (v.team !== team || !v.targetNodeId) continue;
      const node = this.state.nodes.find((n) => n.id === v.targetNodeId);
      if (node) node.workers = Math.max(0, node.workers - 1);
    }
    this.state.units = this.state.units.filter((u) => u.team !== team);
    this.state.villagers = this.state.villagers.filter((v) => v.team !== team);
    this.addToast(`${this.teamName(team)} is eliminated.`);
    if (this.state.attackTarget === team) {
      const other = (["foe", "east"] as Team[]).find((t) => t !== team && this.keepAlive(t));
      if (other) this.setAttackTarget(other);
    }
  }

  private spawnUnit(team: Team, kind: UnitKind, lane: 0 | 1, fromBarracks: boolean, barracks?: Building) {
    const def = UNIT_DEFS[kind];
    let hp = def.hp;
    let damage = def.damage;
    let cooldown = def.cooldown;
    if (fromBarracks && barracks) {
      hp *= DAMAGE_MULT[barracks.damageRank];
      damage *= DAMAGE_MULT[barracks.damageRank];
      cooldown *= RATE_MULT[barracks.rateRank];
    }
    const aiHeldForRush = team !== "you" && fromBarracks;
    const stagingY = 138 + lane * 8;
    const goal = team === "you" ? this.livingAttackTarget() : this.pressureTarget(team);
    const spawnPos = this.isTriangle()
      ? this.pointAlong(team, goal, 0.07)
      : {
          x: lanePathX(this.activeMap.seed, team, lane, laneStartY(team)),
          y: laneStartY(team),
        };
    const u: Unit = {
      id: this.next(),
      team,
      kind,
      lane,
      pos: spawnPos,
      hp,
      maxHp: hp,
      speed: def.speed,
      damage,
      bounty: def.bounty,
      attackCooldown: cooldown,
      attackTimer: 0,
      towerResist: def.towerResist,
      keepMult: def.keepMult,
      siegeGap: def.siegeGap,
      targetKeep: false,
      fromBarracks,
      ignoreEnemyCreeps: !fromBarracks,
      rallyPoint: barracks?.rallyPoint ? { ...barracks.rallyPoint } : undefined,
      aiHeldForRush,
      goalTeam: this.isTriangle() ? goal : undefined,
      aiStagingPoint: aiHeldForRush
        ? this.isTriangle()
          ? this.pointAlong(team, goal, 0.16)
          : {
              x: lanePathX(this.activeMap.seed, team, lane, stagingY),
              y: stagingY,
            }
        : undefined,
    };
    this.state.units.push(u);
  }

  private launchNextWave() {
    const s = this.state;
    if (s.waveIndex >= WAVES.length) return;
    const idx = s.waveIndex;
    this.enqueueWave(idx);
    s.waveIndex += 1;
    s.wavePhase = "spawning";
    s.waveSpawnTimer = 0;
    const income = WAVE_START_INCOME + Math.floor(idx * 3);
    for (const team of this.activeTeams()) {
      s.gold[team] = (s.gold[team] ?? 0) + income;
      const stats = s.stats[team];
      if (stats) stats.goldEarned += income;
    }
    this.addToast(`Wave ${s.waveIndex}/${WAVES.length} — +${income}g`);
    this.addFloat(`+${income}`, s.keeps.you.pos.x - 30, s.keeps.you.pos.y - 40, "#8cd6ff");
    this.emitCombat("waveHorn", s.keeps.you.pos);
    if (s.waveIndex >= WAVES.length) s.allWavesLaunched = true;
  }

  rushNextWave() {
    const s = this.state;
    if (s.phase !== "running" || s.wavePhase !== "build") return;
    if (s.waveIndex >= WAVES.length) return;
    for (const team of this.activeTeams()) s.gold[team] = (s.gold[team] ?? 0) + RUSH_BONUS;
    s.stats.you.goldEarned += RUSH_BONUS;
    this.addToast(`Rushed! +${RUSH_BONUS}g — wave incoming`);
    s.buildTimer = 0;
    this.launchNextWave();
  }

  private waveCreepsAlive() {
    return this.state.units.some((u) => !u.fromBarracks);
  }

  private onWaveCleared() {
    const s = this.state;
    s.wavesCleared += 1;
    const bonus = WAVE_CLEAR_BASE + s.wavesCleared * WAVE_CLEAR_SCALE;
    for (const team of this.activeTeams()) {
      s.gold[team] = (s.gold[team] ?? 0) + bonus;
      const stats = s.stats[team];
      if (stats) stats.goldEarned += bonus;
    }
    this.addToast(`Wave cleared! +${bonus}g — build phase`);
    this.addFloat(`+${bonus}`, s.keeps.you.pos.x + 24, s.keeps.you.pos.y - 44, "#9dffc0");

    if (s.allWavesLaunched) {
      // Final score after last clear once barracks armies also settle is handled in update
      s.wavePhase = "build";
      s.buildTimer = 0;
      return;
    }
    s.wavePhase = "build";
    s.buildTimer = BUILD_PAUSE;
  }

  private splitWave(count: number): number {
    return Math.floor(count / 2);
  }

  private enqueueWave(index: number) {
    const spec = WAVES[index];
    const pairs: { kind: UnitKind; count: number }[] = [
      { kind: "raider", count: spec.raider },
      { kind: "soldier", count: spec.soldier },
      { kind: "brute", count: spec.brute },
      { kind: "runner", count: spec.runner },
      { kind: "ward", count: spec.ward },
    ];
    for (const p of pairs) {
      const perLane = this.splitWave(p.count);
      for (const lane of [0, 1] as const) {
        for (let i = 0; i < perLane; i++) {
          for (const team of this.activeTeams()) {
            this.state.pendingWaveUnits.push({ team, kind: p.kind, lane });
          }
        }
      }
    }
  }

  private assignVillagerToNode(nodeId: string, team: Team = "you") {
    // Resource ownership does not prevent gathering: enemy nodes are raid targets.
    const node = this.state.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    if (node.loadsLeft <= 0) {
      if (team === "you") this.addToast("Still recovering — wait for regrowth.");
      return;
    }
    const teamVillagers = this.state.villagers.filter(
      (v) =>
        v.team === team &&
        v.state !== "garrisoned" &&
        v.state !== "toGarrison" &&
        v.state !== "toBarricade" &&
        v.state !== "buildingBarricade",
    );
    let chosen = teamVillagers
      .filter((v) => v.state === "idle" || v.state === "home")
      .sort((a, b) => dist(a.pos, node.pos) - dist(b.pos, node.pos))[0];
    if (!chosen) {
      chosen = teamVillagers.sort((a, b) => dist(a.pos, node.pos) - dist(b.pos, node.pos))[0];
      if (!chosen) return;
      if (chosen.targetNodeId) {
        const old = this.state.nodes.find((n) => n.id === chosen!.targetNodeId);
        if (old) old.workers = Math.max(0, old.workers - 1);
      }
    }
    if (node.workers >= node.maxWorkers) {
      this.addToast("Node is full.");
      return;
    }
    node.workers += 1;
    chosen.targetNodeId = node.id;
    chosen.state = "toNode";
    if (team === "you") {
      this.state.firstVillagerAssigned = true;
      if (node.team !== team) this.addToast(`Eco raid: peon sent to enemy ${node.kind === "pine" ? "wood" : "gold"}!`);
    }
  }

  callVillagersHome(team: Team) {
    for (const v of this.state.villagers.filter((a) => a.team === team)) {
      if (v.state === "garrisoned") continue;
      if (v.targetBarricadeId) {
        const site = this.state.barricades.find((b) => b.id === v.targetBarricadeId && !b.built);
        if (site) {
          this.state.barricades = this.state.barricades.filter((b) => b.id !== site.id);
          this.state.gold[team] = (this.state.gold[team] ?? 0) + BUILD_COST.barricade.gold;
          this.state.wood[team] = (this.state.wood[team] ?? 0) + BUILD_COST.barricade.wood;
        }
        v.targetBarricadeId = undefined;
      }
      if (v.targetNodeId) {
        const node = this.state.nodes.find((n) => n.id === v.targetNodeId);
        if (node) node.workers = Math.max(0, node.workers - 1);
      }
      v.targetNodeId = undefined;
      v.moveTarget = undefined;
      v.patrolA = undefined;
      v.patrolB = undefined;
      v.patrolToB = undefined;
      v.engageFrom = undefined;
      v.forcedAttack = false;
      v.targetEnemyId = undefined;
      // Preserve carried resources and bank them on arrival.
      v.state = v.carryingGold > 0 || v.carryingWood > 0 ? "toKeep" : "home";
      v.timer = 0;
    }
    if (team === "you") this.addToast("🔔 Recall! All peons return to the keep.");
  }

  private tryBuildOnPad(padId: string) {
    const s = this.state;
    const pad = s.pads.find((p) => p.id === padId);
    if (!pad) return;
    if (pad.team !== "you") {
      this.addToast("Enemy ground. You cannot build there.");
      return;
    }
    if (s.buildings.some((b) => b.padId === pad.id)) {
      this.addToast("Pad occupied — tap the building to manage it.");
      return;
    }
    if (!s.buildSelection) {
      this.addToast("Choose a building below, then tap an empty pad.");
      return;
    }
    const kind = s.buildSelection;
    if (pad.zone === "eco" && kind !== "house") {
      this.addToast("Eco pads behind the keep are for Houses only.");
      return;
    }
    if (pad.zone === "combat" && kind === "house") {
      this.addToast("Houses go on eco pads behind your keep.");
      return;
    }
    const cost = BUILD_COST[kind];
    if (!this.canAfford("you", cost)) {
      this.addToast(`Need ${cost.gold}g ${cost.wood}w for ${buildingName(kind)}.`);
      return;
    }
    this.spendRes("you", cost);
    const id = this.next();
    s.buildings.push({
      id,
      team: "you",
      kind,
      padId: pad.id,
      pos: { ...pad.pos },
      spent: cost.gold,
      spentWood: cost.wood,
      canRefund: true,
      damageRank: 0,
      rateRank: 0,
      attackTimer: 0,
      trainTimer: 0,
      animKick: 0,
      queue: [],
    });
    s.buildSelection = null;
    s.selectedBuildingId = id;
    this.addToast(`${buildingName(kind)} raised.`);
  }

  buyUpgrade(kind: "damage" | "rate") {
    const s = this.state;
    const b = s.buildings.find((x) => x.id === s.selectedBuildingId);
    if (!b || b.team !== "you") return;
    const rank = kind === "damage" ? b.damageRank : b.rateRank;
    if (rank >= 2) return;
    const cost = UPGRADE_COST[rank];
    if (s.gold.you < cost) {
      this.addToast(`Need ${cost} gold.`);
      return;
    }
    s.gold.you -= cost;
    b.spent += cost;
    if (kind === "damage") b.damageRank = (rank + 1) as 1 | 2;
    else b.rateRank = (rank + 1) as 1 | 2;
    this.addToast(`${kind} rank ${rank + 2} bought.`);
  }

  razeSelected() {
    const s = this.state;
    const b = s.buildings.find((x) => x.id === s.selectedBuildingId);
    if (!b || b.team !== "you") return;
    const refundG = b.canRefund ? Math.floor(b.spent * 0.5) : 0;
    const refundW = b.canRefund ? Math.floor(b.spentWood * 0.5) : 0;
    s.gold.you += refundG;
    s.wood.you += refundW;
    s.buildings = s.buildings.filter((x) => x.id !== b.id);
    s.selectedBuildingId = null;
    if (refundG > 0 || refundW > 0) this.addToast(`Razed for +${refundG}g +${refundW}w.`);
    else this.addToast("Razed. The first tower returns no resources.");
  }

  enqueueTrain(kind: TrainKind, team: Team = "you") {
    const s = this.state;
    const b =
      team === "you"
        ? s.buildings.find((x) => x.id === s.selectedBuildingId && x.kind === "barracks" && x.team === "you")
        : s.buildings
            .filter((x) => x.kind === "barracks" && x.team === team)
            .sort((a, c) => a.queue.length - c.queue.length)[0];
    if (!b) {
      if (team === "you") this.addToast("Select a barracks first.");
      return false;
    }
    if (b.queue.length >= MAX_TRAIN_QUEUE) {
      if (team === "you") this.addToast("Training queue is full.");
      return false;
    }
    if (team === "you" && !unitUnlocked(kind, s.keepLevel)) {
      this.addToast(unlockHint(kind));
      return false;
    }
    const def = UNIT_DEFS[kind];
    const cost: ResCost = { gold: def.cost ?? 30, wood: def.woodCost ?? 0 };
    if (!this.canAfford(team, cost)) {
      if (team === "you") this.addToast(`Need ${cost.gold}g ${cost.wood}w.`);
      return false;
    }
    this.spendRes(team, cost);
    const trainTime = (def.trainTime ?? 4) * RATE_MULT[b.rateRank];
    b.queue.push({ kind, timeLeft: trainTime, totalTime: trainTime });
    if (team === "you") this.addToast(`${def.label} queued.`);
    return true;
  }

  cancelQueueSlot(index: number) {
    const s = this.state;
    const b = s.buildings.find((x) => x.id === s.selectedBuildingId && x.kind === "barracks" && x.team === "you");
    if (!b || index < 0 || index >= b.queue.length) return;
    const job = b.queue[index];
    const def = UNIT_DEFS[job.kind];
    const refundG = Math.floor((def.cost ?? 0) * 0.5);
    const refundW = Math.floor((def.woodCost ?? 0) * 0.5);
    s.gold.you += refundG;
    s.wood.you += refundW;
    b.queue.splice(index, 1);
    this.addToast(`Cancelled (+${refundG}g +${refundW}w).`);
  }

  private buildingDamage(b: Building) {
    return BUILD_DAMAGE[b.kind] * DAMAGE_MULT[b.damageRank];
  }

  private buildingCooldown(b: Building) {
    return BUILD_COOLDOWN[b.kind] * RATE_MULT[b.rateRank];
  }

  /** Starter tower uses long guard range so the keep gate is never a dead zone. */
  private towerReach(b: Building) {
    if (!b.canRefund && b.kind === "watchtower") return STARTER_GUARD_RANGE;
    return BUILD_RANGE[b.kind];
  }

  private applyTowerDamage(u: Unit, raw: number) {
    const dmg = raw * (1 - u.towerResist);
    u.hp -= dmg;
    return dmg;
  }

  private unitSiegingKeep(u: Unit, defendingTeam: Team) {
    if (u.targetKeep) return true;
    if (this.isTriangle()) return dist(u.pos, this.teamKeep(defendingTeam).pos) < 130;
    if (defendingTeam === "you") return u.pos.y >= YOU_SIEGE_Y;
    return u.pos.y <= FOE_SIEGE_Y;
  }

  private doKeepCombat(dt: number, team: Team) {
    const keep = this.teamKeep(team);
    keep.attackTimer -= dt;
    const occupants = this.state.villagers.filter(
      (v) => v.team === team && v.state === "garrisoned",
    ).length;
    if (occupants === 0 || keep.attackTimer > 0) return;

    const targets = this.state.units
      .filter((u) => u.team !== team && dist(u.pos, keep.pos) <= KEEP_ARROW_RANGE)
      .sort((a, b) => dist(a.pos, keep.pos) - dist(b.pos, keep.pos));
    const target = targets[0];
    if (!target) return;

    // The base arrow plus additional fire from each peon makes a populated keep
    // meaningfully safer without replacing dedicated towers.
    const raw = 4 + occupants * 2.5;
    const dealt = this.applyTowerDamage(target, raw);
    this.addFloat(`-${Math.round(dealt)}`, target.pos.x, target.pos.y - 8, "#f6dfa0");
    keep.attackTarget = { ...target.pos };
    keep.attackFlash = 0.18;
    keep.attackTimer = KEEP_ARROW_COOLDOWN;
    this.emitCombat("arrow", keep.pos, target.pos, team);
  }

  private hostileTo(team: Team, other: Team) {
    return this.isTriangle() ? this.isHostile(team, other) : other === this.enemy(team);
  }

  private doTowerCombat(dt: number, team: Team) {
    const keep = this.teamKeep(team);
    const towers = this.state.buildings.filter(
      (b) => b.team === team && b.kind !== "barracks" && b.kind !== "house",
    );
    for (const t of towers) {
      t.attackTimer -= dt;
      if (t.attackTimer > 0) continue;
      const reach = this.towerReach(t);

      // Watchtower arrows never target peons. Only heavy emplacements can
      // punish an eco raid.
      const peons = this.state.villagers.filter((v) => {
        if (!this.hostileTo(team, v.team)) return false;
        if (v.state === "garrisoned") return false;
        return dist(v.pos, t.pos) <= reach;
      });
      if ((t.kind === "ballista" || t.kind === "catapult") && peons.length > 0) {
        peons.sort((a, b) => dist(a.pos, t.pos) - dist(b.pos, t.pos));
        const peon = peons[0];
        const raw = this.buildingDamage(t) * (t.kind === "catapult" ? 0.82 : 1);
        peon.hp -= raw;
        this.emitCombat(
          t.kind === "catapult" ? "ramImpact" : "arrow",
          t.pos,
          peon.pos,
          team,
        );
        this.addFloat(
          `-${Math.round(raw)}`,
          peon.pos.x,
          peon.pos.y - 8,
          t.kind === "catapult" ? "#f39c72" : "#ffe59d",
        );
        t.attackTimer = this.buildingCooldown(t);
        t.animKick = 0.15;
        continue;
      }

      const inRange = this.state.units.filter((u) => {
        if (!this.hostileTo(team, u.team)) return false;
        if (!t.canRefund && dist(u.pos, keep.pos) <= KEEP_THREAT_RADIUS + 30) return true;
        return dist(u.pos, t.pos) <= reach;
      });
      if (inRange.length === 0) continue;
      inRange.sort((a, b) =>
        this.isTriangle() ? dist(a.pos, t.pos) - dist(b.pos, t.pos) : team === "you" ? b.pos.y - a.pos.y : a.pos.y - b.pos.y,
      );
      const target = inRange[0];
      let raw = this.buildingDamage(t);
      // Watchtowers are soft vs units chewing the keep
      if (t.kind === "watchtower" && this.unitSiegingKeep(target, team)) {
        raw *= ARCHER_VS_SIEGE;
      }
      if (t.kind === "catapult") {
        this.emitCombat("ramImpact", t.pos, target.pos, team);
        for (const u of inRange) {
          if (dist(u.pos, target.pos) <= CATAPULT_SPLASH_RADIUS) {
            let splash = raw;
            if (this.unitSiegingKeep(u, team)) splash *= 0.85;
            const dealt = this.applyTowerDamage(u, splash);
            this.addFloat(`-${Math.round(dealt)}`, u.pos.x, u.pos.y - 8, "#f39c72");
          }
        }
      } else {
        const dealt = this.applyTowerDamage(target, raw);
        this.emitCombat(
          t.kind === "watchtower" ? "arrow" : t.kind === "ballista" ? "ramImpact" : "meleeHit",
          t.pos,
          target.pos,
          team,
        );
        this.addFloat(`-${Math.round(dealt)}`, target.pos.x, target.pos.y - 8, "#ffe59d");
      }
      t.attackTimer = this.buildingCooldown(t);
      t.animKick = 0.15;
    }
  }

  private pickLane(team: Team): 0 | 1 {
    const laneCounts = [0, 0];
    for (const u of this.state.units) {
      if (u.team !== team && u.pos.y > 100 && u.pos.y < 620) laneCounts[u.lane] += 1;
    }
    return laneCounts[1] > laneCounts[0] ? 1 : 0;
  }

  private doBarracks(dt: number, team: Team) {
    const bars = this.state.buildings.filter((b) => b.team === team && b.kind === "barracks");
    for (const b of bars) {
      if (b.queue.length === 0) continue;
      const job = b.queue[0];
      job.timeLeft -= dt;
      if (job.timeLeft > 0) continue;
      this.spawnUnit(team, job.kind, this.pickLane(team), true, b);
      b.queue.shift();
    }
  }

  private livingHostile(team: Team, id: number, allowPeons: boolean): Unit | Villager | undefined {
    const unit = this.state.units.find((u) => u.id === id && u.team !== team && u.hp > 0);
    if (unit) return unit;
    if (!allowPeons) return undefined;
    return this.state.villagers.find(
      (v) => v.id === id && v.team !== team && v.hp > 0 && v.state !== "garrisoned",
    );
  }

  private nearestPeonThreat(team: Team, pos: { x: number; y: number }, radius: number) {
    let best: Unit | Villager | undefined;
    let bestD = radius;
    const consider = (ent: Unit | Villager, d: number) => {
      if (d <= bestD) {
        best = ent;
        bestD = d;
      }
    };
    for (const u of this.state.units) {
      if (u.team === team || u.hp <= 0) continue;
      consider(u, dist(u.pos, pos));
    }
    for (const v of this.state.villagers) {
      if (v.team === team || v.hp <= 0 || v.state === "garrisoned") continue;
      consider(v, dist(v.pos, pos));
    }
    return best;
  }

  /** In-place swing. Does not chase, so gather and move orders stay intact. */
  private peonRetaliate(v: Villager, team: Team) {
    const threat = this.nearestPeonThreat(team, v.pos, PEON_MELEE_RANGE);
    if (!threat) return false;
    if (v.attackTimer <= 0) {
      threat.hp -= PEON_DAMAGE;
      v.attackTimer = PEON_ATTACK_CD;
      this.emitCombat("meleeHit", v.pos, threat.pos, team);
      this.addFloat(`-${PEON_DAMAGE}`, threat.pos.x, threat.pos.y - 7, "#e8c070");
    }
    return true;
  }

  private stepPeonPatrol(v: Villager, team: Team, dt: number) {
    if (!v.patrolA || !v.patrolB) {
      v.state = "idle";
      return;
    }
    const leash = PEON_AGGRO_RANGE * AGGRO_LEASH_MULT;
    const anchor = v.engageFrom;
    let target =
      anchor && v.targetEnemyId != null ? this.livingHostile(team, v.targetEnemyId, true) : undefined;
    if (target && anchor && dist(anchor, target.pos) > leash) {
      target = undefined;
      v.targetEnemyId = undefined;
    }
    if (!target && anchor && dist(v.pos, anchor) > 3) {
      const onRoute = this.nearestPeonThreat(team, anchor, PEON_AGGRO_RANGE);
      if (onRoute) {
        target = onRoute;
        v.targetEnemyId = onRoute.id;
      } else {
        moveTowards(v.pos, anchor, v.speed, dt);
        return;
      }
    }
    if (!target) {
      v.engageFrom = undefined;
      v.targetEnemyId = undefined;
      const seen = this.nearestPeonThreat(team, v.pos, PEON_AGGRO_RANGE);
      if (seen) {
        v.engageFrom = { ...v.pos };
        v.targetEnemyId = seen.id;
        target = seen;
      }
    }
    if (target) {
      if (dist(v.pos, target.pos) > PEON_MELEE_RANGE) {
        moveTowards(v.pos, target.pos, PEON_FIGHT_SPEED, dt);
      } else if (v.attackTimer <= 0) {
        target.hp -= PEON_DAMAGE;
        v.attackTimer = PEON_ATTACK_CD;
        this.emitCombat("meleeHit", v.pos, target.pos, team);
        this.addFloat(`-${PEON_DAMAGE}`, target.pos.x, target.pos.y - 8, "#c8e090");
      }
      return;
    }
    const destination = v.patrolToB ? v.patrolB : v.patrolA;
    moveTowards(v.pos, destination, v.speed, dt);
    if (dist(v.pos, destination) < 3) v.patrolToB = !v.patrolToB;
  }

  /** Stand-ground guard. Returns false when this peon has no guard point. */
  private stepPeonGuard(v: Villager, team: Team, dt: number) {
    const guard = v.moveTarget;
    if (!guard) return false;
    const leash = PEON_AGGRO_RANGE * AGGRO_LEASH_MULT;
    let target = v.targetEnemyId != null ? this.livingHostile(team, v.targetEnemyId, true) : undefined;
    if (target && dist(guard, target.pos) > leash) target = undefined;
    if (!target) {
      target = this.nearestPeonThreat(team, guard, PEON_AGGRO_RANGE);
      if (!target) {
        const inFace = this.nearestPeonThreat(team, v.pos, PEON_MELEE_RANGE);
        if (inFace && dist(guard, inFace.pos) <= leash) target = inFace;
      }
    }
    v.targetEnemyId = target?.id;
    if (!target) {
      if (dist(v.pos, guard) > 3) moveTowards(v.pos, guard, v.speed, dt);
      return true;
    }
    if (dist(v.pos, target.pos) > PEON_MELEE_RANGE) {
      moveTowards(v.pos, target.pos, PEON_FIGHT_SPEED, dt);
    } else if (v.attackTimer <= 0) {
      target.hp -= PEON_DAMAGE;
      v.attackTimer = PEON_ATTACK_CD;
      this.emitCombat("meleeHit", v.pos, target.pos, team);
      this.addFloat(`-${PEON_DAMAGE}`, target.pos.x, target.pos.y - 8, "#c8e090");
    }
    return true;
  }

  private militaryAccepts(u: Unit, ent: Unit | Villager, enemyTeam: Team) {
    if (ent.hp <= 0) return false;
    if (this.isTriangle()) {
      if (!this.isHostile(u.team, ent.team)) return false;
    } else if (ent.team !== enemyTeam) return false;
    if ("fromBarracks" in ent) return !u.ignoreEnemyCreeps || ent.fromBarracks;
    return (u.fromBarracks || u.kind === "archer") && ent.state !== "garrisoned";
  }

  private pickMilitaryHostile(u: Unit, team: Team): Unit | Villager | undefined {
    const enemyTeam = this.enemy(team);
    const aggro = u.kind === "archer" ? ARCHER_RANGE : MELEE_AGGRO_RANGE;
    const leash = aggro * AGGRO_LEASH_MULT;
    const allowPeons = u.fromBarracks || u.kind === "archer";
    if (u.targetUnitId != null && u.engageFrom) {
      const current = this.livingHostile(team, u.targetUnitId, allowPeons);
      if (current && this.militaryAccepts(u, current, enemyTeam) && dist(u.engageFrom, current.pos) <= leash) {
        return current;
      }
      u.targetUnitId = undefined;
    }
    const nearest = (origin: { x: number; y: number }, radius: number) => {
      let best: Unit | Villager | undefined;
      let bestD = radius;
      let pref: Unit | Villager | undefined;
      let prefD = radius;
      const goal = this.isTriangle() ? this.unitGoal(u) : enemyTeam;
      for (const e of this.state.units) {
        if (!this.militaryAccepts(u, e, enemyTeam)) continue;
        const d = dist(e.pos, origin);
        if (d <= bestD) {
          best = e;
          bestD = d;
        }
        if (this.isTriangle() && e.team === goal && d <= prefD) {
          pref = e;
          prefD = d;
        }
      }
      if (!allowPeons) return pref ?? best;
      for (const v of this.state.villagers) {
        if (!this.militaryAccepts(u, v, enemyTeam)) continue;
        const d = dist(v.pos, origin);
        if (d <= bestD) {
          best = v;
          bestD = d;
        }
        if (this.isTriangle() && v.team === goal && d <= prefD) {
          pref = v;
          prefD = d;
        }
      }
      return pref ?? best;
    };
    if (u.engageFrom && dist(u.pos, u.engageFrom) > 4) {
      const onPost = nearest(u.engageFrom, aggro);
      if (onPost) {
        u.targetUnitId = onPost.id;
        return onPost;
      }
      return undefined;
    }
    u.engageFrom = undefined;
    const seen = nearest(u.pos, aggro);
    if (!seen) return undefined;
    u.engageFrom = { ...u.pos };
    u.targetUnitId = seen.id;
    return seen;
  }

  private fightMilitary(u: Unit, target: Unit | Villager, team: Team, dt: number) {
    const contact = u.kind === "archer" ? ARCHER_RANGE : 18;
    if (dist(u.pos, target.pos) > contact) {
      moveTowards(u.pos, target.pos, u.speed, dt);
      return;
    }
    if (u.attackTimer > 0) return;
    target.hp -= u.damage;
    u.attackTimer = u.attackCooldown;
    const ranged = u.kind === "archer";
    this.emitCombat(ranged ? "arrow" : "meleeHit", u.pos, target.pos, team);
    this.addFloat(
      `-${Math.round(u.damage)}`,
      target.pos.x,
      target.pos.y - 7,
      ranged ? "#e8d39a" : "#ffd1cc",
    );
  }

  private marchOnRoad(u: Unit, from: Team, goal: Team, dt: number) {
    const keep = this.teamKeep(goal);
    if (dist(u.pos, keep.pos) < 46) {
      if (u.attackTimer <= 0) {
        const dmg = u.damage * u.keepMult;
        keep.hp -= dmg;
        keep.hitFlash = 0.2;
        this.emitCombat(u.kind === "rammer" ? "ramImpact" : "keepImpact", u.pos, keep.pos, from);
        if (goal === "you") {
          this.state.redFlash = 0.18;
          this.state.shake = 0.15;
        }
        u.attackTimer = u.attackCooldown + u.siegeGap;
        this.addFloat(`-${Math.round(dmg)}`, keep.pos.x, keep.pos.y - 18, "#ff9d9d");
      }
      return;
    }
    const road = this.roadBetween(from, goal);
    if (!road) {
      moveTowards(u.pos, keep.pos, u.speed, dt);
      return;
    }
    const forward = road.a === from;
    const pts = road.points;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = dist(u.pos, pts[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const index = forward ? best : pts.length - 1 - best;
    const next = Math.min(pts.length - 1, index + 2);
    const point = forward ? pts[next] : pts[pts.length - 1 - next];
    moveTowards(u.pos, next === index ? keep.pos : point, u.speed, dt);
  }

  private updateUnitMovementAndMelee(dt: number, team: Team) {
    const enemyTeam = this.enemy(team);
    const hardHold = veryHard(foeBrainStats().intellect);
    for (const u of this.state.units.filter((x) => x.team === team)) {
      u.attackTimer -= dt;
      const gateY = laneYGate(team);
      const enemies = this.state.units.filter((e) =>
        this.isTriangle() ? this.isHostile(team, e.team) && e.hp > 0 : e.team === enemyTeam && e.lane === u.lane,
      );
      if (u.fromBarracks) {
        // A very-hard wave stays stacked on its staging point. It only swings
        // at someone already in reach, then resumes the hold. After release,
        // the attack-move / leash path below carries the group.
        if (hardHold && u.aiHeldForRush && u.aiStagingPoint) {
          const hostile = this.pickMilitaryHostile(u, team);
          const contact = u.kind === "archer" ? ARCHER_RANGE : 18;
          if (hostile && dist(u.pos, hostile.pos) <= contact) {
            this.fightMilitary(u, hostile, team, dt);
            continue;
          }
          u.engageFrom = undefined;
          u.targetUnitId = undefined;
          if (dist(u.pos, u.aiStagingPoint) > 4) {
            moveTowards(u.pos, u.aiStagingPoint, u.speed, dt);
          }
          continue;
        }
        const hostile = this.pickMilitaryHostile(u, team);
        if (hostile) {
          this.fightMilitary(u, hostile, team, dt);
          continue;
        }
        if (u.engageFrom && dist(u.pos, u.engageFrom) > 4) {
          moveTowards(u.pos, u.engageFrom, u.speed, dt);
          continue;
        }
        u.engageFrom = undefined;
        u.targetUnitId = undefined;
        if (u.aiHeldForRush && u.aiStagingPoint) {
          if (dist(u.pos, u.aiStagingPoint) > 4) {
            moveTowards(u.pos, u.aiStagingPoint, u.speed, dt);
          }
          continue;
        }
        if (u.rallyPoint) {
          moveTowards(u.pos, u.rallyPoint, u.speed, dt);
          if (dist(u.pos, u.rallyPoint) < 5) u.rallyPoint = undefined;
          continue;
        }
      }
      if (!u.fromBarracks && u.kind === "archer") {
        const rangedUnits = enemies
          .filter((e) => dist(e.pos, u.pos) <= ARCHER_RANGE)
          .sort((a, b) => dist(a.pos, u.pos) - dist(b.pos, u.pos));
        const rangedPeons = this.state.villagers
          .filter(
            (v) =>
              (this.isTriangle() ? this.isHostile(team, v.team) : v.team === enemyTeam) &&
              v.state !== "garrisoned" &&
              dist(v.pos, u.pos) <= ARCHER_RANGE,
          )
          .sort((a, b) => dist(a.pos, u.pos) - dist(b.pos, u.pos));
        const target = rangedUnits[0] ?? rangedPeons[0];
        if (target) {
          if (u.attackTimer <= 0) {
            target.hp -= u.damage;
            u.attackTimer = u.attackCooldown;
            this.emitCombat("arrow", u.pos, target.pos, team);
            this.addFloat(`-${Math.round(u.damage)}`, target.pos.x, target.pos.y - 7, "#e8d39a");
          }
          continue;
        }
      }
      const meleeTarget = !u.fromBarracks
        ? enemies
            .filter((e) => dist(e.pos, u.pos) < 18 && e.fromBarracks)
            .sort((a, b) => dist(a.pos, u.pos) - dist(b.pos, u.pos))[0]
        : undefined;
      if (meleeTarget) {
        if (u.attackTimer <= 0) {
          meleeTarget.hp -= u.damage;
          u.attackTimer = u.attackCooldown;
          this.emitCombat("meleeHit", u.pos, meleeTarget.pos, team);
          this.addFloat(`-${Math.round(u.damage)}`, meleeTarget.pos.x, meleeTarget.pos.y - 6, "#ffd1cc");
        }
        continue;
      }
      const barricade = this.state.barricades
        .filter(
          (b) =>
            b.built &&
            b.team !== team &&
            b.lane === u.lane &&
            Math.abs(b.pos.y - u.pos.y) <= 18,
        )
        .sort((a, b) => Math.abs(a.pos.y - u.pos.y) - Math.abs(b.pos.y - u.pos.y))[0];
      if (barricade) {
        if (u.kind === "rammer") {
          this.state.barricades = this.state.barricades.filter((b) => b.id !== barricade.id);
          this.state.shake = Math.max(this.state.shake, 0.12);
          this.emitCombat("ramImpact", u.pos, barricade.pos, team);
          this.addFloat("CRUSH", barricade.pos.x, barricade.pos.y - 9, "#e4bd77");
        } else if (u.kind === "archer") {
          // Archers cannot damage a barricade, but may slowly leave the road
          // and flank it so a ranged-only army never deadlocks forever.
          const dir = team === "you" ? -1 : 1;
          const flankSide = u.lane === 0 ? -1 : 1;
          const bypassX = barricade.pos.x + flankSide * 32;
          const lateral = Math.min(Math.abs(bypassX - u.pos.x), u.speed * 0.58 * dt);
          u.pos.x += Math.sign(bypassX - u.pos.x) * lateral;
          u.pos.y += dir * u.speed * 0.44 * dt;
          continue;
        } else {
          if (u.attackTimer <= 0) {
            barricade.hp -= u.kind === "runner" ? 3 : 2;
            u.attackTimer = u.attackCooldown;
            this.emitCombat(
              barricade.hp > 0 ? "woodHit" : "woodBreak",
              u.pos,
              barricade.pos,
              team,
            );
            this.addFloat(
              barricade.hp > 0 ? `-${u.kind === "runner" ? 3 : 2}` : "BREACH",
              barricade.pos.x,
              barricade.pos.y - 9,
              "#e4bd77",
            );
            if (barricade.hp <= 0) {
              this.state.shake = Math.max(this.state.shake, 0.07);
              this.state.barricades = this.state.barricades.filter((b) => b.id !== barricade.id);
            }
          }
          continue;
        }
      }
      if (this.isTriangle()) {
        const goal = this.unitGoal(u);
        u.goalTeam = goal;
        this.marchOnRoad(u, team, goal, dt);
        continue;
      }
      const atGate = team === "you" ? u.pos.y <= gateY : u.pos.y >= gateY;
      if (atGate) {
        if (u.attackTimer <= 0) {
          const keep = this.teamKeep(enemyTeam);
          const dmg = u.damage * u.keepMult;
          keep.hp -= dmg;
          keep.hitFlash = 0.2;
          this.emitCombat(u.kind === "rammer" ? "ramImpact" : "keepImpact", u.pos, keep.pos, team);
          if (enemyTeam === "you") {
            this.state.redFlash = 0.18;
            this.state.shake = 0.15;
          }
          u.attackTimer = u.attackCooldown + u.siegeGap;
          this.addFloat(`-${Math.round(dmg)}`, keep.pos.x, keep.pos.y - 18, "#ff9d9d");
        }
        continue;
      }
      const dir = team === "you" ? -1 : 1;
      u.pos.y += dir * u.speed * dt;
      // Follow the actual curved road instead of marching down a fixed vertical line.
      const roadX = lanePathX(this.activeMap.seed, team, u.lane, u.pos.y);
      const lateralStep = Math.min(Math.abs(roadX - u.pos.x), u.speed * 0.9 * dt);
      u.pos.x += Math.sign(roadX - u.pos.x) * lateralStep;
    }
  }

  private cleanupDeaths() {
    const survivors: Unit[] = [];
    for (const u of this.state.units) {
      if (u.hp > 0) {
        survivors.push(u);
        continue;
      }
      const killer = this.bountyTeam(u);
      if (killer && this.state.gold[killer] !== undefined && this.state.stats[killer]) {
        this.state.gold[killer] = (this.state.gold[killer] ?? 0) + u.bounty;
        this.state.stats[killer]!.goldEarned += u.bounty;
        this.state.stats[killer]!.slain += 1;
      }
      this.addFloat(`+${u.bounty}`, u.pos.x, u.pos.y - 10, killer === "you" ? "#9bd7ff" : "#ff9bb0");
      this.emitCombat("unitDeath", u.pos, undefined, u.team);
    }
    this.state.units = survivors;
  }

  private cleanupDeadPeons() {
    this.state.villagers = this.state.villagers.filter((v) => {
      if (v.hp > 0) return true;
      if (v.targetNodeId) {
        const node = this.state.nodes.find((n) => n.id === v.targetNodeId);
        if (node) node.workers = Math.max(0, node.workers - 1);
      }
      if (v.targetBarricadeId) {
        this.state.barricades = this.state.barricades.filter(
          (b) => b.id !== v.targetBarricadeId || b.built,
        );
      }
      this.addFloat("✕", v.pos.x, v.pos.y - 6, "#ff8866");
      return false;
    });
  }

  private updateResourceRegen(dt: number) {
    for (const n of this.state.nodes) {
      if (n.loadsLeft >= n.maxLoads) {
        n.regenAcc = 0;
        continue;
      }
      n.regenAcc += dt;
      if (n.regenAcc >= n.regenEvery) {
        n.regenAcc = 0;
        n.loadsLeft += 1;
      }
    }
  }

  private bountyTeam(victim: Unit): Team | null {
    if (!this.isTriangle()) return this.enemy(victim.team);
    let best: Team | null = null;
    let bestD = 90;
    for (const u of this.state.units) {
      if (u.hp <= 0 || !this.isHostile(victim.team, u.team)) continue;
      const d = dist(u.pos, victim.pos);
      if (d < bestD) {
        bestD = d;
        best = u.team;
      }
    }
    if (best) return best;
    return victim.team === "you" ? null : "you";
  }

  private isSiegingKeep(team: Team, u: Unit) {
    if (this.isTriangle()) return dist(u.pos, this.teamKeep(team).pos) < 140;
    // Y-band covers BOTH roads; pure radius missed the east gate (~109px from keep).
    if (team === "you") return u.pos.y >= YOU_SIEGE_Y;
    return u.pos.y <= FOE_SIEGE_Y;
  }

  private enemiesThreateningKeep(team: Team) {
    const keep = this.teamKeep(team);
    if (this.isTriangle()) {
      return this.state.units
        .filter((u) => this.isHostile(team, u.team) && dist(u.pos, keep.pos) < 160)
        .sort((a, b) => dist(a.pos, keep.pos) - dist(b.pos, keep.pos));
    }
    const enemy = this.enemy(team);
    return this.state.units
      .filter((u) => u.team === enemy && this.isSiegingKeep(team, u))
      .sort((a, b) => dist(a.pos, keep.pos) - dist(b.pos, keep.pos));
  }

  /** Split peons across lanes so they do not all dogpile the west road. */
  private pickPeonTarget(threats: Unit[], peonIndex: number, currentId?: number) {
    if (threats.length === 0) return undefined;
    const stillValid = currentId != null ? threats.find((t) => t.id === currentId) : undefined;
    const priority = (u: Unit) => {
      const siege = u.kind === "rammer" ? 100 : u.kind === "brute" ? 55 : u.kind === "runner" ? 25 : 10;
      return siege + (1 - u.hp / Math.max(1, u.maxHp)) * 20;
    };
    const bestPriority = Math.max(...threats.map(priority));
    if (stillValid && priority(stillValid) >= bestPriority - 10) return stillValid;
    const preferredLane = (peonIndex % 2) as 0 | 1;
    const onLane = threats
      .filter((t) => t.lane === preferredLane)
      .sort((a, b) => priority(b) - priority(a));
    if (onLane.length > 0) return onLane[0];
    return [...threats].sort((a, b) => priority(b) - priority(a))[0];
  }

  private manageFoePeonDefense() {
    const team = this.aiSide;
    const keep = this.teamKeep(team);
    // React before attackers reach the siege line. The old 160-Y trigger gave
    // distant workers too little time to reach the keep and garrison.
    const closeThreats = this.state.units
      .filter((u) => {
        if (!this.hostileTo(team, u.team)) return false;
        if (this.isTriangle()) return dist(u.pos, keep.pos) < 280;
        return u.pos.y <= FOE_SIEGE_Y + 170;
      })
      .sort((a, b) => dist(a.pos, keep.pos) - dist(b.pos, keep.pos));
    // Level 10+ already saw the levy rush on the last think. Pull a few peons
    // once that rush is actually on the road, and send them back when it breaks.
    const advancing =
      veryHard(foeBrainStats().intellect) && this.aiRead.rushNear
        ? this.state.units
            .filter((u) => {
              if (!u.fromBarracks || u.hp <= 0 || !this.hostileTo(team, u.team)) return false;
              if (this.isTriangle()) return dist(u.pos, keep.pos) < 360;
              return u.team === "you" && u.pos.y <= 480;
            })
            .sort((a, b) => dist(a.pos, keep.pos) - dist(b.pos, keep.pos))
        : [];
    const threats = closeThreats.length > 0 ? closeThreats : advancing;
    const peons = this.state.villagers.filter((v) => v.team === team && v.hp > 0);

    if (threats.length === 0) {
      const wasDefending = peons.some(
        (v) => v.state === "garrisoned" || v.state === "toGarrison" || v.state === "defend",
      );
      this.ungarrisonVillagers(team);
      for (const v of peons) {
        if (v.state === "toGarrison" || v.state === "defend") {
          v.state = "idle";
          v.targetEnemyId = undefined;
          v.moveTarget = undefined;
          v.forcedAttack = false;
          v.engageFrom = undefined;
        }
      }
      if (wasDefending) this.aiAssignWorkers();
      return;
    }

    const threatScore = threats.reduce(
      (score, u) => score + (u.kind === "rammer" ? 3 : u.kind === "brute" ? 2 : 1),
      0,
    );
    const critical = keep.hp < keep.maxHp * 0.45 || threatScore >= 6;
    const onlyAdvancing = closeThreats.length === 0;
    // A rush that is still up the road takes one defender and leaves a worker
    // on the grove. Units already at the gate use the old, tighter reserve.
    const economyReserve = critical ? 0 : onlyAdvancing ? 1 : peons.length > 2 ? 1 : 0;
    const desiredGarrison = Math.min(
      KEEP_GARRISON_MAX,
      Math.max(1, Math.ceil(threatScore / 2)),
      Math.max(0, peons.length - economyReserve),
    );
    const committed = peons.filter(
      (v) => v.state === "garrisoned" || v.state === "toGarrison",
    ).length;

    if (committed < desiredGarrison) {
      const candidates = peons
        .filter(
          (v) =>
            v.state !== "garrisoned" &&
            v.state !== "toGarrison" &&
            v.state !== "toBarricade" &&
            v.state !== "buildingBarricade",
        )
        // Protect injured workers first, then minimize travel time to safety.
        .sort((a, b) => a.hp - b.hp || dist(a.pos, keep.pos) - dist(b.pos, keep.pos))
        .slice(0, desiredGarrison - committed);
      for (const v of candidates) {
        if (v.targetNodeId) {
          const node = this.state.nodes.find((n) => n.id === v.targetNodeId);
          if (node) node.workers = Math.max(0, node.workers - 1);
        }
        v.targetNodeId = undefined;
        v.targetEnemyId = undefined;
        v.state = "toGarrison";
      }
    }

    // Villagers counter exposed siege, but the AI keeps most workers protected
    // instead of throwing its whole economy into every skirmish.
    const siegeTargets = threats.filter((u) => u.kind === "rammer" || u.kind === "brute");
    const desiredMelee = siegeTargets.length > 0 ? Math.min(2, Math.ceil(threatScore / 3)) : 0;
    const melee = peons.filter((v) => v.state === "defend");
    if (melee.length > desiredMelee) {
      for (const v of melee.slice(desiredMelee)) {
        v.state = "idle";
        v.targetEnemyId = undefined;
      }
    }
    if (melee.length < desiredMelee) {
      const candidates = peons
        .filter(
          (v) =>
            v.state !== "garrisoned" &&
            v.state !== "toGarrison" &&
            v.state !== "defend",
        )
        .sort((a, b) => dist(a.pos, keep.pos) - dist(b.pos, keep.pos))
        .slice(0, desiredMelee - melee.length);
      for (const v of candidates) {
        if (v.targetNodeId) {
          const node = this.state.nodes.find((n) => n.id === v.targetNodeId);
          if (node) node.workers = Math.max(0, node.workers - 1);
        }
        v.targetNodeId = undefined;
        v.state = "defend";
        v.moveTarget = undefined;
        v.forcedAttack = false;
        v.engageFrom = undefined;
        v.targetEnemyId = this.pickPeonTarget(siegeTargets, 0)?.id;
      }
    }
  }

  private updateVillagers(dt: number, team: Team) {
    const keep = this.teamKeep(team);
    const gMult = gatherMult(this.state.keepLevel);
    const threats = this.enemiesThreateningKeep(team);
    const underAttack = threats.length > 0;
    const teamPeons = this.state.villagers.filter((x) => x.team === team);

    if (underAttack && team === "you") {
      let rallied = 0;
      teamPeons.forEach((v, i) => {
        if (v.state === "defend") return;
        // Assigned eco peons never abandon their task automatically. Only the
        // player's bell recall pulls them home; idle peons may still defend.
        if ((v.state === "idle" || v.state === "home") && !v.targetNodeId) {
          v.state = "defend";
          v.moveTarget = undefined;
          v.forcedAttack = false;
          v.engageFrom = undefined;
          v.targetEnemyId = this.pickPeonTarget(threats, i)?.id;
          rallied += 1;
        }
      });
      if (rallied > 0 && team === "you" && !this.state.toasts.some((t) => t.text.includes("Peons rally"))) {
        this.addToast("Peons rally to both roads!");
      }
    }

    teamPeons.forEach((v, peonIndex) => {
      v.attackTimer -= dt;

      if (v.state === "garrisoned") {
        v.pos = { ...keep.pos };
        return;
      }
      if (v.state === "toGarrison") {
        moveTowards(v.pos, keep.pos, v.speed, dt);
        if (dist(v.pos, keep.pos) < 8) {
          if (v.carryingGold > 0) {
            this.state.gold[team] = (this.state.gold[team] ?? 0) + v.carryingGold;
            if (this.state.stats[team]) this.state.stats[team]!.goldEarned += v.carryingGold;
          }
          if (v.carryingWood > 0) this.state.wood[team] = (this.state.wood[team] ?? 0) + v.carryingWood;
          v.carryingGold = 0;
          v.carryingWood = 0;
          v.state = "garrisoned";
          v.pos = { ...keep.pos };
          if (team === "you") this.addToast("Peon garrisoned — keep arrows online.");
        }
        return;
      }

      if (v.state === "toBarricade" || v.state === "buildingBarricade") {
        if (this.peonRetaliate(v, team)) return;
        const site = this.state.barricades.find((b) => b.id === v.targetBarricadeId);
        if (!site) {
          v.targetBarricadeId = undefined;
          v.state = "idle";
          return;
        }
        if (v.state === "toBarricade") {
          moveTowards(v.pos, site.pos, v.speed, dt);
          if (dist(v.pos, site.pos) < 6) v.state = "buildingBarricade";
        } else {
          site.buildProgress = Math.min(site.buildTime, site.buildProgress + dt);
          if (site.buildProgress >= site.buildTime) {
            site.built = true;
            site.builderId = undefined;
            v.targetBarricadeId = undefined;
            v.state = "idle";
            this.emitCombat("buildComplete", v.pos, site.pos, team);
            if (team === "you") this.addToast("Barricade complete — the road is blocked.");
          }
        }
        return;
      }

      if (v.state === "moving" && v.moveTarget) {
        if (this.peonRetaliate(v, team)) return;
        moveTowards(v.pos, v.moveTarget, v.speed, dt);
        if (dist(v.pos, v.moveTarget) < 3) {
          v.moveTarget = undefined;
          v.state = "idle";
        }
        return;
      }

      if (v.state === "patrolling" && v.patrolA && v.patrolB) {
        this.stepPeonPatrol(v, team, dt);
        return;
      }

      if (v.state === "defend") {
        if (!v.forcedAttack && this.stepPeonGuard(v, team, dt)) return;
        const forcedTarget = v.forcedAttack
          ? this.state.units.find((u) => u.id === v.targetEnemyId && u.team !== team && u.hp > 0)
          : undefined;
        if (!underAttack && !forcedTarget) {
          v.state = "idle";
          v.targetEnemyId = undefined;
          v.forcedAttack = false;
          return;
        }
        const target = forcedTarget ?? this.pickPeonTarget(threats, peonIndex, v.targetEnemyId);
        v.targetEnemyId = target?.id;
        if (!target) {
          v.state = "idle";
          v.forcedAttack = false;
          return;
        }
        if (dist(v.pos, target.pos) > PEON_MELEE_RANGE) {
          moveTowards(v.pos, target.pos, PEON_FIGHT_SPEED, dt);
        } else if (v.attackTimer <= 0) {
          // Barracks soldiers and wave creeps both take peon damage — no immunity.
          target.hp -= PEON_DAMAGE;
          v.attackTimer = PEON_ATTACK_CD;
          this.addFloat(`-${PEON_DAMAGE}`, target.pos.x, target.pos.y - 8, "#c8e090");
        }
        return;
      }

      const node = v.targetNodeId ? this.state.nodes.find((n) => n.id === v.targetNodeId) : undefined;

      // Melee retaliation only. Gather, return, and idle do not hunt.
      if (this.peonRetaliate(v, team)) return;

      if (!node && (v.state === "toNode" || v.state === "gathering")) {
        v.state = "idle";
        v.targetNodeId = undefined;
      }
      if (v.state === "toNode" && node) {
        if (node.loadsLeft <= 0) {
          if (dist(v.pos, node.pos) > 4) moveTowards(v.pos, node.pos, v.speed, dt);
          return;
        }
        moveTowards(v.pos, node.pos, v.speed, dt);
        if (dist(v.pos, node.pos) < 3) {
          v.state = "gathering";
          v.timer = node.gatherTime;
        }
      } else if (v.state === "gathering" && node) {
        if (node.loadsLeft <= 0) {
          v.state = "toNode";
          return;
        }
        v.timer -= dt;
        if (v.timer <= 0) {
          node.loadsLeft -= 1;
          const brain = foeBrainStats();
          const mult =
            team === "you"
              ? gMult
              : gMult * (1 + Math.min(0.24, brain.games * 0.012));
          v.carryingGold = Math.round(node.goldPerLoad * mult);
          v.carryingWood = Math.round(node.woodPerLoad * mult);
          v.state = "toKeep";
        }
      } else if (v.state === "toKeep") {
        moveTowards(v.pos, keep.pos, v.speed, dt);
        if (dist(v.pos, keep.pos) < 8) {
          if (v.carryingGold > 0) {
            this.state.gold[team] = (this.state.gold[team] ?? 0) + v.carryingGold;
            if (this.state.stats[team]) this.state.stats[team]!.goldEarned += v.carryingGold;
            this.addFloat(
              `+${v.carryingGold}g`,
              keep.pos.x + (team === "you" ? -20 : 20),
              keep.pos.y - 30,
              team === "you" ? "#8cd6ff" : "#ff9eb2",
            );
          }
          if (v.carryingWood > 0) {
            this.state.wood[team] = (this.state.wood[team] ?? 0) + v.carryingWood;
            this.addFloat(
              `+${v.carryingWood}w`,
              keep.pos.x + (team === "you" ? 20 : -20),
              keep.pos.y - 42,
              "#c8a878",
            );
          }
          v.carryingGold = 0;
          v.carryingWood = 0;
          if (v.targetNodeId) v.state = "toNode";
          else v.state = "idle";
        }
      } else if (v.state === "home") {
        moveTowards(v.pos, keep.pos, v.speed, dt);
        if (dist(v.pos, keep.pos) < 6) v.state = "idle";
      }
    });
  }

  private finishMatch(reason: string, won: boolean | null) {
    const s = this.state;
    if (s.phase === "ended") return;
    s.phase = "ended";
    s.endReason = reason;
    s.won = won;
    if (this.episodes.size > 0) {
      const brain = getFoeBrain();
      const wonByAi = won === null ? null : !won;
      for (const ep of this.episodes.values()) brain.settleEpisode(ep, wonByAi);
      this.episodes.clear();
    }
    notifyAiMatchEnd(won);
    if (won !== null) {
      const { gain, leveledUp } = awardMatchXp({
        won,
        slain: s.stats.you.slain,
        waves: s.waveIndex,
        goldEarned: s.stats.you.goldEarned,
      });
      s.lastXpGain = gain;
      s.keepLevel = loadMeta().level;
      if (leveledUp) {
        this.addToast(`Keep Level ${s.keepLevel} — new campaign map awaits`);
      }
    }
  }

  update(rawDt: number) {
    const s = this.state;
    const dt = Math.min(0.05, rawDt) * s.speed;
    s.toasts.forEach((t) => (t.life -= dt));
    s.toasts = s.toasts.filter((t) => t.life > 0);
    for (const f of s.floatingTexts) {
      f.life -= dt;
      f.rise += 18 * dt;
    }
    s.floatingTexts = s.floatingTexts.filter((f) => f.life > 0);
    for (const event of s.combatEvents) event.life -= dt;
    s.combatEvents = s.combatEvents.filter((event) => event.life > 0);
    for (const marker of s.commandMarkers) marker.life -= dt;
    s.commandMarkers = s.commandMarkers.filter((marker) => marker.life > 0);
    s.redFlash = Math.max(0, s.redFlash - dt);
    s.shake = Math.max(0, s.shake - dt);
    for (const team of this.activeTeams()) {
      const k = s.keeps[team];
      if (!k) continue;
      k.hitFlash = Math.max(0, k.hitFlash - dt);
      k.attackFlash = Math.max(0, k.attackFlash - dt);
    }
    for (const b of s.buildings) b.animKick = Math.max(0, b.animKick - dt);

    if (s.phase !== "running" || s.paused) return;

    s.time += dt;
    this.updateResourceRegen(dt);

    if (s.wavePhase === "build") {
      s.buildTimer -= dt;
      if (s.buildTimer <= 0 && s.waveIndex < WAVES.length) {
        this.launchNextWave();
      }
    } else if (s.wavePhase === "spawning") {
      if (s.pendingWaveUnits.length > 0) {
        s.waveSpawnTimer -= dt;
        if (s.waveSpawnTimer <= 0) {
          const idx = s.pendingWaveUnits.findIndex((x) => x.team === s.waveSpawnSide);
          const pick = idx >= 0 ? s.pendingWaveUnits.splice(idx, 1)[0] : s.pendingWaveUnits.shift();
          if (pick) {
            this.spawnUnit(pick.team, pick.kind, pick.lane, false);
            const order = this.activeTeams();
            const at = order.indexOf(s.waveSpawnSide);
            s.waveSpawnSide = order[(at + 1) % order.length];
            s.waveSpawnTimer = WAVE_UNIT_GAP;
          }
        }
      } else {
        s.wavePhase = "fighting";
      }
    } else if (s.wavePhase === "fighting") {
      if (!this.waveCreepsAlive() && s.pendingWaveUnits.length === 0) {
        this.onWaveCleared();
      }
    }

    if (this.isTriangle()) {
      for (const team of ["foe", "east"] as Team[]) {
        if (!this.keepAlive(team)) continue;
        this.withAiSide(team, () => this.manageFoePeonDefense());
      }
    } else {
      this.manageFoePeonDefense();
    }
    for (const team of this.actingTeams()) this.updateVillagers(dt, team);

    if (this.isTriangle()) {
      for (const team of ["foe", "east"] as Team[]) {
        if (!this.keepAlive(team)) continue;
        const clock = this.sideAi.get(team);
        if (!clock) continue;
        clock.timer -= dt;
        if (clock.timer <= 0) {
          const episode = this.episodes.get(team);
          this.withAiSide(team, () => runAiTurn(this, AI_RESERVE, team, episode));
          clock.timer = thinkInterval(foeBrainStats().intellect);
        }
      }
    } else {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) {
        runAiTurn(this, AI_RESERVE);
        const iq = foeBrainStats().intellect;
        this.aiTimer = thinkInterval(iq);
      }
    }

    for (const team of this.actingTeams()) {
      this.doTowerCombat(dt, team);
      this.doKeepCombat(dt, team);
      this.doBarracks(dt, team);
      this.updateUnitMovementAndMelee(dt, team);
    }
    this.tickPeonQueues(dt);
    this.cleanupDeaths();
    this.cleanupDeadPeons();
    const livingPeons = new Set(s.villagers.filter((v) => v.team === "you").map((v) => v.id));
    s.selectedVillagerIds = s.selectedVillagerIds.filter((id) => livingPeons.has(id));

    if (this.isTriangle()) {
      const foes: Team[] = ["foe", "east"];
      const youDown = s.keeps.you.hp <= 0;
      const foesDown = foes.every((t) => (s.keeps[t]?.hp ?? 0) <= 0);
      if (youDown && foesDown) {
        this.finishMatch("Stalemate. Every keep is broken.", null);
        return;
      }
      if (youDown) {
        this.finishMatch("Defeat. Your keep has fallen.", false);
        return;
      }
      for (const team of foes) {
        if ((s.keeps[team]?.hp ?? 0) <= 0) this.eliminateTeam(team);
      }
      if (foes.every((t) => !this.keepAlive(t))) {
        this.finishMatch("Victory. Both enemy keeps have fallen.", true);
        return;
      }
    } else {
      if (s.keeps.you.hp <= 0 && s.keeps.foe.hp <= 0) {
        this.finishMatch("Stalemate. Both keeps are broken.", null);
        return;
      }
      if (s.keeps.foe.hp <= 0) {
        this.finishMatch("Victory. Their keep is broken.", true);
        return;
      }
      if (s.keeps.you.hp <= 0) {
        this.finishMatch("Defeat. Your keep has fallen.", false);
        return;
      }
    }
    if (
      s.allWavesLaunched &&
      s.wavesCleared >= WAVES.length &&
      s.pendingWaveUnits.length === 0 &&
      s.units.length === 0
    ) {
      const foeHp = this.isTriangle()
        ? Math.max(s.keeps.foe?.hp ?? 0, s.keeps.east?.hp ?? 0)
        : s.keeps.foe.hp;
      if (s.keeps.you.hp > foeHp) this.finishMatch("Victory by stone. Your keep held stronger.", true);
      else if (s.keeps.you.hp < foeHp) {
        this.finishMatch(
          this.isTriangle() ? "Defeat by stone. An enemy keep held stronger." : "Defeat by stone. The foe held stronger.",
          false,
        );
      } else this.finishMatch("Stalemate. Equal keep stone after the siege.", null);
    }
  }

  private withAiSide(team: Team, fn: () => void) {
    const clock = this.sideAi.get(team);
    const prevSide = this.aiSide;
    const prevRead = this.aiRead;
    const prevDeadline = this.aiRushDeadline;
    const prevSeen = this.aiSeenLevyIds;
    const prevSlain = this.aiSlainAtWave;
    this.aiSide = team;
    if (clock) {
      this.aiRead = clock.read;
      this.aiRushDeadline = clock.rushDeadline;
      this.aiSeenLevyIds = clock.seenLevyIds;
      this.aiSlainAtWave = clock.slainAtWave;
    }
    fn();
    if (clock) {
      clock.read = this.aiRead;
      clock.rushDeadline = this.aiRushDeadline;
      clock.seenLevyIds = this.aiSeenLevyIds;
      clock.slainAtWave = this.aiSlainAtWave;
    }
    this.aiSide = prevSide;
    this.aiRead = prevRead;
    this.aiRushDeadline = prevDeadline;
    this.aiSeenLevyIds = prevSeen;
    this.aiSlainAtWave = prevSlain;
  }

  getTeamGold(team: Team) {
    return this.state.gold[team];
  }

  spend(team: Team, amount: number) {
    const gold = this.state.gold[team];
    if (gold === undefined) return;
    this.state.gold[team] = gold - amount;
  }

  getBuildings(team: Team) {
    return this.state.buildings.filter((b) => b.team === team);
  }

  getPads(team: Team) {
    return this.state.pads.filter((p) => p.team === team);
  }

  placeAiBuilding(kind: BuildingKind, reserve = AI_RESERVE) {
    const team = this.aiSide;
    const cost = BUILD_COST[kind];
    if ((this.state.gold[team] ?? 0) < cost.gold + reserve) return false;
    if ((this.state.wood[team] ?? 0) < cost.wood) return false;
    const pads = this.getPads(team);
    const occ = new Set(this.getBuildings(team).map((b) => b.padId));
    const wantZone = kind === "house" ? "eco" : "combat";
    const laneDefense = [0, 0];
    for (const building of this.getBuildings(team)) {
      if (building.kind === "house" || building.kind === "barracks") continue;
      const pad = pads.find((p) => p.id === building.padId);
      if (!pad) continue;
      if (pad.laneCoverage === 2) {
        laneDefense[0] += 1;
        laneDefense[1] += 1;
      } else {
        laneDefense[pad.laneCoverage] += 1;
      }
    }
    const target = pads
      .filter((p) => !occ.has(p.id) && p.zone === wantZone)
      .sort((a, b) => {
        if (kind === "house") return a.pos.y - b.pos.y;
        const aCoverage =
          a.laneCoverage === 2
            ? Math.min(laneDefense[0], laneDefense[1]) - 0.25
            : laneDefense[a.laneCoverage];
        const bCoverage =
          b.laneCoverage === 2
            ? Math.min(laneDefense[0], laneDefense[1]) - 0.25
            : laneDefense[b.laneCoverage];
        return aCoverage - bCoverage || a.pos.y - b.pos.y;
      })[0];
    if (!target) return false;
    this.spendRes(team, cost);
    this.state.buildings.push({
      id: this.next(),
      team,
      kind,
      padId: target.id,
      pos: { ...target.pos },
      spent: cost.gold,
      spentWood: cost.wood,
      canRefund: true,
      damageRank: 0,
      rateRank: 0,
      attackTimer: 0,
      trainTimer: 0,
      animKick: 0,
      queue: [],
    });
    return true;
  }

  private aiObservedHumanUnits(maxY = 430) {
    return this.state.units.filter((u) => u.team === "you" && u.pos.y <= maxY);
  }

  aiBuildDefensiveBarricade(preferredLane?: 0 | 1) {
    const cost = BUILD_COST.barricade;
    const existing = this.state.barricades.filter((b) => b.team === this.aiSide);
    const answeringRush = veryHard(foeBrainStats().intellect) && this.aiRead.rush;
    const maxBarricades = answeringRush || this.state.waveIndex >= 4 ? 2 : 1;
    if (existing.length >= maxBarricades) return false;
    if (this.state.gold[this.aiSide]! < cost.gold + 20 || this.state.wood[this.aiSide]! < cost.wood + 30) return false;
    if (this.aiObservedHumanUnits(205).length > 0) return false;

    const observed = this.aiObservedHumanUnits();
    const lanePressure = [0, 0];
    for (const unit of observed) lanePressure[unit.lane] += unit.kind === "rammer" ? 3 : 1;
    for (const barricade of existing) lanePressure[barricade.lane] = -100;
    let lane = (lanePressure[1] > lanePressure[0] ? 1 : 0) as 0 | 1;
    if (preferredLane !== undefined && !existing.some((b) => b.lane === preferredLane)) {
      lane = preferredLane;
    } else if (lanePressure[0] === lanePressure[1]) {
      lane = ((this.state.waveIndex + existing.length) % 2) as 0 | 1;
    }
    if (existing.some((b) => b.lane === lane)) lane = (lane === 0 ? 1 : 0);
    if (existing.some((b) => b.lane === lane)) return false;

    const y = 210 + existing.length * 38;
    const x =
      (lanePathX(this.activeMap.seed, "you", lane, y) +
        lanePathX(this.activeMap.seed, this.aiSide, lane, y)) /
      2;
    const builder = this.state.villagers
      .filter(
        (v) =>
          v.team === this.aiSide &&
          v.state !== "garrisoned" &&
          v.state !== "toGarrison" &&
          v.state !== "defend" &&
          v.state !== "toBarricade" &&
          v.state !== "buildingBarricade",
      )
      .sort((a, b) => {
        const aIdle = a.state === "idle" || a.state === "home" ? 0 : 1;
        const bIdle = b.state === "idle" || b.state === "home" ? 0 : 1;
        return aIdle - bIdle || dist(a.pos, { x, y }) - dist(b.pos, { x, y });
      })[0];
    if (!builder) return false;

    if (builder.targetNodeId) {
      const node = this.state.nodes.find((n) => n.id === builder.targetNodeId);
      if (node) node.workers = Math.max(0, node.workers - 1);
    }
    this.spendRes(this.aiSide, cost);
    const barricade = {
      id: this.next(),
      team: this.aiSide,
      lane,
      pos: { x, y },
      hp: 6,
      maxHp: 6,
      buildProgress: 0,
      buildTime: 3,
      built: false,
      builderId: builder.id,
    };
    this.state.barricades.push(barricade);
    builder.targetNodeId = undefined;
    builder.targetEnemyId = undefined;
    builder.targetBarricadeId = barricade.id;
    builder.state = "toBarricade";
    this.addToast(`Enemy peons fortify the ${lane === 0 ? "west" : "east"} road.`);
    return true;
  }

  /** Live human read. Kept on the sim so the next think still knows the plan. */
  readHumanForAi(): HumanAiRead {
    const s = this.state;
    const yours = s.buildings.filter((b) => b.team === "you");
    const humanUnits = s.units.filter((u) => u.team === "you" && u.hp > 0);
    const levies = humanUnits.filter((u) => u.kind === "levy");
    const barracksLevies = levies.filter((u) => u.fromBarracks);
    const peons = s.villagers.filter((v) => v.team === "you" && v.hp > 0);
    const fieldPeons = peons.filter((v) => v.state !== "garrisoned");
    const onResource = (kind: "pine" | "copper") =>
      fieldPeons.filter((v) => {
        const node = s.nodes.find((n) => n.id === v.targetNodeId);
        return (
          node?.kind === kind &&
          (v.state === "toNode" || v.state === "gathering" || v.state === "toKeep")
        );
      }).length;
    const humanBarracks = yours.filter((b) => b.kind === "barracks");
    const queuedLevies = humanBarracks.reduce(
      (n, b) => n + b.queue.filter((job) => job.kind === "levy").length,
      0,
    );
    const levyIds = barracksLevies.map((u) => u.id);
    const recentLevies = levyIds.filter((id) => !this.aiSeenLevyIds.includes(id)).length;
    this.aiSeenLevyIds = levyIds;

    const moving = barracksLevies.filter((u) => u.pos.y < 580);
    const near = barracksLevies.filter((u) => u.pos.y <= 460);
    const massing =
      humanBarracks.length > 0 &&
      (queuedLevies >= 2 ||
        barracksLevies.length >= 3 ||
        (recentLevies >= 2 && barracksLevies.length >= 2));
    const movingUp = moving.length >= 3;
    const rush = massing || movingUp;
    const rushNear = near.length >= 2 || (movingUp && moving.some((u) => u.pos.y <= 420));

    const laneScore = [0, 0];
    for (const unit of moving.length > 0 ? moving : barracksLevies) laneScore[unit.lane] += 1;
    const rushLane = (laneScore[1] > laneScore[0] ? 1 : 0) as 0 | 1;

    const army = humanUnits.filter((u) => u.pos.y > 80 && u.pos.y < 660);
    const armyY = army.length
      ? army.reduce((sum, u) => sum + u.pos.y, 0) / army.length
      : s.keeps.you.pos.y;
    const parked = army.filter((u) => u.fromBarracks && u.pos.y > 220 && u.pos.y < 560);
    const foeTrading = s.units.filter(
      (u) => u.team === this.aiSide && u.fromBarracks && u.hp > 0 && !u.aiHeldForRush,
    );
    const losingPieces =
      s.stats[this.aiSide]!.slain > this.aiSlainAtWave && foeTrading.length < parked.length;
    let attrition =
      parked.length >= 4 || (parked.length >= 3 && (losingPieces || foeTrading.length > 0));
    if (this.aiRead.attrition && parked.length >= 2) attrition = true;
    if (parked.length < 2) attrition = false;

    this.aiRead = {
      levies: barracksLevies.length,
      runners: humanUnits.filter((u) => u.kind === "runner").length,
      rammers: humanUnits.filter((u) => u.kind === "rammer").length,
      archers: humanUnits.filter((u) => u.kind === "archer").length,
      ballistae: yours.filter((b) => b.kind === "ballista").length,
      catapults: yours.filter((b) => b.kind === "catapult").length,
      watchtowers: yours.filter((b) => b.kind === "watchtower").length,
      peonsField: fieldPeons.length,
      peonsGarrison: peons.length - fieldPeons.length,
      peonsWood: onResource("pine"),
      peonsGold: onResource("copper"),
      forwardPeons: fieldPeons.filter((v) => v.pos.y < 520).length,
      barracks: humanBarracks.length,
      houses: yours.filter((b) => b.kind === "house").length,
      keepHp: s.keeps.you.hp,
      queuedLevies,
      recentLevies,
      hasRally: humanBarracks.some((b) => !!b.rallyPoint),
      armyY,
      rushLane,
      rush,
      rushNear,
      attrition,
    };
    return this.aiRead;
  }

  foeWaveHolding() {
    return this.state.units.some(
      (u) => u.team === this.aiSide && u.fromBarracks && u.aiHeldForRush && u.hp > 0,
    );
  }

  /** Towers, a barricade on the rush lane, and a barracks so archers can answer. */
  aiAnswerLevyRush() {
    if (!veryHard(foeBrainStats().intellect) || !this.aiRead.rush) return false;
    const read = this.aiRead;
    let acted = false;
    const defenses = this.getBuildings(this.aiSide).filter(
      (b) => b.kind === "watchtower" || b.kind === "ballista" || b.kind === "catapult",
    );
    const wantTowers = read.rushNear ? 3 : 2;
    if (defenses.length < wantTowers) {
      const kind = defenses.length >= 2 ? "ballista" : "watchtower";
      if (this.placeAiBuilding(kind, 0)) acted = true;
    }
    if (this.aiBuildDefensiveBarricade(read.rushLane)) acted = true;
    const barracks = this.getBuildings(this.aiSide).filter((b) => b.kind === "barracks");
    if (barracks.length === 0 && defenses.length >= 1) {
      if (this.placeAiBuilding("barracks", 0)) acted = true;
    }
    return acted;
  }

  private wavePool() {
    const bars = this.state.buildings.filter((b) => b.team === this.aiSide && b.kind === "barracks");
    const queued = bars.flatMap((b) => b.queue.map((job) => job.kind));
    const force = this.state.units.filter((u) => u.team === this.aiSide && u.fromBarracks && u.hp > 0);
    const count = (kind: TrainKind) =>
      force.filter((u) => u.kind === kind).length + queued.filter((k) => k === kind).length;
    return {
      levy: count("levy"),
      runner: count("runner"),
      archer: count("archer"),
      ward: count("ward"),
      rammer: count("rammer"),
      total: force.length + queued.length,
    };
  }

  /** Next roles for one mixed wave, chosen from the human's field. Empty when the wave is full. */
  private waveKindOrder(skill: number): TrainKind[] {
    const read = this.aiRead;
    const have = this.wavePool();
    const target = waveSizeTarget(skill);
    if (have.total >= target) return [];
    const towers = read.watchtowers + read.ballistae + read.catapults;
    const wantSiege = towers >= 2 || read.ballistae + read.catapults > 0;
    const wantRunner = read.archers >= 2 || read.forwardPeons >= 2 || read.peonsField >= 4;
    const order: TrainKind[] = [];
    const push = (kind: TrainKind, cap: number) => {
      if (have[kind] < cap) order.push(kind);
    };
    if (read.rush) {
      // Archers and a ward shoot and soak the levy mass. Rams are only for buildings.
      push("archer", 2);
      push("ward", 1);
      push("levy", 2);
      if (wantSiege) push("rammer", 1);
    } else {
      if (wantSiege) push("rammer", 1);
      push("archer", read.levies >= 3 ? 2 : 1);
      if (wantRunner) push("runner", 1);
      if (read.archers >= 2) push("ward", 1);
      push("levy", Math.max(2, target - 3));
    }
    if (order.length === 0 && have.total < target) {
      const fillers: TrainKind[] = ["levy", "archer", "runner", "ward", "rammer"];
      fillers.sort((a, b) => have[a] - have[b]);
      order.push(fillers[0]);
    }
    return order;
  }

  /** Queue the missing pieces of the current wave. Returns the last kind actually bought. */
  aiFillWave(skill: number): TrainKind | null {
    const bars = this.state.buildings.filter((b) => b.team === this.aiSide && b.kind === "barracks");
    if (bars.length === 0) return null;
    if (bars.every((b) => b.queue.length >= 3)) return null;
    const slots = 1 + Math.min(2, Math.floor(executionEdge(skill) / 18));
    let last: TrainKind | null = null;
    for (let n = 0; n < slots; n++) {
      const order = this.waveKindOrder(skill);
      let placed = false;
      for (const kind of order) {
        if (this.aiEnqueueTrain(kind, 0)) {
          last = kind;
          placed = true;
          break;
        }
      }
      if (!placed) break;
    }
    return last;
  }

  aiCoordinateRush(skill: number) {
    const held = this.state.units.filter(
      (u) => u.team === this.aiSide && u.fromBarracks && u.aiHeldForRush && u.hp > 0,
    );
    if (held.length === 0) {
      this.aiRushDeadline = 0;
      return false;
    }
    if (!veryHard(skill)) return this.releaseLearningWarband(skill, held);
    return this.releaseVeryHardWave(skill, held);
  }

  /** Level 8–9. Small groups, and a timeout that does not demand a mixed wave. */
  private releaseLearningWarband(skill: number, held: Unit[]) {
    if (this.aiRushDeadline <= 0) {
      this.aiRushDeadline = this.state.time + rushCommitDelay(skill);
    }

    const immediateDefense = this.aiObservedHumanUnits(245).length > 0;
    const groupSize = Math.min(7, 4 + Math.floor(skill / 35));
    const hasFrontline = held.some((u) => u.kind !== "archer" && u.kind !== "rammer");
    const hasSupport = held.some((u) => u.kind === "archer" || u.kind === "ward");
    const timedOut = this.state.time >= this.aiRushDeadline;
    const release =
      (immediateDefense && held.length >= 2) ||
      (held.length >= groupSize && hasFrontline && hasSupport) ||
      (timedOut && held.length >= 3);
    if (!release) return false;

    const targetLane = this.laneByHumanDefense();
    held.forEach((unit, index) => {
      unit.aiHeldForRush = false;
      unit.aiStagingPoint = undefined;
      unit.rallyPoint = undefined;
      unit.engageFrom = undefined;
      unit.targetUnitId = undefined;
      unit.lane = index % 3 === 2 ? (targetLane === 0 ? 1 : 0) : targetLane;
      if (this.isTriangle()) unit.goalTeam = this.pressureTarget(this.aiSide);
    });
    this.aiRushDeadline = 0;
    this.addToast(`Enemy warband rushes the ${targetLane === 0 ? "west" : "east"} road!`);
    return true;
  }

  /**
   * Level 10+. One staging point, one commit time. Release when the mix is
   * full, or when the safety timer says the hold has gone on long enough.
   * A standing human army is not a reason to send the next single recruit.
   */
  private releaseVeryHardWave(skill: number, held: Unit[]) {
    const targetLane = this.veryHardWaveLane();
    const y = 148;
    const goal = this.isTriangle() ? this.pressureTarget(this.aiSide) : "you";
    const staging = this.isTriangle()
      ? this.pointAlong(this.aiSide, goal, 0.18)
      : {
          x: lanePathX(this.activeMap.seed, this.aiSide, targetLane, y),
          y,
        };
    for (const unit of held) {
      unit.lane = targetLane;
      unit.aiStagingPoint = { ...staging };
    }
    if (this.aiRushDeadline <= 0) {
      this.aiRushDeadline = this.state.time + veryHardHoldSeconds(skill);
    }

    const target = waveSizeTarget(skill);
    const kinds = new Set(held.map((u) => u.kind));
    const front = held.some(
      (u) => u.kind === "levy" || u.kind === "runner" || u.kind === "ward" || u.kind === "rammer",
    );
    const ranged = held.some((u) => u.kind === "archer");
    const siege = held.some((u) => u.kind === "rammer");
    const towers = this.aiRead.watchtowers + this.aiRead.ballistae + this.aiRead.catapults;
    const siegeWanted = towers >= 2 || this.aiRead.ballistae + this.aiRead.catapults > 0;
    const rammer = UNIT_DEFS.rammer;
    const siegeAffordable =
      this.state.gold[this.aiSide]! >= (rammer.cost ?? 40) && this.state.wood[this.aiSide]! >= (rammer.woodCost ?? 0);
    const mixReady =
      front && ranged && kinds.size >= 2 && (!siegeWanted || siege || !siegeAffordable);
    const timedOut = this.state.time >= this.aiRushDeadline;
    // A standing army is not a trickle target: wait for a real group. The
    // extra grace still lets a pair leave so the hold cannot last forever.
    const safetyMin = this.aiRead.attrition ? 3 : 2;
    const overdue = this.state.time >= this.aiRushDeadline + 8;
    const safety = (timedOut && held.length >= safetyMin) || (overdue && held.length >= 2);
    const full = mixReady && held.length >= target;
    if (!(full || (mixReady && timedOut) || safety)) return false;

    for (const unit of held) {
      unit.aiHeldForRush = false;
      unit.aiStagingPoint = undefined;
      unit.rallyPoint = undefined;
      unit.engageFrom = undefined;
      unit.targetUnitId = undefined;
      unit.lane = targetLane;
      if (this.isTriangle()) unit.goalTeam = goal;
    }
    this.aiRushDeadline = 0;
    this.aiSlainAtWave = this.state.stats[this.aiSide]!.slain;
    this.addToast(`Enemy warband rushes the ${targetLane === 0 ? "west" : "east"} road!`);
    return true;
  }

  private laneByHumanDefense(): 0 | 1 {
    const pads = this.getPads("you");
    const laneDefense = [0, 0];
    for (const building of this.getBuildings("you")) {
      if (building.kind === "house" || building.kind === "barracks") continue;
      const pad = pads.find((p) => p.id === building.padId);
      if (!pad) continue;
      if (pad.laneCoverage === 2) {
        laneDefense[0] += 1;
        laneDefense[1] += 1;
      } else {
        laneDefense[pad.laneCoverage] += 1;
      }
    }
    for (const barricade of this.state.barricades.filter((b) => b.team === "you" && b.built)) {
      laneDefense[barricade.lane] += 1.5;
    }
    return (laneDefense[1] < laneDefense[0] ? 1 : 0) as 0 | 1;
  }

  /** Hit the lane the human army is actually on; otherwise the softer keep road. */
  private veryHardWaveLane(): 0 | 1 {
    const human = this.state.units.filter(
      (u) => u.team === "you" && u.hp > 0 && u.pos.y > 180 && u.pos.y < 600,
    );
    if ((this.aiRead.rush || this.aiRead.attrition) && human.length > 0) {
      const lanes = [0, 0];
      for (const unit of human) lanes[unit.lane] += 1;
      if (lanes[0] !== lanes[1]) return (lanes[1] > lanes[0] ? 1 : 0) as 0 | 1;
      if (this.aiRead.rush) return this.aiRead.rushLane;
    }
    return this.laneByHumanDefense();
  }

  aiUpgradeDefense(preference: "damage" | "rate" | "adaptive" = "adaptive") {
    const towers = this.state.buildings.filter(
      (b) => b.team === this.aiSide && b.kind !== "barracks" && b.kind !== "house",
    );
    if (towers.length === 0) return false;
    const observed = this.aiObservedHumanUnits();
    const fast = observed.filter((u) => u.kind === "runner" || u.kind === "raider").length;
    const heavy = observed.filter(
      (u) => u.kind === "brute" || u.kind === "ward" || u.kind === "rammer",
    ).length;
    const desired = preference === "adaptive" ? (fast > heavy ? "rate" : "damage") : preference;
    const laneThreat = [0, 0];
    for (const unit of observed) laneThreat[unit.lane] += unit.kind === "rammer" ? 2 : 1;
    const threatenedLane = (laneThreat[1] > laneThreat[0] ? 1 : 0) as 0 | 1;
    const pads = this.getPads(this.aiSide);

    const ordered = [...towers].sort((a, b) => {
      const padA = pads.find((p) => p.id === a.padId);
      const padB = pads.find((p) => p.id === b.padId);
      const covers = (pad: Pad | undefined) =>
        pad && (pad.laneCoverage === 2 || pad.laneCoverage === threatenedLane) ? 1 : 0;
      const aRank = desired === "damage" ? a.damageRank : a.rateRank;
      const bRank = desired === "damage" ? b.damageRank : b.rateRank;
      return covers(padB) - covers(padA) || aRank - bRank;
    });

    const tryUpgrade = (kind: "damage" | "rate") => {
      const tower = ordered.find((b) => (kind === "damage" ? b.damageRank : b.rateRank) < 2);
      if (!tower) return false;
      const rank = kind === "damage" ? tower.damageRank : tower.rateRank;
      const cost = UPGRADE_COST[rank];
      if (this.state.gold[this.aiSide]! < cost + AI_RESERVE) return false;
      this.spend(this.aiSide, cost);
      if (kind === "damage") tower.damageRank = (tower.damageRank + 1) as 1 | 2;
      else tower.rateRank = (tower.rateRank + 1) as 1 | 2;
      tower.spent += cost;
      return true;
    };
    return tryUpgrade(desired) || tryUpgrade(desired === "damage" ? "rate" : "damage");
  }

  aiUpgradeWeakestTower() {
    return this.aiUpgradeDefense("adaptive");
  }

  aiAssignWorkers() {
    const nodes = this.state.nodes.filter((n) => n.team === this.aiSide && n.loadsLeft > 0);
    const peons = this.state.villagers.filter((v) => v.team === this.aiSide);

    // Reconcile slot counts from actual assignments so interrupted workers do
    // not leave phantom occupancy behind.
    for (const node of this.state.nodes.filter((n) => n.team === this.aiSide)) {
      node.workers = peons.filter((v) => v.targetNodeId === node.id).length;
    }

    const urgentKind =
      this.state.wood[this.aiSide]! < 75
        ? "pine"
        : this.state.gold[this.aiSide]! < 70
          ? "copper"
          : null;
    if (
      urgentKind &&
      !peons.some(
        (v) =>
          v.targetNodeId &&
          nodes.find((n) => n.id === v.targetNodeId)?.kind === urgentKind,
      )
    ) {
      const donor = peons.find((v) => {
        const node = nodes.find((n) => n.id === v.targetNodeId);
        return node && node.kind !== urgentKind && (v.state === "toNode" || v.state === "gathering");
      });
      if (donor?.targetNodeId) {
        const old = nodes.find((n) => n.id === donor.targetNodeId);
        if (old) old.workers = Math.max(0, old.workers - 1);
        donor.targetNodeId = undefined;
        donor.state = "idle";
      }
    }

    let idle = peons.filter((v) => v.state === "idle" || v.state === "home").length;
    while (idle > 0) {
      const lowWood = this.state.wood[this.aiSide]! < 100;
      const lowGold = this.state.gold[this.aiSide]! < 100;
      const target = nodes
        .filter((n) => n.workers < n.maxWorkers)
        .sort((a, b) => {
          const score = (n: typeof a) => {
            const demand =
              n.kind === "pine"
                ? lowWood
                  ? 3
                  : 1
                : lowGold
                  ? 2.6
                  : 1.2;
            return (n.woodPerLoad + n.goldPerLoad) * demand - n.workers * 18;
          };
          return score(b) - score(a);
        })[0];
      if (!target) break;
      this.assignVillagerToNode(target.id, this.aiSide);
      idle -= 1;
    }
  }

  aiEnqueueTrain(kind: TrainKind, reserve = AI_RESERVE) {
    const def = UNIT_DEFS[kind];
    const cost: ResCost = { gold: def.cost ?? 30, wood: def.woodCost ?? 0 };
    if (this.state.gold[this.aiSide]! < cost.gold + reserve) return false;
    if (this.state.wood[this.aiSide]! < cost.wood) return false;
    const bars = this.state.buildings.filter((b) => b.team === this.aiSide && b.kind === "barracks");
    if (bars.length === 0) return false;
    return this.enqueueTrain(kind, this.aiSide);
  }

  aiTrainUnits() {
    if (veryHard(foeBrainStats().intellect)) {
      return this.aiFillWave(foeBrainStats().intellect) !== null;
    }
    const bars = this.state.buildings.filter((b) => b.team === this.aiSide && b.kind === "barracks");
    if (bars.length === 0) return false;
    if (bars.every((b) => b.queue.length >= 3)) return false;
    const gold = this.state.gold[this.aiSide]!;
    const wood = this.state.wood[this.aiSide]!;
    if (gold < AI_RESERVE + 28) return false;
    const observed = this.aiObservedHumanUnits();
    const yourTowers = this.state.buildings.filter(
      (b) => b.team === "you" && b.kind !== "barracks" && b.kind !== "house",
    ).length;
    const ranged = observed.filter((u) => u.kind === "archer").length;
    const fast = observed.filter((u) => u.kind === "runner" || u.kind === "raider").length;
    const heavy = observed.filter(
      (u) => u.kind === "brute" || u.kind === "ward" || u.kind === "rammer",
    ).length;
    const visibleBarricades = this.state.barricades.filter((b) => b.team === "you" && b.built).length;
    const force = this.state.units.filter((u) => u.team === this.aiSide && u.fromBarracks);
    const queuedKinds = bars.flatMap((b) => b.queue.map((job) => job.kind));
    const count = (kind: TrainKind) =>
      force.filter((u) => u.kind === kind).length + queuedKinds.filter((k) => k === kind).length;

    let candidates: TrainKind[];
    if ((visibleBarricades > 0 || yourTowers >= 4) && count("rammer") === 0) {
      candidates = ["rammer", "ward", "runner", "levy"];
    } else if (ranged >= Math.max(2, observed.length * 0.4)) {
      candidates = ["ward", "runner", "archer", "levy"];
    } else if (fast >= Math.max(2, observed.length * 0.4)) {
      candidates = ["archer", "levy", "ward", "runner"];
    } else if (heavy >= 2) {
      candidates = ["levy", "archer", "rammer", "ward"];
    } else {
      const mixed: TrainKind[] = ["levy", "levy", "ward", "archer", "runner"];
      candidates = [...mixed].sort((a, b) => count(a) - count(b));
      if (yourTowers >= 3) candidates.unshift("ward");
    }

    for (const kind of candidates) {
      const def = UNIT_DEFS[kind];
      if (gold >= (def.cost ?? 30) + AI_RESERVE && wood >= (def.woodCost ?? 0)) {
        if (this.enqueueTrain(kind, this.aiSide)) return true;
      }
    }
    return false;
  }

  getUiSnapshot(): UiSnapshot {
    const s = this.state;
    const meta = loadMeta();
    const map = this.activeMap;
    const selected = s.buildings.find((b) => b.id === s.selectedBuildingId);
    const selectedIsYours = !!selected && selected.team === "you";
    const dmgCost = selected && selected.damageRank < 2 ? UPGRADE_COST[selected.damageRank] : 0;
    const rateCost = selected && selected.rateRank < 2 ? UPGRADE_COST[selected.rateRank] : 0;
    const trainQueue =
      selected?.kind === "barracks"
        ? selected.queue.map((j) => ({
            kind: j.kind,
            label: UNIT_DEFS[j.kind].label,
            pct: 1 - j.timeLeft / Math.max(0.01, j.totalTime),
          }))
        : [];
    const trainOptions =
      selected?.kind === "barracks" && selectedIsYours
        ? TRAIN_ORDER.map((kind) => {
            const def = UNIT_DEFS[kind];
            return {
              kind,
              label: def.label,
              blurb: def.blurb,
              cost: def.cost ?? 0,
              woodCost: def.woodCost ?? 0,
              unlocked: unitUnlocked(kind, s.keepLevel),
              lockHint: unlockHint(kind),
            };
          })
        : [];

    const keepSelected = s.selectedKeepTeam === "you";
    const peonQueue = keepSelected
      ? s.keeps.you.peonQueue.map((j) => ({
          kind: "levy" as TrainKind,
          label: "Peon",
          pct: 1 - j.timeLeft / Math.max(0.01, j.totalTime),
        }))
      : [];
    const canUpgradeStructure = !!selected && selectedIsYours && selected.kind !== "house";

    const brain = foeBrainStats();
    const enemyKeeps = (this.isTriangle() ? (["foe", "east"] as Team[]) : (["foe"] as Team[])).map((team) => ({
      team,
      name: this.teamName(team),
      hp: Math.max(0, Math.ceil(s.keeps[team]?.hp ?? 0)),
      down: !this.keepAlive(team),
    }));
    const focus = this.isTriangle() ? this.livingAttackTarget() : "foe";
    return {
      phase: s.phase,
      mapId: s.mapId,
      mapName: map.name,
      mapTagline: map.tagline,
      mapSeed: map.seed,
      campaignLevel: meta.level,
      scoutSalt: meta.scoutSalt,
      paused: s.paused,
      speed: s.speed,
      soundOn: s.soundOn,
      yourHp: Math.max(0, Math.ceil(s.keeps.you.hp)),
      foeHp: Math.max(0, Math.ceil(s.keeps[focus]?.hp ?? 0)),
      yourMaxHp: s.keeps.you.maxHp,
      yourGold: Math.floor(s.gold.you),
      yourWood: Math.floor(s.wood.you),
      foeGold: Math.floor(s.gold.foe),
      foeWood: Math.floor(s.wood.foe),
      waveLabel: `${Math.min(WAVES.length, Math.max(1, s.waveIndex || 1))}/${WAVES.length}`,
      wavePhase: s.wavePhase,
      buildTimer: Math.max(0, s.buildTimer),
      canRush: s.wavePhase === "build" && s.waveIndex < WAVES.length && s.phase === "running",
      totalWaves: WAVES.length,
      toasts: s.toasts.map((t) => t.text),
      buildSelection: s.buildSelection,
      selectedBuildingId: selected?.id ?? null,
      selectedBuildingTeam: selected?.team ?? null,
      selectedBuildingKind: selected?.kind ?? null,
      selectedKeepTeam: s.selectedKeepTeam,
      selectedPeonCount: s.selectedVillagerIds.length,
      selectedRanks: selected ? { damage: selected.damageRank + 1, rate: selected.rateRank + 1 } : null,
      selectedCanUpgradeDamage: canUpgradeStructure && selected!.damageRank < 2,
      selectedCanUpgradeRate: canUpgradeStructure && selected!.rateRank < 2,
      selectedCanRaze: !!selected && selectedIsYours,
      selectedRazeRefund: selected && selectedIsYours ? (selected.canRefund ? Math.floor(selected.spent * 0.5) : 0) : 0,
      selectedRazeRefundWood:
        selected && selectedIsYours ? (selected.canRefund ? Math.floor(selected.spentWood * 0.5) : 0) : 0,
      selectedTrainPct: trainQueue[0]?.pct ?? peonQueue[0]?.pct ?? null,
      selectedUpgradeCost: { damage: dmgCost, rate: rateCost },
      trainQueue,
      trainOptions,
      peonQueue,
      peonCount: s.villagers.filter((v) => v.team === "you").length,
      peonCap: this.peonCap("you"),
      keepGarrisoned: s.villagers.filter((v) => v.team === "you" && v.state === "garrisoned").length,
      keepGarrisonMax: KEEP_GARRISON_MAX,
      canTrainPeon: keepSelected && this.peonSlotsUsed("you") < this.peonCap("you"),
      peonTrainCost: { gold: PEON_TRAIN_GOLD, wood: PEON_TRAIN_WOOD },
      buildCosts: BUILD_COST,
      keepLevel: meta.level,
      keepXp: meta.xp,
      keepXpNext: xpForNextLevel(meta.level),
      keepXpPct: xpProgress(meta.xp, meta.level),
      endReason: s.endReason,
      lastXpGain: s.lastXpGain,
      stats: {
        slain: s.stats.you.slain,
        goldEarned: s.stats.you.goldEarned,
        waves: s.waveIndex,
        yourKeep: Math.max(0, Math.ceil(s.keeps.you.hp)),
        foeKeep: Math.max(0, Math.ceil(s.keeps[focus]?.hp ?? s.keeps.foe.hp)),
      },
      foeIntellect: brain.intellect,
      foeIntellectPct: brain.intellectProgress,
      foeGames: brain.games,
      foeWins: brain.wins,
      foeExplore: brain.epsilon,
      foeLastAction: brain.lastAction,
      players: s.players,
      attackName: this.teamName(focus),
      enemyKeeps,
    };
  }
}

export function hitTest(s: GameState, x: number, y: number): RectHit | null {
  for (const v of s.villagers) {
    if (v.state !== "garrisoned" && dist({ x, y }, v.pos) < 16) {
      return { kind: "villager", id: String(v.id) };
    }
  }
  for (const u of s.units) {
    if (dist({ x, y }, u.pos) < 16) return { kind: "unit", id: String(u.id) };
  }
  for (const b of s.buildings) {
    if (dist({ x, y }, b.pos) < 28) return { kind: "building", id: String(b.id) };
  }
  // Resources win over overlapping pads. This was why right-side groves could be
  // visibly clicked but silently selected the pad underneath.
  for (const n of s.nodes) {
    if (dist({ x, y }, n.pos) < 36) return { kind: "node", id: n.id };
  }
  for (const p of s.pads) {
    if (dist({ x, y }, p.pos) < 26) return { kind: "pad", id: p.id };
  }
  const keepTeams: Team[] = s.players === 3 ? ["you", "foe", "east"] : ["you", "foe"];
  for (const team of keepTeams) {
    const keep = s.keeps[team];
    if (keep && dist({ x, y }, keep.pos) < 40) return { kind: "keep", id: team };
  }
  return null;
}

export function buildingName(kind: BuildingKind) {
  if (kind === "watchtower") return "Watchtower";
  if (kind === "ballista") return "Ballista";
  if (kind === "catapult") return "Catapult";
  if (kind === "house") return "House";
  if (kind === "barricade") return "Barricade";
  return "Barracks";
}

export function padById(pads: Pad[], id: string) {
  return pads.find((p) => p.id === id);
}

export function nodeById(nodes: ResourceNode[], id: string) {
  return nodes.find((n) => n.id === id);
}
