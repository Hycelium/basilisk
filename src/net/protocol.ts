import type {
  BuildingKind,
  GamePhase,
  MapDef,
  Team,
  TrainKind,
  UnitKind,
  Villager,
  WavePhase,
} from "../game/types";

/** Orders a guest may send. Ids are explicit so the host never uses its own selection. */
export type RemoteOrder =
  | { t: "move"; ids: number[]; x: number; y: number }
  | { t: "patrol"; ids: number[]; x: number; y: number }
  | { t: "stop"; ids: number[] }
  | { t: "attack"; ids: number[]; targetId: number }
  | { t: "gather"; ids: number[]; nodeId: string }
  | { t: "recall" }
  | { t: "build"; kind: BuildingKind; padId: string }
  | { t: "train"; kind: TrainKind; buildingId: number }
  | { t: "peon" }
  | { t: "garrison" }
  | { t: "ungarrison" }
  | { t: "rally"; buildingId: number; x: number; y: number }
  | { t: "barricade"; x: number; y: number; builderId?: number }
  | { t: "upgrade"; buildingId: number; kind: "damage" | "rate" }
  | { t: "raze"; buildingId: number }
  | { t: "cancel"; buildingId: number; index: number }
  | { t: "pause" }
  | { t: "speed" }
  | { t: "rush" };

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
  lane: 0 | 1;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  fromBarracks: boolean;
  attackTimer: number;
  rallyX?: number;
  rallyY?: number;
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
  queue: { kind: TrainKind; timeLeft: number; totalTime: number }[];
  rallyX?: number;
  rallyY?: number;
}

export interface SnapNode {
  id: string;
  loadsLeft: number;
  workers: number;
}

export interface SnapBarricade {
  id: number;
  team: Team;
  lane: 0 | 1;
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
  laneCoverage: 0 | 1 | 2;
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
}

export type NetMsg =
  | { t: "hello"; name: string }
  | { t: "start"; map: MapDef }
  | { t: "order"; order: RemoteOrder }
  | { t: "snap"; snap: MatchSnapshot }
  | { t: "note"; text: string }
  | { t: "ping"; n: number; at: number }
  | { t: "pong"; n: number; at: number }
  | { t: "full" };

const ORDER_TYPES = new Set<RemoteOrder["t"]>([
  "move",
  "patrol",
  "stop",
  "attack",
  "gather",
  "recall",
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
]);

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
  if (
    t === "hello" ||
    t === "start" ||
    t === "order" ||
    t === "snap" ||
    t === "note" ||
    t === "ping" ||
    t === "pong" ||
    t === "full"
  ) {
    return data as NetMsg;
  }
  return null;
}
