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
  aiWaveStrength,
  combatWaveScale,
  DAMAGE_MULT,
  FIRST_BUILD,
  FOE_SIEGE_Y,
  HOUSE_POP,
  KEEP_THREAT_RADIUS,
  LEVY_VS_WARD_DAMAGE,
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
  RUNNER_CHARGE_DAMAGE,
  RUSH_BONUS,
  openingStash,
  START_KEEP_HP,
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
  type ResCost,
} from "./balance";
import {
  buildNodes,
  buildPads,
  getOrCreateCampaignMap,
  keepPos,
  laneName,
  lanePathX,
  laneStartY,
  laneYGate,
  mapLanes,
  skirmishMap,
  startPadId,
  startPadPos,
  villagerStart,
} from "./map";
import { foeBrainStats, notifyAiMatchEnd, notifyAiMatchStart, runAiTurn } from "./ai";
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
import { snapshotUsable, type MatchSnapshot, type RemoteOrder } from "../net/protocol";
import type {
  Building,
  BuildingKind,
  GameState,
  Lane,
  MapDef,
  Pad,
  RectHit,
  ResourceNode,
  Team,
  TrainKind,
  UiSnapshot,
  Unit,
  UnitKind,
  Villager,
} from "./types";

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Lane with the highest score. Ties keep the earlier lane. */
function topLane(lanes: Lane[], score: (lane: Lane) => number): Lane {
  return lanes.reduce((best, lane) => (score(lane) > score(best) ? lane : best));
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
/** Picture corrections inside the map glide. A real teleport still snaps. */
const POSE_GLIDE = 4096;
/** Own-order prediction eases onto the host picture under this error. */
const PREDICT_EASE = 40;

interface Pose {
  x: number;
  y: number;
  tx: number;
  ty: number;
  a: number;
}

export class GameSim {
  private nextId = 1;
  private state: GameState;
  private aiTimer = 0;
  private aiRushDeadline = 0;
  private activeMap: MapDef;
  private controlGroups = new Map<number, number[]>();
  private matchMode: "ai" | "pvp" = "ai";
  private localTeam: Team = "you";
  private orderSink: ((order: RemoteOrder) => void) | null = null;
  private remoteNote: ((text: string) => void) | null = null;
  private applyingRemote = false;
  /** Pad the local player just ordered. The next picture selects that building. */
  private pendingOwnPad: string | null = null;
  private linkDown = false;
  private shownMap: { id: string; name: string; tagline: string; seed: number } | null = null;
  private poses = new Map<string, Pose>();
  private poseSpan = 0.05;
  private lastPoseAt = 0;
  /** Guest peons whose latest order is drawn locally until the next host picture. */
  private predicted = new Set<number>();

  constructor() {
    const meta = loadMeta();
    this.activeMap = getOrCreateCampaignMap(meta.level, meta.scoutSalt);
    this.state = this.makeFreshState(this.activeMap);
  }

  private makeFreshState(map: MapDef): GameState {
    const meta = loadMeta();
    const stash = openingStash(map.lanes);
    const pads = buildPads(map);
    const nodes = buildNodes(map);
    const youPad = startPadPos(map, "you");
    const foePad = startPadPos(map, "foe");
    const buildings: Building[] = [
      {
        id: this.next(),
        team: "you",
        kind: "watchtower",
        padId: startPadId(map, "you"),
        pos: { ...youPad },
        spent: 60,
        spentWood: 0,
        canRefund: false,
        damageRank: 0,
        rateRank: 0,
        attackTimer: 0,
        trainTimer: 0,
        animKick: 0,
        queue: [],
      },
      {
        id: this.next(),
        team: "foe",
        kind: "watchtower",
        padId: startPadId(map, "foe"),
        pos: { ...foePad },
        spent: 60,
        spentWood: 0,
        canRefund: false,
        damageRank: 0,
        rateRank: 0,
        attackTimer: 0,
        trainTimer: 0,
        animKick: 0,
        queue: [],
      },
    ];
    const villagers = [];
    for (const team of ["you", "foe"] as Team[]) {
      for (let i = 0; i < 2; i++) {
        villagers.push({
          id: this.next(),
          team,
          pos: villagerStart(team, i),
          speed: VILLAGER_SPEED,
          hp: VILLAGER_HP * combatWaveScale(team, 0),
          maxHp: VILLAGER_HP * combatWaveScale(team, 0),
          damage: PEON_DAMAGE * combatWaveScale(team, 0),
          state: "idle" as const,
          timer: 0,
          carryingGold: 0,
          carryingWood: 0,
          attackTimer: 0,
        });
      }
    }
    return {
      phase: "title",
      commandTeam: "you",
      mapId: map.id,
      time: 0,
      paused: false,
      speed: 1,
      soundOn: false,
      audioUnlocked: false,
      keeps: {
        you: {
          team: "you",
          pos: keepPos("you"),
          hp: START_KEEP_HP,
          maxHp: START_KEEP_HP,
          hitFlash: 0,
          attackTimer: 0,
          attackFlash: 0,
          peonQueue: [],
        },
        foe: {
          team: "foe",
          pos: keepPos("foe"),
          hp: START_KEEP_HP,
          maxHp: START_KEEP_HP,
          hitFlash: 0,
          attackTimer: 0,
          attackFlash: 0,
          peonQueue: [],
        },
      },
      gold: { you: stash.gold, foe: stash.gold },
      wood: { you: stash.wood, foe: stash.wood },
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
      stats: {
        you: { slain: 0, goldEarned: 0 },
        foe: { slain: 0, goldEarned: 0 },
      },
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

  setMatchMode(mode: "ai" | "pvp") {
    this.matchMode = mode;
  }

  getMatchMode() {
    return this.matchMode;
  }

  setLocalTeam(team: Team) {
    this.localTeam = team;
    this.state.commandTeam = team;
  }

  getLocalTeam() {
    return this.localTeam;
  }

  setOrderSink(sink: ((order: RemoteOrder) => void) | null) {
    this.orderSink = sink;
  }

  setRemoteNote(note: ((text: string) => void) | null) {
    this.remoteNote = note;
  }

  setLinkDown(down: boolean) {
    this.linkDown = down;
    if (down) this.state.paused = true;
  }

  getActiveMap() {
    return this.activeMap;
  }

  adoptMap(map: MapDef) {
    this.activeMap = map;
    this.state.mapId = map.id;
    this.state.pads = buildPads(map);
    this.state.nodes = buildNodes(map);
    this.shownMap = { id: map.id, name: map.name, tagline: map.tagline, seed: map.seed };
  }

  pushToast(text: string) {
    this.addToast(text);
  }

  /** Guest clocks. Ages the scene from real time without stepping the rules. */
  tickPresentation(rawDt: number) {
    const elapsed = Number.isFinite(rawDt) && rawDt > 0 ? Math.min(1, rawDt) : 0;
    if (this.linkDown) this.state.paused = true;
    this.decayFx(Math.min(0.05, elapsed));
    if (this.state.phase === "running" && !this.state.paused) {
      this.state.time += elapsed * this.state.speed;
      this.stepOwnPrediction(elapsed * this.state.speed);
    }
    this.stepPoses(elapsed);
  }

  /**
   * Visible play keeps a single 50ms slice. A covered host tab wakes in long gaps,
   * so catch up to one second or the guest picture freezes.
   */
  stepMatch(elapsed: number, hidden: boolean) {
    const raw = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    if (!hidden) {
      this.update(Math.min(0.05, raw));
      return;
    }
    let left = Math.min(1, raw);
    let steps = 0;
    while (left > 0.0001 && steps < 24) {
      const step = Math.min(0.05, left);
      this.update(step);
      left -= step;
      steps += 1;
    }
  }

  private redirect(order: RemoteOrder) {
    if (!this.orderSink || this.applyingRemote) return false;
    this.orderSink(order);
    this.previewOwn(order);
    return true;
  }

  /**
   * Draw the guest's own order at once. Opponent pieces, damage, buildings, and
   * stocks stay on the host picture.
   */
  private previewOwn(order: RemoteOrder) {
    if (order.t === "pause" || order.t === "speed" || order.t === "rush") return;
    if (!("team" in order) || order.team !== this.localTeam) return;
    const team = this.localTeam;
    if (order.t === "recall") {
      this.previewRecall(team);
      return;
    }
    if (order.t === "stop") {
      this.stopIds(team, order.ids);
      this.holdPrediction(order.ids);
      return;
    }
    if (order.t === "move" || order.t === "patrol") {
      this.commandIds(team, order.ids, { x: order.x, y: order.y }, null, order.t === "patrol");
      this.holdPrediction(order.ids);
      return;
    }
    if (order.t === "attack") {
      this.commandIds(team, order.ids, { x: 0, y: 0 }, { kind: "unit", id: String(order.targetId) }, false);
      this.holdPrediction(order.ids);
      return;
    }
    if (order.t === "gather") {
      this.commandIds(team, order.ids, { x: 0, y: 0 }, { kind: "node", id: order.nodeId }, false);
      this.holdPrediction(order.ids);
    }
  }

  private holdPrediction(ids: number[]) {
    for (const id of ids) {
      const peon = this.state.villagers.find((v) => v.id === id && v.team === this.localTeam && v.hp > 0);
      if (!peon) continue;
      this.predicted.add(id);
      this.poses.delete("v" + id);
    }
  }

  /** Walk a local order. Does not spend, strike, or move the other team. */
  private stepOwnPrediction(dt: number) {
    if (dt <= 0 || this.predicted.size === 0) return;
    const team = this.localTeam;
    const keep = this.teamKeep(team);
    for (const v of this.state.villagers) {
      if (v.team !== team || !this.predicted.has(v.id) || v.hp <= 0) continue;
      if (v.state === "moving" && v.moveTarget) {
        moveTowards(v.pos, v.moveTarget, v.speed, dt);
        if (dist(v.pos, v.moveTarget) < 3) {
          v.moveTarget = undefined;
          v.state = "idle";
        }
      } else if (v.state === "patrolling" && v.patrolA && v.patrolB) {
        const destination = v.patrolToB ? v.patrolB : v.patrolA;
        moveTowards(v.pos, destination, v.speed, dt);
        if (dist(v.pos, destination) < 3) v.patrolToB = !v.patrolToB;
      } else if (v.state === "toNode" && v.targetNodeId) {
        const node = this.state.nodes.find((n) => n.id === v.targetNodeId);
        if (node && dist(v.pos, node.pos) > 3) moveTowards(v.pos, node.pos, v.speed, dt);
      } else if (v.state === "home" || v.state === "toKeep") {
        moveTowards(v.pos, keep.pos, v.speed, dt);
      } else if (v.state === "defend" && v.forcedAttack && v.targetEnemyId != null) {
        const enemy = this.state.units.find((u) => u.id === v.targetEnemyId && u.team !== team && u.hp > 0);
        if (enemy && dist(v.pos, enemy.pos) > PEON_MELEE_RANGE) moveTowards(v.pos, enemy.pos, PEON_FIGHT_SPEED, dt);
      } else if (v.state === "defend" && v.moveTarget && !v.forcedAttack) {
        if (dist(v.pos, v.moveTarget) > 3) moveTowards(v.pos, v.moveTarget, v.speed, dt);
      }
    }
  }

  private previewRecall(team: Team) {
    const ids: number[] = [];
    for (const v of this.state.villagers) {
      if (v.team !== team || v.hp <= 0 || v.state === "garrisoned") continue;
      v.targetNodeId = undefined;
      v.targetEnemyId = undefined;
      v.targetBarricadeId = undefined;
      v.moveTarget = undefined;
      v.patrolA = undefined;
      v.patrolB = undefined;
      v.patrolToB = undefined;
      v.engageFrom = undefined;
      v.forcedAttack = false;
      v.state = v.carryingGold > 0 || v.carryingWood > 0 ? "toKeep" : "home";
      v.timer = 0;
      ids.push(v.id);
    }
    this.holdPrediction(ids);
    this.tell(team, "🔔 Recall! All peons return to the keep.");
  }

  private tell(team: Team, text: string) {
    if (team === this.localTeam) this.addToast(text);
    else this.remoteNote?.(text);
  }

  private combatScale(team: Team) {
    if (this.matchMode === "pvp") return 1;
    return combatWaveScale(team, this.state.waveIndex);
  }

  /** Reload campaign map for current keep level (+ scout salt). */
  reloadCampaignMap() {
    const meta = loadMeta();
    this.activeMap = getOrCreateCampaignMap(meta.level, meta.scoutSalt);
    this.nextId = 1;
    this.aiTimer = 0;
    this.aiRushDeadline = 0;
    this.shownMap = null;
    this.linkDown = false;
    this.poses.clear();
    this.poseSpan = 0.05;
    this.lastPoseAt = 0;
    this.predicted.clear();
    this.pendingOwnPad = null;
    this.state = this.makeFreshState(this.activeMap);
    this.state.commandTeam = this.localTeam;
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
    if (this.matchMode === "pvp") {
      this.addToast("Skirmish — both keeps are held by players.");
      return;
    }
    notifyAiMatchStart();
    const iq = foeBrainStats().intellect;
    this.addToast(`Build phase — ${FIRST_BUILD}s until wave 1`);
    this.addToast(`Foe intellect ${iq} — learning your patterns`);
  }

  /**
   * Fresh skirmish on a catalog map. The local team stays put: a guest remains
   * `foe` and cannot be written onto the host's side.
   */
  applyRematch(mapId: string, role: "host" | "guest" = this.localTeam === "foe" ? "guest" : "host"): boolean {
    if (this.matchMode !== "pvp") return false;
    if (role === "guest" && this.localTeam !== "foe") return false;
    if (role === "host" && this.localTeam !== "you") return false;
    const map = skirmishMap(mapId);
    if (!map) return false;
    const team = this.localTeam;
    const soundOn = this.state.soundOn;
    const audioUnlocked = this.state.audioUnlocked;
    this.activeMap = map;
    this.nextId = 1;
    this.aiTimer = 0;
    this.aiRushDeadline = 0;
    this.shownMap = { id: map.id, name: map.name, tagline: map.tagline, seed: map.seed };
    this.poses.clear();
    this.poseSpan = 0.05;
    this.lastPoseAt = 0;
    this.predicted.clear();
    this.pendingOwnPad = null;
    this.controlGroups.clear();
    this.state = this.makeFreshState(map);
    this.localTeam = team;
    this.state.commandTeam = team;
    this.state.soundOn = soundOn;
    this.state.audioUnlocked = audioUnlocked;
    this.state.phase = "running";
    this.state.paused = this.linkDown;
    if (this.localTeam !== team || this.state.commandTeam !== team || this.state.mapId !== map.id) return false;
    this.addToast(`Skirmish — ${map.name}.`);
    return true;
  }

  setSound(on: boolean) {
    this.state.soundOn = on;
  }

  unlockAudio() {
    this.state.audioUnlocked = true;
  }

  togglePause() {
    if (this.linkDown) return;
    if (this.redirect({ t: "pause" })) return;
    this.state.paused = !this.state.paused;
  }

  toggleSpeed() {
    if (this.redirect({ t: "speed" })) return;
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
      this.placeBarricadeAt(world);
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
      const peon = this.state.villagers.find((v) => v.id === id && v.team === this.localTeam && v.hp > 0);
      this.state.selectedVillagerIds = peon ? [peon.id] : [];
      this.state.selectedBuildingId = null;
      this.state.selectedKeepTeam = null;
      return;
    }
    if (hit.kind === "node") {
      if (this.orderSink && !this.applyingRemote) {
        let ids = this.peonsById(this.localTeam, this.state.selectedVillagerIds).map((v) => v.id);
        if (ids.length === 0) {
          const chosen = this.chooseGatherer(this.localTeam, hit.id);
          if (chosen) ids = [chosen.id];
        }
        if (ids.length > 0) this.redirect({ t: "gather", team: this.localTeam, ids, nodeId: hit.id });
        return;
      }
      this.assignVillagerToNode(hit.id, this.localTeam);
      return;
    }
    if (hit.kind === "keep" && hit.id === this.localTeam) {
      // Select keep for peon training (double-purpose: also home call via button later)
      this.state.selectedKeepTeam = this.localTeam;
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
          v.team === this.localTeam &&
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
    const alive = new Set(
      this.state.villagers.filter((v) => v.team === this.localTeam && v.hp > 0).map((v) => v.id),
    );
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

  private peonsById(team: Team, ids: number[]) {
    const want = new Set(ids);
    return this.state.villagers.filter((v) => v.team === team && v.hp > 0 && want.has(v.id));
  }

  private chooseGatherer(team: Team, nodeId: string) {
    const node = this.state.nodes.find((n) => n.id === nodeId);
    if (!node) return undefined;
    const free = this.state.villagers.filter(
      (v) =>
        v.team === team &&
        v.hp > 0 &&
        v.state !== "garrisoned" &&
        v.state !== "toGarrison" &&
        v.state !== "toBarricade" &&
        v.state !== "buildingBarricade",
    );
    const idle = free
      .filter((v) => v.state === "idle" || v.state === "home")
      .sort((a, b) => dist(a.pos, node.pos) - dist(b.pos, node.pos))[0];
    if (idle) return idle;
    return [...free].sort((a, b) => dist(a.pos, node.pos) - dist(b.pos, node.pos))[0];
  }

  commandSelected(world: { x: number; y: number }, hit: RectHit | null, patrol = false) {
    const team = this.localTeam;
    const selected = this.peonsById(team, this.state.selectedVillagerIds);
    if (this.orderSink && !this.applyingRemote) {
      if (selected.length === 0) {
        const barracks = this.state.buildings.find(
          (b) => b.id === this.state.selectedBuildingId && b.team === team && b.kind === "barracks",
        );
        if (barracks) this.orderSink({ t: "rally", team, buildingId: barracks.id, x: world.x, y: world.y });
        return;
      }
      const ids = selected.map((v) => v.id);
      if (hit?.kind === "node") {
        this.redirect({ t: "gather", team, ids, nodeId: hit.id });
        return;
      }
      if (hit?.kind === "unit") {
        const enemyTeam: Team = team === "you" ? "foe" : "you";
        const unit = this.state.units.find((u) => u.id === Number(hit.id) && u.team === enemyTeam && u.hp > 0);
        if (unit) {
          this.redirect({ t: "attack", team, ids, targetId: unit.id });
          return;
        }
      }
      this.redirect({ t: patrol ? "patrol" : "move", team, ids, x: world.x, y: world.y });
      return;
    }
    if (selected.length === 0) {
      const barracks = this.state.buildings.find(
        (b) => b.id === this.state.selectedBuildingId && b.team === team && b.kind === "barracks",
      );
      if (barracks) this.setRally(team, barracks.id, world);
      return;
    }
    this.commandIds(
      team,
      selected.map((v) => v.id),
      world,
      hit,
      patrol,
    );
  }

  private commandIds(
    team: Team,
    ids: number[],
    world: { x: number; y: number },
    hit: RectHit | null,
    patrol: boolean,
  ) {
    const selected = this.peonsById(team, ids);
    if (selected.length === 0) return;
    const enemyTeam: Team = team === "you" ? "foe" : "you";

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
      const enemy = this.state.units.find((u) => u.id === Number(hit.id) && u.team === enemyTeam && u.hp > 0);
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

  private setRally(team: Team, buildingId: number, world: { x: number; y: number }) {
    const barracks = this.state.buildings.find(
      (b) => b.id === buildingId && b.team === team && b.kind === "barracks",
    );
    if (!barracks) return;
    barracks.rallyPoint = { ...world };
    this.state.commandMarkers.push({ id: this.next(), kind: "rally", pos: { ...world }, life: 1.4 });
    this.tell(team, "Barracks rally point set.");
  }

  stopSelectedVillagers() {
    if (this.redirect({ t: "stop", team: this.localTeam, ids: [...this.state.selectedVillagerIds] })) return;
    this.stopIds(this.localTeam, this.state.selectedVillagerIds);
  }

  private stopIds(team: Team, ids: number[]) {
    const want = new Set(ids);
    let held = 0;
    for (const v of this.state.villagers) {
      if (v.team !== team || !want.has(v.id) || v.hp <= 0) continue;
      const guard = { ...v.pos };
      this.releasePeonTask(v);
      v.state = "defend";
      v.moveTarget = guard;
      v.forcedAttack = false;
      held += 1;
    }
    if (held > 0) this.tell(team, "Selected peons stopped.");
  }

  /** Direct barricade placement (touch radial menu) — no build-mode round trip. */
  placeBarricadeAt(world: { x: number; y: number }) {
    if (this.state.phase !== "running") return;
    if (this.orderSink && !this.applyingRemote) {
      const builder = this.nearestBuilder(this.localTeam, world);
      this.orderSink({ t: "barricade", team: this.localTeam, x: world.x, y: world.y, builderId: builder?.id });
      return;
    }
    this.tryPlaceBarricade(world, this.localTeam);
  }

  private nearestBuilder(team: Team, world: { x: number; y: number }) {
    return this.state.villagers
      .filter(
        (v) =>
          v.team === team &&
          v.hp > 0 &&
          v.state !== "garrisoned" &&
          v.state !== "toGarrison" &&
          v.state !== "toBarricade" &&
          v.state !== "buildingBarricade",
      )
      .sort((a, b) => dist(a.pos, world) - dist(b.pos, world))[0];
  }

  private tryPlaceBarricade(world: { x: number; y: number }, team: Team, builderId?: number) {
    if (world.y < FOE_SIEGE_Y || world.y > YOU_SIEGE_Y) {
      this.tell(team, "Barricades must be placed on the road between the keeps.");
      return;
    }
    const roads = mapLanes(this.activeMap.seed).map((lane) => ({
      lane,
      x:
        (lanePathX(this.activeMap.seed, "you", lane, world.y) +
          lanePathX(this.activeMap.seed, "foe", lane, world.y)) /
        2,
    }));
    roads.sort((a, b) => Math.abs(a.x - world.x) - Math.abs(b.x - world.x));
    const road = roads[0];
    if (Math.abs(road.x - world.x) > 30) {
      this.tell(team, "Place the barricade directly across a road.");
      return;
    }
    const pos = { x: road.x, y: world.y };
    if (this.state.barricades.some((b) => b.lane === road.lane && Math.abs(b.pos.y - pos.y) < 45)) {
      this.tell(team, "Too close to another barricade.");
      return;
    }
    const cost = BUILD_COST.barricade;
    if (!this.canAfford(team, cost)) {
      this.tell(team, `Need ${cost.gold}g ${cost.wood}w for a barricade.`);
      return;
    }
    const pool = this.state.villagers.filter(
      (v) =>
        v.team === team &&
        v.hp > 0 &&
        v.state !== "garrisoned" &&
        v.state !== "toGarrison" &&
        v.state !== "toBarricade" &&
        v.state !== "buildingBarricade",
    );
    const builder =
      (builderId != null ? pool.find((v) => v.id === builderId) : undefined) ??
      [...pool].sort((a, b) => dist(a.pos, pos) - dist(b.pos, pos))[0];
    if (!builder) {
      this.tell(team, "No peon is available to build.");
      return;
    }
    if (builder.targetNodeId) {
      const node = this.state.nodes.find((n) => n.id === builder.targetNodeId);
      if (node) node.workers = Math.max(0, node.workers - 1);
    }
    this.spendRes(team, cost);
    const barricade = {
      id: this.next(),
      team,
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
    if (team === this.localTeam) this.state.buildSelection = null;
    this.tell(team, "Peon dispatched to construct the barricade.");
  }

  peonCap(team: Team) {
    const houses = this.state.buildings.filter((b) => b.team === team && b.kind === "house").length;
    return BASE_PEON_CAP + houses * HOUSE_POP;
  }

  peonSlotsUsed(team: Team) {
    const alive = this.state.villagers.filter((v) => v.team === team).length;
    const queued = this.state.keeps[team].peonQueue.length;
    return alive + queued;
  }

  canAfford(team: Team, cost: ResCost) {
    return this.state.gold[team] >= cost.gold && this.state.wood[team] >= cost.wood;
  }

  private spendRes(team: Team, cost: ResCost) {
    this.state.gold[team] -= cost.gold;
    this.state.wood[team] -= cost.wood;
  }

  enqueuePeon(team: Team = "you") {
    if (team === this.localTeam && this.redirect({ t: "peon", team })) return true;
    const s = this.state;
    const keep = s.keeps[team];
    if (keep.peonQueue.length >= MAX_PEON_QUEUE) {
      this.tell(team, "Peon queue full.");
      return false;
    }
    if (this.peonSlotsUsed(team) >= this.peonCap(team)) {
      this.tell(team, `Pop cap ${this.peonCap(team)} — build a House.`);
      return false;
    }
    const cost: ResCost = { gold: PEON_TRAIN_GOLD, wood: PEON_TRAIN_WOOD };
    if (!this.canAfford(team, cost)) {
      this.tell(team, `Need ${cost.gold}g to train a peon.`);
      return false;
    }
    this.spendRes(team, cost);
    keep.peonQueue.push({ timeLeft: PEON_TRAIN_TIME, totalTime: PEON_TRAIN_TIME });
    this.tell(team, "Peon queued at the keep.");
    return true;
  }

  callHomeSelected() {
    if (this.state.selectedKeepTeam === this.localTeam) this.callVillagersHome(this.localTeam);
  }

  garrisonVillagers(team: Team) {
    if (team === this.localTeam && this.redirect({ t: "garrison", team })) return;
    const keep = this.teamKeep(team);
    const occupied = this.state.villagers.filter(
      (v) => v.team === team && (v.state === "garrisoned" || v.state === "toGarrison"),
    ).length;
    const open = Math.max(0, KEEP_GARRISON_MAX - occupied);
    if (open === 0) {
      this.tell(team, "Keep garrison is full.");
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
    this.tell(
      team,
      chosen.length > 0 ? `${chosen.length} peon(s) ordered into the keep.` : "No peons available.",
    );
  }

  ungarrisonVillagers(team: Team) {
    if (team === this.localTeam && this.redirect({ t: "ungarrison", team })) return;
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
    if (inside.length > 0) this.tell(team, `${inside.length} peon(s) ungarrisoned.`);
  }

  private tickPeonQueues(dt: number) {
    for (const team of ["you", "foe"] as Team[]) {
      const keep = this.state.keeps[team];
      if (keep.peonQueue.length === 0) continue;
      const job = keep.peonQueue[0];
      job.timeLeft -= dt;
      if (job.timeLeft > 0) continue;
      keep.peonQueue.shift();
      if (this.state.villagers.filter((v) => v.team === team).length >= this.peonCap(team)) continue;
      const idx = this.state.villagers.filter((v) => v.team === team).length;
      const scale = this.combatScale(team);
      this.state.villagers.push({
        id: this.next(),
        team,
        pos: villagerStart(team, idx % 3),
        speed: VILLAGER_SPEED,
        hp: VILLAGER_HP * scale,
        maxHp: VILLAGER_HP * scale,
        damage: PEON_DAMAGE * scale,
        state: "idle",
        timer: 0,
        carryingGold: 0,
        carryingWood: 0,
        attackTimer: 0,
      });
      this.tell(team, "Peon ready.");
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
    return this.state.keeps[team];
  }

  private enemy(team: Team): Team {
    return team === "you" ? "foe" : "you";
  }

  private spawnUnit(team: Team, kind: UnitKind, lane: Lane, fromBarracks: boolean, barracks?: Building) {
    const def = UNIT_DEFS[kind];
    // Wave scalar first, then the barracks upgrade on top. Humans and PvP stay at 1×.
    const scale = this.combatScale(team);
    let hp = def.hp * scale;
    let damage = def.damage * scale;
    let cooldown = def.cooldown;
    if (fromBarracks && barracks) {
      hp *= DAMAGE_MULT[barracks.damageRank];
      damage *= DAMAGE_MULT[barracks.damageRank];
      cooldown *= RATE_MULT[barracks.rateRank];
    }
    const aiHeldForRush = this.matchMode === "ai" && team === "foe" && fromBarracks;
    const stagingY = 138 + lane * 8;
    const u: Unit = {
      id: this.next(),
      team,
      kind,
      lane,
      pos: {
        x: lanePathX(this.activeMap.seed, team, lane, laneStartY(team)),
        y: laneStartY(team),
      },
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
      chargeReady: kind === "runner",
      ignoreEnemyCreeps: !fromBarracks,
      rallyPoint: barracks?.rallyPoint ? { ...barracks.rallyPoint } : undefined,
      aiHeldForRush,
      aiStagingPoint: aiHeldForRush
        ? {
            x: lanePathX(this.activeMap.seed, team, lane, stagingY),
            y: stagingY,
          }
        : undefined,
    };
    this.state.units.push(u);
  }

  /**
   * Living AI soldiers and peons track the new wave. The current HP ratio is
   * kept, so a wounded unit is not healed. Buildings and keeps are left alone.
   */
  private retuneLivingAiCombat(prevWave: number, nextWave: number) {
    if (this.matchMode === "pvp") return;
    const from = aiWaveStrength(prevWave);
    const to = aiWaveStrength(nextWave);
    if (from === to) return;
    const ratio = to / from;
    for (const unit of this.state.units) {
      if (unit.team === "you" || unit.hp <= 0) continue;
      unit.hp *= ratio;
      unit.maxHp *= ratio;
      unit.damage *= ratio;
    }
    for (const villager of this.state.villagers) {
      if (villager.team === "you" || villager.hp <= 0) continue;
      villager.hp *= ratio;
      villager.maxHp *= ratio;
      villager.damage *= ratio;
    }
  }

  private strikeText(dealt: number) {
    const rounded = Math.round(dealt * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  private launchNextWave() {
    const s = this.state;
    if (s.waveIndex >= WAVES.length) return;
    const idx = s.waveIndex;
    this.enqueueWave(idx);
    const prevWave = s.waveIndex;
    s.waveIndex += 1;
    this.retuneLivingAiCombat(prevWave, s.waveIndex);
    s.wavePhase = "spawning";
    s.waveSpawnTimer = 0;
    const income = WAVE_START_INCOME + Math.floor(idx * 3);
    s.gold.you += income;
    s.gold.foe += income;
    s.stats.you.goldEarned += income;
    s.stats.foe.goldEarned += income;
    this.addToast(`Wave ${s.waveIndex}/${WAVES.length} — +${income}g`);
    this.addFloat(`+${income}`, s.keeps.you.pos.x - 30, s.keeps.you.pos.y - 40, "#8cd6ff");
    this.emitCombat("waveHorn", s.keeps.you.pos);
    if (s.waveIndex >= WAVES.length) s.allWavesLaunched = true;
  }

  rushNextWave() {
    // Human skirmish: neither player may skip the build clock. Versus AI still can.
    if (this.matchMode === "pvp") return;
    if (this.redirect({ t: "rush" })) return;
    const s = this.state;
    if (s.phase !== "running" || s.wavePhase !== "build") return;
    if (s.waveIndex >= WAVES.length) return;
    s.gold.you += RUSH_BONUS;
    s.gold.foe += RUSH_BONUS;
    s.stats.you.goldEarned += RUSH_BONUS;
    s.stats.foe.goldEarned += RUSH_BONUS;
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
    s.gold.you += bonus;
    s.gold.foe += bonus;
    s.stats.you.goldEarned += bonus;
    s.stats.foe.goldEarned += bonus;
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
    // Every road gets the same share for both sides, so more roads means a larger wave.
    for (const p of pairs) {
      const perLane = this.splitWave(p.count);
      for (const lane of mapLanes(this.activeMap.seed)) {
        for (let i = 0; i < perLane; i++) {
          this.state.pendingWaveUnits.push({ team: "you", kind: p.kind, lane });
          this.state.pendingWaveUnits.push({ team: "foe", kind: p.kind, lane });
        }
      }
    }
  }

  private assignVillagerToNode(nodeId: string, team: Team = "you") {
    // Resource ownership does not prevent gathering: enemy nodes are raid targets.
    const node = this.state.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    if (node.loadsLeft <= 0) {
      this.tell(team, "Still recovering — wait for regrowth.");
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
    if (team === this.localTeam) {
      this.state.firstVillagerAssigned = true;
      if (node.team !== team) this.tell(team, `Eco raid: peon sent to enemy ${node.kind === "pine" ? "wood" : "gold"}!`);
    }
  }

  callVillagersHome(team: Team) {
    if (team === this.localTeam && this.redirect({ t: "recall", team })) return;
    for (const v of this.state.villagers.filter((a) => a.team === team)) {
      if (v.state === "garrisoned") continue;
      if (v.targetBarricadeId) {
        const site = this.state.barricades.find((b) => b.id === v.targetBarricadeId && !b.built);
        if (site) {
          this.state.barricades = this.state.barricades.filter((b) => b.id !== site.id);
          this.state.gold[team] += BUILD_COST.barricade.gold;
          this.state.wood[team] += BUILD_COST.barricade.wood;
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
    this.tell(team, "🔔 Recall! All peons return to the keep.");
  }

  private tryBuildOnPad(padId: string) {
    const kind = this.state.buildSelection;
    if (!kind) {
      this.addToast("Choose a building below, then tap an empty pad.");
      return;
    }
    if (this.orderSink && !this.applyingRemote) {
      this.orderSink({ t: "build", team: this.localTeam, kind, padId });
      this.state.buildSelection = null;
      this.pendingOwnPad = padId;
      return;
    }
    this.buildFor(this.localTeam, kind, padId);
  }

  private buildFor(team: Team, kind: BuildingKind, padId: string) {
    const s = this.state;
    const pad = s.pads.find((p) => p.id === padId);
    if (!pad) return;
    if (pad.team !== team) {
      this.tell(team, "Enemy ground. You cannot build there.");
      return;
    }
    if (s.buildings.some((b) => b.padId === pad.id)) {
      this.tell(team, "Pad occupied — tap the building to manage it.");
      return;
    }
    if (pad.zone === "eco" && kind !== "house") {
      this.tell(team, "Eco pads behind the keep are for Houses only.");
      return;
    }
    if (pad.zone === "combat" && kind === "house") {
      this.tell(team, "Houses go on eco pads behind your keep.");
      return;
    }
    const cost = BUILD_COST[kind];
    if (!this.canAfford(team, cost)) {
      this.tell(team, `Need ${cost.gold}g ${cost.wood}w for ${buildingName(kind)}.`);
      return;
    }
    this.spendRes(team, cost);
    const id = this.next();
    s.buildings.push({
      id,
      team,
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
    if (team === this.localTeam) {
      s.buildSelection = null;
      s.selectedBuildingId = id;
    }
    this.tell(team, `${buildingName(kind)} raised.`);
  }

  buyUpgrade(kind: "damage" | "rate") {
    const id = this.state.selectedBuildingId;
    if (id == null) return;
    if (this.redirect({ t: "upgrade", team: this.localTeam, buildingId: id, kind })) return;
    this.upgradeBuilding(this.localTeam, id, kind);
  }

  private upgradeBuilding(team: Team, buildingId: number, kind: "damage" | "rate") {
    const s = this.state;
    const b = s.buildings.find((x) => x.id === buildingId && x.team === team);
    if (!b || b.kind === "house") return;
    const rank = kind === "damage" ? b.damageRank : b.rateRank;
    if (rank >= 2) return;
    const cost = UPGRADE_COST[rank];
    if (s.gold[team] < cost) {
      this.tell(team, `Need ${cost} gold.`);
      return;
    }
    s.gold[team] -= cost;
    b.spent += cost;
    if (kind === "damage") b.damageRank = (rank + 1) as 1 | 2;
    else b.rateRank = (rank + 1) as 1 | 2;
    this.tell(team, `${kind} rank ${rank + 2} bought.`);
  }

  razeSelected() {
    const id = this.state.selectedBuildingId;
    if (id == null) return;
    if (this.redirect({ t: "raze", team: this.localTeam, buildingId: id })) return;
    this.razeBuilding(this.localTeam, id);
  }

  private razeBuilding(team: Team, buildingId: number) {
    const s = this.state;
    const b = s.buildings.find((x) => x.id === buildingId && x.team === team);
    if (!b) return;
    const refundG = b.canRefund ? Math.floor(b.spent * 0.5) : 0;
    const refundW = b.canRefund ? Math.floor(b.spentWood * 0.5) : 0;
    s.gold[team] += refundG;
    s.wood[team] += refundW;
    s.buildings = s.buildings.filter((x) => x.id !== b.id);
    if (s.selectedBuildingId === b.id) s.selectedBuildingId = null;
    if (refundG > 0 || refundW > 0) this.tell(team, `Razed for +${refundG}g +${refundW}w.`);
    else this.tell(team, "Razed. The first tower returns no resources.");
  }

  enqueueTrain(kind: TrainKind, team: Team = "you") {
    if (team === this.localTeam) {
      const id = this.state.selectedBuildingId;
      if (this.orderSink && !this.applyingRemote) {
        if (id == null) {
          this.addToast("Select a barracks first.");
          return false;
        }
        this.orderSink({ t: "train", team, kind, buildingId: id });
        return true;
      }
      if (id == null) {
        this.tell(team, "Select a barracks first.");
        return false;
      }
      return this.enqueueTrainAt(team, kind, id);
    }
    const barracks = this.state.buildings
      .filter((x) => x.kind === "barracks" && x.team === "foe")
      .sort((a, c) => a.queue.length - c.queue.length)[0];
    if (!barracks) return false;
    return this.enqueueTrainAt("foe", kind, barracks.id);
  }

  private enqueueTrainAt(team: Team, kind: TrainKind, buildingId: number) {
    const s = this.state;
    const b = s.buildings.find((x) => x.id === buildingId && x.kind === "barracks" && x.team === team);
    if (!b) {
      this.tell(team, "Select a barracks first.");
      return false;
    }
    if (b.queue.length >= MAX_TRAIN_QUEUE) {
      this.tell(team, "Training queue is full.");
      return false;
    }
    if ((this.matchMode === "pvp" || team === this.localTeam) && !unitUnlocked(kind, s.keepLevel)) {
      this.tell(team, unlockHint(kind));
      return false;
    }
    const def = UNIT_DEFS[kind];
    const cost: ResCost = { gold: def.cost ?? 30, wood: def.woodCost ?? 0 };
    if (!this.canAfford(team, cost)) {
      this.tell(team, `Need ${cost.gold}g ${cost.wood}w.`);
      return false;
    }
    this.spendRes(team, cost);
    const trainTime = (def.trainTime ?? 4) * RATE_MULT[b.rateRank];
    b.queue.push({ kind, timeLeft: trainTime, totalTime: trainTime });
    this.tell(team, `${def.label} queued.`);
    return true;
  }

  cancelQueueSlot(index: number) {
    const id = this.state.selectedBuildingId;
    if (id == null) return;
    if (this.redirect({ t: "cancel", team: this.localTeam, buildingId: id, index })) return;
    this.cancelTrainAt(this.localTeam, id, index);
  }

  private cancelTrainAt(team: Team, buildingId: number, index: number) {
    const s = this.state;
    const b = s.buildings.find((x) => x.id === buildingId && x.kind === "barracks" && x.team === team);
    if (!b || index < 0 || index >= b.queue.length) return;
    const job = b.queue[index];
    const def = UNIT_DEFS[job.kind];
    const refundG = Math.floor((def.cost ?? 0) * 0.5);
    const refundW = Math.floor((def.woodCost ?? 0) * 0.5);
    s.gold[team] += refundG;
    s.wood[team] += refundW;
    b.queue.splice(index, 1);
    this.tell(team, `Cancelled (+${refundG}g +${refundW}w).`);
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

  private doTowerCombat(dt: number, team: Team) {
    const enemyTeam = this.enemy(team);
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
        if (v.team !== enemyTeam) return false;
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
        if (u.team !== enemyTeam) return false;
        if (!t.canRefund && dist(u.pos, keep.pos) <= KEEP_THREAT_RADIUS + 30) return true;
        return dist(u.pos, t.pos) <= reach;
      });
      if (inRange.length === 0) continue;
      inRange.sort((a, b) => (team === "you" ? b.pos.y - a.pos.y : a.pos.y - b.pos.y));
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

  private pickLane(team: Team): Lane {
    const laneCounts = [0, 0, 0];
    for (const u of this.state.units) {
      if (u.team !== team && u.pos.y > 100 && u.pos.y < 620) laneCounts[u.lane] += 1;
    }
    return topLane(mapLanes(this.activeMap.seed), (lane) => laneCounts[lane]);
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
      threat.hp -= v.damage;
      v.attackTimer = PEON_ATTACK_CD;
      this.emitCombat("meleeHit", v.pos, threat.pos, team);
      this.addFloat(`-${this.strikeText(v.damage)}`, threat.pos.x, threat.pos.y - 7, "#e8c070");
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
        target.hp -= v.damage;
        v.attackTimer = PEON_ATTACK_CD;
        this.emitCombat("meleeHit", v.pos, target.pos, team);
        this.addFloat(`-${this.strikeText(v.damage)}`, target.pos.x, target.pos.y - 8, "#c8e090");
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
      target.hp -= v.damage;
      v.attackTimer = PEON_ATTACK_CD;
      this.emitCombat("meleeHit", v.pos, target.pos, team);
      this.addFloat(`-${this.strikeText(v.damage)}`, target.pos.x, target.pos.y - 8, "#c8e090");
    }
    return true;
  }

  private militaryAccepts(u: Unit, ent: Unit | Villager, enemyTeam: Team) {
    if (ent.hp <= 0 || ent.team !== enemyTeam) return false;
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
      for (const e of this.state.units) {
        if (!this.militaryAccepts(u, e, enemyTeam)) continue;
        const d = dist(e.pos, origin);
        if (d <= bestD) {
          best = e;
          bestD = d;
        }
      }
      if (!allowPeons) return best;
      for (const v of this.state.villagers) {
        if (!this.militaryAccepts(u, v, enemyTeam)) continue;
        const d = dist(v.pos, origin);
        if (d <= bestD) {
          best = v;
          bestD = d;
        }
      }
      return best;
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

  /** True when a runner is already touching an enemy, so the charge stays spent. */
  private runnerInMelee(u: Unit) {
    const contact = 18;
    const enemyTeam = this.enemy(u.team);
    for (const other of this.state.units) {
      if (other.hp <= 0 || other.team !== enemyTeam) continue;
      if (dist(u.pos, other.pos) <= contact) return true;
    }
    if (!u.fromBarracks) return false;
    for (const villager of this.state.villagers) {
      if (villager.hp <= 0 || villager.team !== enemyTeam || villager.state === "garrisoned") continue;
      if (dist(u.pos, villager.pos) <= contact) return true;
    }
    return false;
  }

  /**
   * Melee damage for a soldier strike. Levies hit wards harder. A runner's
   * first connected strike after closing in is a charge; the cooldown stays
   * the unit's normal attack rate.
   */
  private meleeDamage(attacker: Unit, target: Unit | Villager) {
    let dealt = attacker.damage;
    if (attacker.kind === "levy" && "kind" in target && target.kind === "ward") {
      dealt *= LEVY_VS_WARD_DAMAGE;
    }
    if (attacker.kind === "runner" && attacker.chargeReady !== false) {
      dealt *= RUNNER_CHARGE_DAMAGE;
      attacker.chargeReady = false;
    }
    return dealt;
  }

  private fightMilitary(u: Unit, target: Unit | Villager, team: Team, dt: number) {
    const contact = u.kind === "archer" ? ARCHER_RANGE : 18;
    if (dist(u.pos, target.pos) > contact) {
      moveTowards(u.pos, target.pos, u.speed, dt);
      return;
    }
    if (u.attackTimer > 0) return;
    const ranged = u.kind === "archer";
    const dealt = ranged ? u.damage : this.meleeDamage(u, target);
    target.hp -= dealt;
    u.attackTimer = u.attackCooldown;
    this.emitCombat(ranged ? "arrow" : "meleeHit", u.pos, target.pos, team);
    this.addFloat(
      `-${Math.round(dealt)}`,
      target.pos.x,
      target.pos.y - 7,
      ranged ? "#e8d39a" : "#ffd1cc",
    );
  }

  private updateUnitMovementAndMelee(dt: number, team: Team) {
    const enemyTeam = this.enemy(team);
    for (const u of this.state.units.filter((x) => x.team === team)) {
      u.attackTimer -= dt;
      if (u.kind === "runner" && !this.runnerInMelee(u)) u.chargeReady = true;
      const gateY = laneYGate(team);
      const enemies = this.state.units.filter((e) => e.team === enemyTeam && e.lane === u.lane);
      if (u.fromBarracks) {
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
              v.team === enemyTeam &&
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
          const dealt = this.meleeDamage(u, meleeTarget);
          meleeTarget.hp -= dealt;
          u.attackTimer = u.attackCooldown;
          this.emitCombat("meleeHit", u.pos, meleeTarget.pos, team);
          this.addFloat(`-${Math.round(dealt)}`, meleeTarget.pos.x, meleeTarget.pos.y - 6, "#ffd1cc");
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
      const killer = this.enemy(u.team);
      this.state.gold[killer] += u.bounty;
      this.state.stats[killer].goldEarned += u.bounty;
      this.state.stats[killer].slain += 1;
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

  private isSiegingKeep(team: Team, u: Unit) {
    // Y-band covers BOTH roads; pure radius missed the east gate (~109px from keep).
    if (team === "you") return u.pos.y >= YOU_SIEGE_Y;
    return u.pos.y <= FOE_SIEGE_Y;
  }

  private enemiesThreateningKeep(team: Team) {
    const keep = this.teamKeep(team);
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
    const lanes = mapLanes(this.activeMap.seed);
    const preferredLane = lanes[peonIndex % lanes.length];
    const onLane = threats
      .filter((t) => t.lane === preferredLane)
      .sort((a, b) => priority(b) - priority(a));
    if (onLane.length > 0) return onLane[0];
    return [...threats].sort((a, b) => priority(b) - priority(a))[0];
  }

  private manageFoePeonDefense() {
    const team: Team = "foe";
    const keep = this.teamKeep(team);
    // React before attackers reach the siege line. The old 160-Y trigger gave
    // distant workers too little time to reach the keep and garrison.
    const threats = this.state.units
      .filter((u) => u.team === "you" && u.pos.y <= FOE_SIEGE_Y + 170)
      .sort((a, b) => dist(a.pos, keep.pos) - dist(b.pos, keep.pos));
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
    const economyReserve = critical ? 0 : peons.length > 2 ? 1 : 0;
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
        .filter((v) => v.state !== "garrisoned" && v.state !== "toGarrison")
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

    // Both skirmish players get the same idle-peon defense. Versus AI, only the
    // human side does — the north peons follow their own orders.
    if (underAttack && (this.matchMode === "pvp" || team === "you")) {
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
      if (rallied > 0) this.tell(team, "Peons rally to both roads!");
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
            this.state.gold[team] += v.carryingGold;
            this.state.stats[team].goldEarned += v.carryingGold;
          }
          if (v.carryingWood > 0) this.state.wood[team] += v.carryingWood;
          v.carryingGold = 0;
          v.carryingWood = 0;
          v.state = "garrisoned";
          v.pos = { ...keep.pos };
          this.tell(team, "Peon garrisoned — keep arrows online.");
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
            this.tell(team, "Barricade complete — the road is blocked.");
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
          target.hp -= v.damage;
          v.attackTimer = PEON_ATTACK_CD;
          this.addFloat(`-${this.strikeText(v.damage)}`, target.pos.x, target.pos.y - 8, "#c8e090");
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
            team === "you" || this.matchMode === "pvp"
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
            this.state.gold[team] += v.carryingGold;
            this.state.stats[team].goldEarned += v.carryingGold;
            this.addFloat(
              `+${v.carryingGold}g`,
              keep.pos.x + (team === "you" ? -20 : 20),
              keep.pos.y - 30,
              team === "you" ? "#8cd6ff" : "#ff9eb2",
            );
          }
          if (v.carryingWood > 0) {
            this.state.wood[team] += v.carryingWood;
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
    if (this.matchMode === "pvp") return;
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

  private decayFx(dt: number) {
    const s = this.state;
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
    for (const k of [s.keeps.you, s.keeps.foe]) {
      k.hitFlash = Math.max(0, k.hitFlash - dt);
      k.attackFlash = Math.max(0, k.attackFlash - dt);
    }
    for (const b of s.buildings) b.animKick = Math.max(0, b.animKick - dt);
  }

  update(rawDt: number) {
    const s = this.state;
    const dt = Math.min(0.05, rawDt) * s.speed;
    if (this.linkDown) s.paused = true;
    this.decayFx(dt);

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
            s.waveSpawnSide = s.waveSpawnSide === "you" ? "foe" : "you";
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

    if (this.matchMode === "ai") this.manageFoePeonDefense();
    this.updateVillagers(dt, "you");
    this.updateVillagers(dt, "foe");

    if (this.matchMode === "ai") {
      this.aiTimer -= dt;
      if (this.aiTimer <= 0) {
        runAiTurn(this, AI_RESERVE);
        const iq = foeBrainStats().intellect;
        this.aiTimer = Math.max(0.72, 1.85 - iq * 0.0115);
      }
    }

    this.doTowerCombat(dt, "you");
    this.doTowerCombat(dt, "foe");
    this.doKeepCombat(dt, "you");
    this.doKeepCombat(dt, "foe");
    this.doBarracks(dt, "you");
    this.doBarracks(dt, "foe");
    this.tickPeonQueues(dt);
    this.updateUnitMovementAndMelee(dt, "you");
    this.updateUnitMovementAndMelee(dt, "foe");
    this.cleanupDeaths();
    this.cleanupDeadPeons();
    const livingPeons = new Set(s.villagers.filter((v) => v.team === this.localTeam && v.hp > 0).map((v) => v.id));
    s.selectedVillagerIds = s.selectedVillagerIds.filter((id) => livingPeons.has(id));

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
    if (
      s.allWavesLaunched &&
      s.wavesCleared >= WAVES.length &&
      s.pendingWaveUnits.length === 0 &&
      s.units.length === 0
    ) {
      if (s.keeps.you.hp > s.keeps.foe.hp) this.finishMatch("Victory by stone. Your keep held stronger.", true);
      else if (s.keeps.you.hp < s.keeps.foe.hp) this.finishMatch("Defeat by stone. The foe held stronger.", false);
      else this.finishMatch("Stalemate. Equal keep stone after the siege.", null);
    }
  }

  getTeamGold(team: Team) {
    return this.state.gold[team];
  }

  spend(team: Team, amount: number) {
    this.state.gold[team] -= amount;
  }

  getBuildings(team: Team) {
    return this.state.buildings.filter((b) => b.team === team);
  }

  getPads(team: Team) {
    return this.state.pads.filter((p) => p.team === team);
  }

  /** Towers reaching each road, plus `barricadeWeight` per built barricade on it. Indexed by lane. */
  private laneDefense(team: Team, barricadeWeight: number) {
    const defense = [0, 0, 0];
    const pads = this.getPads(team);
    for (const building of this.getBuildings(team)) {
      if (building.kind === "house" || building.kind === "barracks") continue;
      const pad = pads.find((p) => p.id === building.padId);
      if (!pad) continue;
      for (const lane of pad.laneCoverage) defense[lane] += 1;
    }
    for (const barricade of this.state.barricades) {
      if (barricade.team === team && barricade.built) defense[barricade.lane] += barricadeWeight;
    }
    return defense;
  }

  placeAiBuilding(kind: BuildingKind, reserve = AI_RESERVE) {
    const team: Team = "foe";
    const cost = BUILD_COST[kind];
    if (this.state.gold[team] < cost.gold + reserve) return false;
    if (this.state.wood[team] < cost.wood) return false;
    const pads = this.getPads(team);
    const occ = new Set(this.getBuildings(team).map((b) => b.padId));
    const wantZone = kind === "house" ? "eco" : "combat";
    const laneDefense = this.laneDefense(team, 0);
    // A pad is worth its weakest covered road; multi-road pads get a small nudge.
    const padNeed = (pad: Pad) =>
      Math.min(...pad.laneCoverage.map((lane) => laneDefense[lane])) - (pad.laneCoverage.length > 1 ? 0.25 : 0);
    const target = pads
      .filter((p) => !occ.has(p.id) && p.zone === wantZone)
      .sort((a, b) => {
        if (kind === "house") return a.pos.y - b.pos.y;
        return padNeed(a) - padNeed(b) || a.pos.y - b.pos.y;
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

  aiBuildDefensiveBarricade() {
    const cost = BUILD_COST.barricade;
    const existing = this.state.barricades.filter((b) => b.team === "foe");
    const maxBarricades = this.state.waveIndex >= 4 ? 2 : 1;
    if (existing.length >= maxBarricades) return false;
    if (this.state.gold.foe < cost.gold + 20 || this.state.wood.foe < cost.wood + 30) return false;
    if (this.aiObservedHumanUnits(205).length > 0) return false;

    const observed = this.aiObservedHumanUnits();
    const lanePressure = [0, 0, 0];
    for (const unit of observed) lanePressure[unit.lane] += unit.kind === "rammer" ? 3 : 1;
    const open = mapLanes(this.activeMap.seed).filter((l) => !existing.some((b) => b.lane === l));
    if (open.length === 0) return false;
    // Busiest open road; on a tie, rotate so quiet games still spread walls out.
    const rotation = open[(this.state.waveIndex + existing.length) % open.length];
    const lane = open.reduce((best, l) => (lanePressure[l] > lanePressure[best] ? l : best), rotation);

    const y = 210 + existing.length * 38;
    const x =
      (lanePathX(this.activeMap.seed, "you", lane, y) +
        lanePathX(this.activeMap.seed, "foe", lane, y)) /
      2;
    const builder = this.state.villagers
      .filter(
        (v) =>
          v.team === "foe" &&
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
    this.spendRes("foe", cost);
    const barricade = {
      id: this.next(),
      team: "foe" as Team,
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
    this.addToast(`Enemy peons fortify ${laneName(this.activeMap.seed, lane)} road.`);
    return true;
  }

  aiCoordinateRush(skill: number) {
    const held = this.state.units.filter(
      (u) => u.team === "foe" && u.fromBarracks && u.aiHeldForRush && u.hp > 0,
    );
    if (held.length === 0) {
      this.aiRushDeadline = 0;
      return false;
    }
    if (this.aiRushDeadline <= 0) {
      this.aiRushDeadline = this.state.time + Math.max(6, 10 - skill * 0.04);
    }

    const immediateDefense = this.aiObservedHumanUnits(245).length > 0;
    const groupSize = Math.min(7, 4 + Math.floor(skill / 35));
    const hasFrontline = held.some((u) => u.kind !== "archer" && u.kind !== "rammer");
    const hasSupport = held.some((u) => u.kind === "archer" || u.kind === "ward");
    const timedOut = this.state.time >= this.aiRushDeadline;
    const release =
      (immediateDefense && held.length >= 2) ||
      (held.length >= groupSize && (hasFrontline && hasSupport)) ||
      (timedOut && held.length >= 3);
    if (!release) return false;

    const lanes = mapLanes(this.activeMap.seed);
    const laneDefense = this.laneDefense("you", 1.5);
    const weakest = [...lanes].sort((a, b) => laneDefense[a] - laneDefense[b] || a - b);
    const targetLane = weakest[0];
    // Every third unit feints down the next-weakest road, when there is one.
    const feintLane = weakest[1] ?? targetLane;
    held.forEach((unit, index) => {
      unit.aiHeldForRush = false;
      unit.aiStagingPoint = undefined;
      unit.rallyPoint = undefined;
      unit.engageFrom = undefined;
      unit.targetUnitId = undefined;
      unit.lane = index % 3 === 2 ? feintLane : targetLane;
    });
    this.aiRushDeadline = 0;
    this.addToast(`Enemy warband rushes ${laneName(this.activeMap.seed, targetLane)} road!`);
    return true;
  }

  aiUpgradeDefense(preference: "damage" | "rate" | "adaptive" = "adaptive") {
    const towers = this.state.buildings.filter(
      (b) => b.team === "foe" && b.kind !== "barracks" && b.kind !== "house",
    );
    if (towers.length === 0) return false;
    const observed = this.aiObservedHumanUnits();
    const fast = observed.filter((u) => u.kind === "runner" || u.kind === "raider").length;
    const heavy = observed.filter(
      (u) => u.kind === "brute" || u.kind === "ward" || u.kind === "rammer",
    ).length;
    const desired = preference === "adaptive" ? (fast > heavy ? "rate" : "damage") : preference;
    const laneThreat = [0, 0, 0];
    for (const unit of observed) laneThreat[unit.lane] += unit.kind === "rammer" ? 2 : 1;
    const threatenedLane = topLane(mapLanes(this.activeMap.seed), (lane) => laneThreat[lane]);
    const pads = this.getPads("foe");

    const ordered = [...towers].sort((a, b) => {
      const padA = pads.find((p) => p.id === a.padId);
      const padB = pads.find((p) => p.id === b.padId);
      const covers = (pad: Pad | undefined) => (pad?.laneCoverage.includes(threatenedLane) ? 1 : 0);
      const aRank = desired === "damage" ? a.damageRank : a.rateRank;
      const bRank = desired === "damage" ? b.damageRank : b.rateRank;
      return covers(padB) - covers(padA) || aRank - bRank;
    });

    const tryUpgrade = (kind: "damage" | "rate") => {
      const tower = ordered.find((b) => (kind === "damage" ? b.damageRank : b.rateRank) < 2);
      if (!tower) return false;
      const rank = kind === "damage" ? tower.damageRank : tower.rateRank;
      const cost = UPGRADE_COST[rank];
      if (this.state.gold.foe < cost + AI_RESERVE) return false;
      this.spend("foe", cost);
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
    const nodes = this.state.nodes.filter((n) => n.team === "foe" && n.loadsLeft > 0);
    const peons = this.state.villagers.filter((v) => v.team === "foe");

    // Reconcile slot counts from actual assignments so interrupted workers do
    // not leave phantom occupancy behind.
    for (const node of this.state.nodes.filter((n) => n.team === "foe")) {
      node.workers = peons.filter((v) => v.targetNodeId === node.id).length;
    }

    const urgentKind =
      this.state.wood.foe < 75
        ? "pine"
        : this.state.gold.foe < 70
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
      const lowWood = this.state.wood.foe < 100;
      const lowGold = this.state.gold.foe < 100;
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
      this.assignVillagerToNode(target.id, "foe");
      idle -= 1;
    }
  }

  aiEnqueueTrain(kind: TrainKind) {
    const def = UNIT_DEFS[kind];
    const cost: ResCost = { gold: def.cost ?? 30, wood: def.woodCost ?? 0 };
    if (this.state.gold.foe < cost.gold + AI_RESERVE) return false;
    if (this.state.wood.foe < cost.wood) return false;
    const bars = this.state.buildings.filter((b) => b.team === "foe" && b.kind === "barracks");
    if (bars.length === 0) return false;
    return this.enqueueTrain(kind, "foe");
  }

  aiTrainUnits() {
    const bars = this.state.buildings.filter((b) => b.team === "foe" && b.kind === "barracks");
    if (bars.length === 0) return false;
    if (bars.every((b) => b.queue.length >= 3)) return false;
    const gold = this.state.gold.foe;
    const wood = this.state.wood.foe;
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
    const force = this.state.units.filter((u) => u.team === "foe" && u.fromBarracks);
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
        if (this.enqueueTrain(kind, "foe")) return true;
      }
    }
    return false;
  }

  applyRemoteOrder(order: RemoteOrder) {
    if (this.matchMode !== "pvp" || this.state.phase !== "running") return;
    // A stale client may still send rush. Ignore it for both teams; the match clock launches waves.
    if (order.t === "rush") return;
    // The guest owns the north side only. An order stamped `you` must not spend or move the host.
    if (order.t !== "pause" && order.t !== "speed" && order.team !== "foe") return;
    const team: Team = "foe";
    this.applyingRemote = true;
    try {
      switch (order.t) {
        case "move":
          this.commandIds(team, order.ids, { x: order.x, y: order.y }, null, false);
          break;
        case "patrol":
          this.commandIds(team, order.ids, { x: order.x, y: order.y }, null, true);
          break;
        case "stop":
          this.stopIds(team, order.ids);
          break;
        case "attack":
          this.commandIds(team, order.ids, { x: 0, y: 0 }, { kind: "unit", id: String(order.targetId) }, false);
          break;
        case "gather":
          this.commandIds(team, order.ids, { x: 0, y: 0 }, { kind: "node", id: order.nodeId }, false);
          break;
        case "recall":
          this.callVillagersHome(team);
          break;
        case "build":
          this.buildFor(team, order.kind, order.padId);
          break;
        case "train":
          this.enqueueTrainAt(team, order.kind, order.buildingId);
          break;
        case "peon":
          this.enqueuePeon(team);
          break;
        case "garrison":
          this.garrisonVillagers(team);
          break;
        case "ungarrison":
          this.ungarrisonVillagers(team);
          break;
        case "rally":
          this.setRally(team, order.buildingId, { x: order.x, y: order.y });
          break;
        case "barricade":
          this.tryPlaceBarricade({ x: order.x, y: order.y }, team, order.builderId);
          break;
        case "upgrade":
          this.upgradeBuilding(team, order.buildingId, order.kind);
          break;
        case "raze":
          this.razeBuilding(team, order.buildingId);
          break;
        case "cancel":
          this.cancelTrainAt(team, order.buildingId, order.index);
          break;
        case "pause":
          this.togglePause();
          break;
        case "speed":
          this.toggleSpeed();
          break;
      }
    } finally {
      this.applyingRemote = false;
    }
  }

  exportSnapshot(): MatchSnapshot {
    const s = this.state;
    const map = this.activeMap;
    const keep = (team: Team) => ({
      hp: s.keeps[team].hp,
      maxHp: s.keeps[team].maxHp,
      hitFlash: s.keeps[team].hitFlash,
      attackFlash: s.keeps[team].attackFlash,
      queue: s.keeps[team].peonQueue.map((job) => ({ timeLeft: job.timeLeft, totalTime: job.totalTime })),
    });
    return {
      mapId: s.mapId,
      mapName: map.name,
      mapTagline: map.tagline,
      mapSeed: map.seed,
      time: s.time,
      phase: s.phase,
      paused: s.paused,
      speed: s.speed,
      waveIndex: s.waveIndex,
      wavePhase: s.wavePhase,
      buildTimer: s.buildTimer,
      allWavesLaunched: s.allWavesLaunched,
      wavesCleared: s.wavesCleared,
      won: s.won,
      endReason: s.endReason,
      keepLevel: s.keepLevel,
      gold: { you: s.gold.you, foe: s.gold.foe },
      wood: { you: s.wood.you, foe: s.wood.foe },
      slain: { you: s.stats.you.slain, foe: s.stats.foe.slain },
      goldEarned: { you: s.stats.you.goldEarned, foe: s.stats.foe.goldEarned },
      keeps: { you: keep("you"), foe: keep("foe") },
      units: s.units.map((u) => ({
        id: u.id,
        team: u.team,
        kind: u.kind,
        lane: u.lane,
        x: u.pos.x,
        y: u.pos.y,
        hp: u.hp,
        maxHp: u.maxHp,
        fromBarracks: u.fromBarracks,
        attackTimer: u.attackTimer,
        rallyX: u.rallyPoint?.x,
        rallyY: u.rallyPoint?.y,
      })),
      villagers: s.villagers.map((v) => ({
        id: v.id,
        team: v.team,
        x: v.pos.x,
        y: v.pos.y,
        hp: v.hp,
        maxHp: v.maxHp,
        state: v.state,
        nodeId: v.targetNodeId,
        enemyId: v.targetEnemyId,
        barricadeId: v.targetBarricadeId,
        mx: v.moveTarget?.x,
        my: v.moveTarget?.y,
        ax: v.patrolA?.x,
        ay: v.patrolA?.y,
        bx: v.patrolB?.x,
        by: v.patrolB?.y,
        toB: v.patrolToB,
        forced: v.forcedAttack,
        attackTimer: v.attackTimer,
      })),
      buildings: s.buildings.map((b) => ({
        id: b.id,
        team: b.team,
        kind: b.kind,
        padId: b.padId,
        x: b.pos.x,
        y: b.pos.y,
        spent: b.spent,
        spentWood: b.spentWood,
        canRefund: b.canRefund,
        damageRank: b.damageRank,
        rateRank: b.rateRank,
        animKick: b.animKick,
        queue: b.queue.map((job) => ({ kind: job.kind, timeLeft: job.timeLeft, totalTime: job.totalTime })),
        rallyX: b.rallyPoint?.x,
        rallyY: b.rallyPoint?.y,
      })),
      nodes: s.nodes.map((n) => ({ id: n.id, loadsLeft: n.loadsLeft, workers: n.workers })),
      barricades: s.barricades.map((b) => ({
        id: b.id,
        team: b.team,
        lane: b.lane,
        x: b.pos.x,
        y: b.pos.y,
        hp: b.hp,
        maxHp: b.maxHp,
        buildProgress: b.buildProgress,
        buildTime: b.buildTime,
        built: b.built,
        builderId: b.builderId,
      })),
      pads: s.pads.map((p) => ({
        id: p.id,
        team: p.team,
        x: p.pos.x,
        y: p.pos.y,
        laneCoverage: p.laneCoverage,
        zone: p.zone,
      })),
    };
  }

  private armPose(
    kind: "u" | "v",
    id: number,
    x: number,
    y: number,
    shown: { x: number; y: number } | undefined,
    snapDistance: number,
  ) {
    const key = kind + id;
    const prev = this.poses.get(key);
    let fromX = x;
    let fromY = y;
    let hasFrom = false;
    if (shown) {
      fromX = shown.x;
      fromY = shown.y;
      hasFrom = true;
    } else if (prev) {
      const along = Math.min(1, Math.max(0, prev.a));
      fromX = prev.x + (prev.tx - prev.x) * along;
      fromY = prev.y + (prev.ty - prev.y) * along;
      hasFrom = true;
    }
    const dx = x - fromX;
    const dy = y - fromY;
    if (!hasFrom || dx * dx + dy * dy > snapDistance * snapDistance) {
      this.poses.set(key, { x, y, tx: x, ty: y, a: 1 });
      return { x, y };
    }
    this.poses.set(key, { x: fromX, y: fromY, tx: x, ty: y, a: 0 });
    return { x: fromX, y: fromY };
  }

  private notePoseGap() {
    const now = performance.now();
    const gap = this.lastPoseAt > 0 ? (now - this.lastPoseAt) / 1000 : 0.05;
    this.lastPoseAt = now;
    this.poseSpan = Math.min(1.25, Math.max(0.05, gap));
  }

  /** Glide peons and soldiers from the last picture to this one over the picture gap. */
  private stepPoses(dt: number) {
    if (dt <= 0 || this.poses.size === 0) return;
    const gain = dt / Math.max(0.05, this.poseSpan);
    const slide = (key: string, pos: { x: number; y: number }) => {
      const pose = this.poses.get(key);
      if (!pose || pose.a >= 1) return;
      pose.a = Math.min(1, pose.a + gain);
      pos.x = pose.x + (pose.tx - pose.x) * pose.a;
      pos.y = pose.y + (pose.ty - pose.y) * pose.a;
    };
    for (const unit of this.state.units) slide("u" + unit.id, unit.pos);
    for (const villager of this.state.villagers) {
      if (this.predicted.has(villager.id)) continue;
      slide("v" + villager.id, villager.pos);
    }
  }

  private prunePoses() {
    const live = new Set<string>();
    for (const unit of this.state.units) live.add("u" + unit.id);
    for (const villager of this.state.villagers) live.add("v" + villager.id);
    for (const key of this.poses.keys()) {
      if (!live.has(key)) this.poses.delete(key);
    }
  }

  applySnapshot(snap: MatchSnapshot): boolean {
    if (!snapshotUsable(snap)) return false;
    try {
      this.copySnapshot(snap);
      return true;
    } catch {
      return false;
    }
  }

  private copySnapshot(snap: MatchSnapshot) {
    const s = this.state;
    const mapChanged = snap.mapId !== s.mapId;
    if (mapChanged) {
      const layout = skirmishMap(snap.mapId);
      if (layout) {
        this.activeMap = layout;
        s.nodes = buildNodes(layout);
      }
      this.poses.clear();
      this.lastPoseAt = 0;
      this.predicted.clear();
    }
    const shownVillagers = new Map<number, { x: number; y: number }>();
    const shownUnits = new Map<number, { x: number; y: number }>();
    if (!mapChanged) {
      for (const v of s.villagers) shownVillagers.set(v.id, { x: v.pos.x, y: v.pos.y });
      for (const u of s.units) shownUnits.set(u.id, { x: u.pos.x, y: u.pos.y });
    }
    const easingOwn = new Set(this.predicted);
    this.notePoseGap();
    const selectedVillagerIds = s.selectedVillagerIds;
    const selectedBuildingId = s.selectedBuildingId;
    const selectedKeepTeam = s.selectedKeepTeam;
    const buildSelection = s.buildSelection;
    const commandTeam = s.commandTeam;
    const soundOn = s.soundOn;
    const audioUnlocked = s.audioUnlocked;
    const hoveredPadId = s.hoveredPadId;
    const point = (x?: number, y?: number) => (x == null || y == null ? undefined : { x, y });

    this.shownMap = {
      id: snap.mapId,
      name: snap.mapName,
      tagline: snap.mapTagline,
      seed: snap.mapSeed,
    };
    s.mapId = snap.mapId;
    s.time = Math.max(s.time, snap.time);
    s.phase = snap.phase;
    s.paused = this.linkDown ? true : snap.paused;
    s.speed = snap.speed;
    s.waveIndex = snap.waveIndex;
    s.wavePhase = snap.wavePhase;
    s.buildTimer = snap.buildTimer;
    s.allWavesLaunched = snap.allWavesLaunched;
    s.wavesCleared = snap.wavesCleared;
    s.won = snap.won;
    s.endReason = snap.endReason;
    s.keepLevel = snap.keepLevel;
    s.gold.you = snap.gold.you;
    s.gold.foe = snap.gold.foe;
    s.wood.you = snap.wood.you;
    s.wood.foe = snap.wood.foe;
    s.stats.you.slain = snap.slain.you;
    s.stats.foe.slain = snap.slain.foe;
    s.stats.you.goldEarned = snap.goldEarned.you;
    s.stats.foe.goldEarned = snap.goldEarned.foe;
    for (const team of ["you", "foe"] as const) {
      const keep = snap.keeps[team];
      s.keeps[team].hp = keep.hp;
      s.keeps[team].maxHp = keep.maxHp;
      s.keeps[team].hitFlash = keep.hitFlash;
      s.keeps[team].attackFlash = keep.attackFlash;
      s.keeps[team].peonQueue = keep.queue.map((job) => ({ timeLeft: job.timeLeft, totalTime: job.totalTime }));
    }
    if (snap.keeps[this.localTeam].hitFlash > 0) s.redFlash = Math.max(s.redFlash, 0.18);

    s.units = [];
    for (const u of snap.units) {
      const def = UNIT_DEFS[u.kind];
      if (!def || !Number.isFinite(u.id) || !Number.isFinite(u.x) || !Number.isFinite(u.y)) continue;
      const pos = this.armPose("u", u.id, u.x, u.y, shownUnits.get(u.id), POSE_GLIDE);
      s.units.push({
        id: u.id,
        team: u.team,
        kind: u.kind,
        lane: u.lane,
        pos,
        hp: u.hp,
        maxHp: u.maxHp,
        speed: def.speed,
        damage: def.damage,
        bounty: def.bounty,
        attackCooldown: def.cooldown,
        attackTimer: u.attackTimer,
        towerResist: def.towerResist,
        keepMult: def.keepMult,
        siegeGap: def.siegeGap,
        targetKeep: false,
        fromBarracks: u.fromBarracks,
        ignoreEnemyCreeps: !u.fromBarracks,
        rallyPoint: point(u.rallyX, u.rallyY),
      });
    }
    s.villagers = [];
    for (const v of snap.villagers) {
      if (!Number.isFinite(v.id) || !Number.isFinite(v.x) || !Number.isFinite(v.y)) continue;
      const ownGuess = v.team === this.localTeam && easingOwn.has(v.id);
      const pos = this.armPose(
        "v",
        v.id,
        v.x,
        v.y,
        shownVillagers.get(v.id),
        ownGuess ? PREDICT_EASE : POSE_GLIDE,
      );
      s.villagers.push({
      id: v.id,
      team: v.team,
      pos,
      speed: VILLAGER_SPEED,
      hp: v.hp,
      maxHp: v.maxHp,
      damage: PEON_DAMAGE,
      state: v.state,
      targetNodeId: v.nodeId,
      targetEnemyId: v.enemyId,
      targetBarricadeId: v.barricadeId,
      moveTarget: point(v.mx, v.my),
      patrolA: point(v.ax, v.ay),
      patrolB: point(v.bx, v.by),
      patrolToB: v.toB,
      forcedAttack: v.forced,
      timer: 0,
      carryingGold: 0,
      carryingWood: 0,
      attackTimer: v.attackTimer,
      });
    }
    this.prunePoses();
    this.predicted.clear();
    s.buildings = snap.buildings.map((b) => ({
      id: b.id,
      team: b.team,
      kind: b.kind,
      padId: b.padId,
      pos: { x: b.x, y: b.y },
      spent: b.spent,
      spentWood: b.spentWood,
      canRefund: b.canRefund,
      damageRank: b.damageRank,
      rateRank: b.rateRank,
      attackTimer: 0,
      trainTimer: 0,
      animKick: b.animKick,
      queue: b.queue.map((job) => ({ kind: job.kind, timeLeft: job.timeLeft, totalTime: job.totalTime })),
      rallyPoint: point(b.rallyX, b.rallyY),
    }));
    s.barricades = snap.barricades.map((b) => ({
      id: b.id,
      team: b.team,
      lane: b.lane,
      pos: { x: b.x, y: b.y },
      hp: b.hp,
      maxHp: b.maxHp,
      buildProgress: b.buildProgress,
      buildTime: b.buildTime,
      built: b.built,
      builderId: b.builderId,
    }));
    if (snap.pads.length > 0) {
      s.pads = snap.pads.map((p) => ({
        id: p.id,
        team: p.team,
        pos: { x: p.x, y: p.y },
        laneCoverage: p.laneCoverage,
        zone: p.zone,
      }));
    }
    for (const node of snap.nodes) {
      const live = s.nodes.find((n) => n.id === node.id);
      if (!live) continue;
      live.loadsLeft = node.loadsLeft;
      live.workers = node.workers;
    }

    s.commandTeam = commandTeam;
    s.soundOn = soundOn;
    s.audioUnlocked = audioUnlocked;
    s.hoveredPadId = hoveredPadId;
    s.buildSelection = buildSelection;
    s.selectedKeepTeam = selectedKeepTeam;
    const living = new Set(s.villagers.filter((v) => v.team === this.localTeam && v.hp > 0).map((v) => v.id));
    s.selectedVillagerIds = selectedVillagerIds.filter((id) => living.has(id));
    s.selectedBuildingId = s.buildings.some((b) => b.id === selectedBuildingId) ? selectedBuildingId : null;
    if (this.pendingOwnPad) {
      const raised = s.buildings.find((b) => b.padId === this.pendingOwnPad && b.team === this.localTeam);
      if (raised) {
        s.selectedBuildingId = raised.id;
        s.selectedVillagerIds = [];
        s.selectedKeepTeam = null;
        s.buildSelection = null;
        this.pendingOwnPad = null;
      }
    }
  }

  getUiSnapshot(): UiSnapshot {
    const s = this.state;
    const meta = loadMeta();
    const map = this.activeMap;
    const view = this.localTeam;
    const other: Team = view === "you" ? "foe" : "you";
    const mapView = this.shownMap && this.shownMap.id === s.mapId ? this.shownMap : map;
    const selected = s.buildings.find((b) => b.id === s.selectedBuildingId);
    const selectedIsYours = !!selected && selected.team === view;
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

    const keepSelected = s.selectedKeepTeam === view;
    const peonQueue = keepSelected
      ? s.keeps[view].peonQueue.map((j) => ({
          kind: "levy" as TrainKind,
          label: "Peon",
          pct: 1 - j.timeLeft / Math.max(0.01, j.totalTime),
        }))
      : [];
    const canUpgradeStructure = !!selected && selectedIsYours && selected.kind !== "house";

    const brain = foeBrainStats();
    let endReason = s.endReason;
    if (view === "foe" && s.phase === "ended") {
      if (s.won === true) {
        endReason = s.endReason.startsWith("Victory by stone")
          ? "Defeat by stone. The foe held stronger."
          : "Defeat. Your keep has fallen.";
      } else if (s.won === false) {
        endReason = s.endReason.startsWith("Defeat by stone")
          ? "Victory by stone. Your keep held stronger."
          : "Victory. Their keep is broken.";
      }
    }
    return {
      phase: s.phase,
      mapId: s.mapId,
      mapName: mapView.name,
      mapTagline: mapView.tagline,
      mapSeed: mapView.seed,
      campaignLevel: meta.level,
      scoutSalt: meta.scoutSalt,
      paused: s.paused,
      speed: s.speed,
      soundOn: s.soundOn,
      yourHp: Math.max(0, Math.ceil(s.keeps[view].hp)),
      foeHp: Math.max(0, Math.ceil(s.keeps[other].hp)),
      yourMaxHp: s.keeps[view].maxHp,
      yourGold: Math.floor(s.gold[view]),
      yourWood: Math.floor(s.wood[view]),
      foeGold: Math.floor(s.gold[other]),
      foeWood: Math.floor(s.wood[other]),
      waveLabel: `${Math.min(WAVES.length, Math.max(1, s.waveIndex || 1))}/${WAVES.length}`,
      wavePhase: s.wavePhase,
      buildTimer: Math.max(0, s.buildTimer),
      canRush:
        this.matchMode !== "pvp" &&
        s.wavePhase === "build" &&
        s.waveIndex < WAVES.length &&
        s.phase === "running",
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
      peonCount: s.villagers.filter((v) => v.team === view).length,
      peonCap: this.peonCap(view),
      keepGarrisoned: s.villagers.filter((v) => v.team === view && v.state === "garrisoned").length,
      keepGarrisonMax: KEEP_GARRISON_MAX,
      canTrainPeon: keepSelected && this.peonSlotsUsed(view) < this.peonCap(view),
      peonTrainCost: { gold: PEON_TRAIN_GOLD, wood: PEON_TRAIN_WOOD },
      buildCosts: BUILD_COST,
      keepLevel: this.matchMode === "pvp" ? s.keepLevel : meta.level,
      keepXp: meta.xp,
      keepXpNext: xpForNextLevel(meta.level),
      keepXpPct: xpProgress(meta.xp, meta.level),
      endReason,
      lastXpGain: s.lastXpGain,
      stats: {
        slain: s.stats[view].slain,
        goldEarned: s.stats[view].goldEarned,
        waves: s.waveIndex,
        yourKeep: Math.max(0, Math.ceil(s.keeps[view].hp)),
        foeKeep: Math.max(0, Math.ceil(s.keeps[other].hp)),
      },
      foeIntellect: brain.intellect,
      foeGames: brain.games,
      foeWins: brain.wins,
      foeExplore: brain.epsilon,
      foeLastAction: brain.lastAction,
      localTeam: view,
      pvp: this.matchMode === "pvp",
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
  if (dist({ x, y }, s.keeps.you.pos) < 40) return { kind: "keep", id: "you" };
  if (dist({ x, y }, s.keeps.foe.pos) < 40) return { kind: "keep", id: "foe" };
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
