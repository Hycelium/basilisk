import { basiliskMap } from "../game/basiliskMap";
import { skirmishMap } from "../game/map";
import type {
  BuildingKind,
  Coffer,
  DefendLayerId,
  GamePhase,
  KingController,
  KingOrder,
  Lane,
  LifeStage,
  MapDef,
  Team,
  SiegePhase,
  TrainKind,
  TripCounts,
  UnitKind,
  Villager,
  WavePhase,
  WorkKind,
} from "../game/types";

/**
 * Orders a guest may send. Ids are explicit so the host never uses its own selection.
 * `team` is the guest's side (`foe`). The host refuses anything aimed at `you`.
 */
export type RemoteOrder =
  | { t: "move"; team: Team; ids: number[]; x: number; y: number }
  | { t: "patrol"; team: Team; ids: number[]; x: number; y: number }
  | { t: "stop"; team: Team; ids: number[] }
  | { t: "attack"; team: Team; ids: number[]; targetId: number }
  | { t: "gather"; team: Team; ids: number[]; nodeId: string }
  | { t: "recall"; team: Team }
  | { t: "work"; team: Team }
  | { t: "build"; team: Team; kind: BuildingKind; padId: string }
  | { t: "train"; team: Team; kind: TrainKind; buildingId: number }
  | { t: "peon"; team: Team }
  | { t: "garrison"; team: Team }
  | { t: "ungarrison"; team: Team }
  | { t: "rally"; team: Team; buildingId: number; x: number; y: number }
  | { t: "barricade"; team: Team; x: number; y: number; builderId?: number }
  | { t: "upgrade"; team: Team; buildingId: number; kind: "damage" | "rate" }
  | { t: "raze"; team: Team; buildingId: number }
  | { t: "cancel"; team: Team; buildingId: number; index: number }
  | { t: "pause" }
  | { t: "speed" }
  | { t: "rush" }
  | { t: "drive"; team: Team; id: number; w: boolean; a: boolean; s: boolean; d: boolean; yaw: number }
  | { t: "strike"; team: Team }
  | { t: "possess"; team: Team; id: number }
  | { t: "unpossess"; team: Team }
  | { t: "labor"; team: Team; kind: WorkKind; ids: number[] }
  | { t: "laborAdj"; team: Team; kind: WorkKind; delta: number }
  | { t: "crown"; team: Team; order: KingOrder }
  | { t: "defend"; team: Team; layer: DefendLayerId | null }
  | { t: "rejoin"; team: Team };

export interface SnapKeep {
  hp: number;
  maxHp: number;
  hitFlash: number;
  attackFlash: number;
  queue: { timeLeft: number; totalTime: number }[];
}

export interface SnapUnit {
  id: number;
  team: Team;
  kind: UnitKind;
  lane: Lane;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  fromBarracks: boolean;
  attackTimer: number;
  rallyX?: number;
  rallyY?: number;
  siegePhase?: SiegePhase;
  siegeTimer?: number;
  lifeStage?: LifeStage;
  npcKing?: boolean;
  workKind?: WorkKind;
  carryKind?: WorkKind | null;
  carry?: number;
  trips?: TripCounts;
  kills?: number;
  deposited?: number;
  canPromote?: boolean;
  xp?: number;
}

export interface SnapVillager {
  id: number;
  team: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  state: Villager["state"];
  nodeId?: string;
  enemyId?: number;
  barricadeId?: number;
  mx?: number;
  my?: number;
  ax?: number;
  ay?: number;
  bx?: number;
  by?: number;
  toB?: boolean;
  forced?: boolean;
  attackTimer: number;
}

export interface SnapBuilding {
  id: number;
  team: Team;
  kind: BuildingKind;
  padId: string;
  x: number;
  y: number;
  spent: number;
  spentWood: number;
  canRefund: boolean;
  damageRank: 0 | 1 | 2;
  rateRank: 0 | 1 | 2;
  animKick: number;
  hp?: number;
  maxHp?: number;
  queue: { kind: TrainKind; timeLeft: number; totalTime: number }[];
  rallyX?: number;
  rallyY?: number;
  disableTimer?: number;
}

export interface SnapNode {
  id: string;
  loadsLeft: number;
  workers: number;
}

export interface SnapBarricade {
  id: number;
  team: Team;
  lane: Lane;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  buildProgress: number;
  buildTime: number;
  built: boolean;
  builderId?: number;
}

export interface SnapPad {
  id: string;
  team: Team;
  x: number;
  y: number;
  laneCoverage: Lane[];
  zone: "combat" | "eco";
}

/** Slim world picture. Selection, camera, and control groups stay on each machine. */
export interface MatchSnapshot {
  mapId: string;
  mapName: string;
  mapTagline: string;
  mapSeed: number;
  time: number;
  phase: GamePhase;
  paused: boolean;
  speed: 1 | 2;
  waveIndex: number;
  wavePhase: WavePhase;
  buildTimer: number;
  allWavesLaunched: boolean;
  wavesCleared: number;
  won: boolean | null;
  endReason: string;
  keepLevel: number;
  gold: Record<Team, number>;
  wood: Record<Team, number>;
  slain: Record<Team, number>;
  goldEarned: Record<Team, number>;
  keeps: Record<Team, SnapKeep>;
  units: SnapUnit[];
  villagers: SnapVillager[];
  buildings: SnapBuilding[];
  nodes: SnapNode[];
  barricades: SnapBarricade[];
  pads: SnapPad[];
  basilisk?: boolean;
  food?: Record<Team, number>;
  coffer?: Record<Team, Coffer>;
  kingController?: Record<Team, KingController>;
  kingOrder?: Record<Team, KingOrder>;
  defendLayer?: Record<Team, DefendLayerId | null>;
  kingId?: Record<Team, number | null>;
  playerUnitId?: Record<Team, number | null>;
  driven?: Record<Team, number | null>;
  joinTimer?: Record<Team, number>;
  joinReady?: Record<Team, boolean>;
}

export type NetMsg =
  | { t: "hello"; name: string }
  | { t: "start"; map: MapDef }
  | { t: "pick"; mapId: string }
  | { t: "rematch"; mapId: string }
  | { t: "order"; order: RemoteOrder }
  | { t: "snap"; snap: MatchSnapshot }
  | { t: "note"; text: string }
  | { t: "ping"; n: number; at: number }
  | { t: "pong"; n: number; at: number }
  | { t: "full" }
  | { t: "part"; id: number; i: number; n: number; s: string };

const ORDER_TYPES = new Set<RemoteOrder["t"]>([
  "move",
  "patrol",
  "stop",
  "attack",
  "gather",
  "recall",
  "work",
  "build",
  "train",
  "peon",
  "garrison",
  "ungarrison",
  "rally",
  "barricade",
  "upgrade",
  "raze",
  "cancel",
  "pause",
  "speed",
  "rush",
  "drive",
  "strike",
  "possess",
  "unpossess",
  "labor",
  "laborAdj",
  "crown",
  "defend",
  "rejoin",
]);

function knownMap(id: string) {
  return id === basiliskMap().id || !!skirmishMap(id);
}

export function createRoomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Production Pages uses base `/roadkeep/`; dev uses `/`. */
export function inviteLink(roomId: string) {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.searchParams.set("room", roomId);
  return url.href;
}

export function parseRoomInput(raw: string) {
  const text = raw.trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return (url.searchParams.get("room") ?? "").replace(/[^A-Za-z0-9]/g, "");
  } catch {
    const match = text.match(/(?:^|[?&#])room=([A-Za-z0-9]+)/);
    if (match) return match[1];
    return text.replace(/[^A-Za-z0-9]/g, "");
  }
}

export function asNetMsg(data: unknown): NetMsg | null {
  if (!data || typeof data !== "object") return null;
  const t = (data as { t?: unknown }).t;
  if (typeof t !== "string") return null;
  if (t === "order") {
    const order = (data as { order?: { t?: unknown } }).order;
    if (!order || typeof order.t !== "string" || !ORDER_TYPES.has(order.t as RemoteOrder["t"])) return null;
  }
  if (t === "part") {
    const part = data as { id?: unknown; i?: unknown; n?: unknown; s?: unknown };
    if (typeof part.id !== "number" || typeof part.i !== "number" || typeof part.n !== "number" || typeof part.s !== "string") {
      return null;
    }
  }
  if (t === "snap" && !snapshotUsable((data as { snap?: unknown }).snap)) return null;
  if (t === "pick" || t === "rematch") {
    const mapId = (data as { mapId?: unknown }).mapId;
    if (typeof mapId !== "string" || !knownMap(mapId)) return null;
  }
  if (
    t === "hello" ||
    t === "start" ||
    t === "pick" ||
    t === "rematch" ||
    t === "order" ||
    t === "snap" ||
    t === "note" ||
    t === "ping" ||
    t === "pong" ||
    t === "full" ||
    t === "part"
  ) {
    return data as NetMsg;
  }
  return null;
}

const PHASES = new Set(["title", "running", "ended"]);
const WAVE_PHASES = new Set(["build", "spawning", "fighting"]);

/** Reject a picture that would throw while the guest copies it onto the scene. */
export function snapshotUsable(snap: unknown): snap is MatchSnapshot {
  if (!snap || typeof snap !== "object") return false;
  const s = snap as MatchSnapshot;
  if (typeof s.mapId !== "string" || typeof s.mapName !== "string" || typeof s.mapTagline !== "string") return false;
  if (!Number.isFinite(s.mapSeed) || !Number.isFinite(s.time)) return false;
  if (!PHASES.has(s.phase)) return false;
  if (typeof s.paused !== "boolean" || (s.speed !== 1 && s.speed !== 2)) return false;
  if (!WAVE_PHASES.has(s.wavePhase) || !Number.isFinite(s.buildTimer) || !Number.isFinite(s.waveIndex)) return false;
  if (typeof s.allWavesLaunched !== "boolean" || !Number.isFinite(s.wavesCleared)) return false;
  if (s.won !== null && typeof s.won !== "boolean") return false;
  if (typeof s.endReason !== "string" || !Number.isFinite(s.keepLevel)) return false;
  if (!s.gold || !Number.isFinite(s.gold.you) || !Number.isFinite(s.gold.foe)) return false;
  if (!s.wood || !Number.isFinite(s.wood.you) || !Number.isFinite(s.wood.foe)) return false;
  if (!s.slain || !Number.isFinite(s.slain.you) || !Number.isFinite(s.slain.foe)) return false;
  if (!s.goldEarned || !Number.isFinite(s.goldEarned.you) || !Number.isFinite(s.goldEarned.foe)) return false;
  if (!keepUsable(s.keeps?.you) || !keepUsable(s.keeps?.foe)) return false;
  if (!Array.isArray(s.units) || !Array.isArray(s.villagers) || !Array.isArray(s.buildings)) return false;
  if (!Array.isArray(s.nodes) || !Array.isArray(s.barricades) || !Array.isArray(s.pads)) return false;
  return true;
}

function keepUsable(keep: MatchSnapshot["keeps"]["you"] | undefined) {
  return !!keep && Number.isFinite(keep.hp) && Number.isFinite(keep.maxHp) && Array.isArray(keep.queue);
}

/**
 * PeerJS JSON channels drop a message at 16300 encoded bytes and do not chunk it.
 * Split anything that would be rejected. A normal match picture stays one message.
 */
export const WIRE_SAFE = 14000;
const PART_CHARS = 4000;
const MAX_PARTS = 32;

function wireBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function splitWire(msg: NetMsg, id: number): NetMsg[] {
  if (msg.t === "part") return wireBytes(msg) < WIRE_SAFE ? [msg] : [];
  if (wireBytes(msg) < WIRE_SAFE) return [msg];
  const raw = JSON.stringify(msg);
  const n = Math.ceil(raw.length / PART_CHARS);
  if (n > MAX_PARTS) return [];
  const parts: NetMsg[] = [];
  for (let i = 0; i < n; i++) {
    const piece: NetMsg = { t: "part", id, i, n, s: raw.slice(i * PART_CHARS, (i + 1) * PART_CHARS) };
    if (wireBytes(piece) >= WIRE_SAFE) return [];
    parts.push(piece);
  }
  return parts;
}

export class WireReassembly {
  private id = -1;
  private n = 0;
  private parts: string[] = [];
  private got = 0;

  take(msg: { id: number; i: number; n: number; s: string }): NetMsg | "bad" | null {
    if (!Number.isInteger(msg.n) || msg.n < 2 || msg.n > MAX_PARTS) return "bad";
    if (!Number.isInteger(msg.i) || msg.i < 0 || msg.i >= msg.n) return "bad";
    if (!Number.isInteger(msg.id) || typeof msg.s !== "string" || msg.s.length > PART_CHARS) return "bad";
    if (msg.id !== this.id || msg.n !== this.n) {
      this.id = msg.id;
      this.n = msg.n;
      this.parts = [];
      this.got = 0;
    }
    if (this.parts[msg.i] == null) {
      this.parts[msg.i] = msg.s;
      this.got += 1;
    }
    if (this.got < this.n) return null;
    const raw = this.parts.join("");
    this.id = -1;
    this.n = 0;
    this.got = 0;
    this.parts = [];
    try {
      const parsed = asNetMsg(JSON.parse(raw));
      if (!parsed || parsed.t === "part") return "bad";
      return parsed;
    } catch {
      return "bad";
    }
  }
}
