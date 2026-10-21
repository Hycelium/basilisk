import { UNIT_DEFS } from "./balance";
import type { TrainKind } from "./types";

export type MissionMode = "march" | "onslaught";

export interface CampaignMission {
  id: number;
  nation: string;
  blurb: string;
  unit: TrainKind;
  mode: MissionMode;
  waves: number;
  seed: number;
  /** Percent position on the campaign map. */
  x: number;
  y: number;
}

/**
 * Five nations, each fought twice. The march unlocks their only unit.
 * The later onslaught is the same host on a wider field, in growing waves.
 */
export const MISSIONS: CampaignMission[] = [
  {
    id: 1,
    nation: "Lowmere",
    blurb: "A levy host and nothing else. Hold with towers and peons until their line is yours.",
    unit: "levy",
    mode: "march",
    waves: 8,
    seed: 90000,
    x: 14,
    y: 22,
  },
  {
    id: 2,
    nation: "Swiftfen",
    blurb: "They send only runners. Break the charge and the charge is yours.",
    unit: "runner",
    mode: "march",
    waves: 8,
    seed: 90001,
    x: 38,
    y: 28,
  },
  {
    id: 3,
    nation: "Ashbow",
    blurb: "Bows, and no other steel. Silence the pale and their archers join you.",
    unit: "archer",
    mode: "march",
    waves: 8,
    seed: 90004,
    x: 62,
    y: 18,
  },
  {
    id: 4,
    nation: "Shieldmere",
    blurb: "A wall of wards. Crack it and the shields change hands.",
    unit: "ward",
    mode: "march",
    waves: 8,
    seed: 90005,
    x: 22,
    y: 58,
  },
  {
    id: 5,
    nation: "Ramholt",
    blurb: "Rams and more rams. Stop the gate-breakers and they ram for you.",
    unit: "rammer",
    mode: "march",
    waves: 8,
    seed: 90008,
    x: 70,
    y: 48,
  },
  {
    id: 6,
    nation: "Lowmere Flood",
    blurb: "Lowmere returns in greater number, across a field crowded with building ground.",
    unit: "levy",
    mode: "onslaught",
    waves: 12,
    seed: 90007,
    x: 16,
    y: 86,
  },
  {
    id: 7,
    nation: "Swiftfen Reach",
    blurb: "Runners in a rising flood. More pads, and every wave is larger than the last.",
    unit: "runner",
    mode: "onslaught",
    waves: 12,
    seed: 90011,
    x: 50,
    y: 84,
  },
  {
    id: 8,
    nation: "Ashbow High",
    blurb: "The bows come in waves that thicken. The high ground is wide enough to answer them.",
    unit: "archer",
    mode: "onslaught",
    waves: 12,
    seed: 90014,
    x: 88,
    y: 58,
  },
  {
    id: 9,
    nation: "Shieldmere Gate",
    blurb: "Wards press in a lengthening siege. Plant towers on the extra ground and outlast them.",
    unit: "ward",
    mode: "onslaught",
    waves: 12,
    seed: 90017,
    x: 46,
    y: 52,
  },
  {
    id: 10,
    nation: "Ramholt Crown",
    blurb: "The last host. Rams in a rising onslaught, on the widest field of the marches.",
    unit: "rammer",
    mode: "onslaught",
    waves: 12,
    seed: 90020,
    x: 86,
    y: 22,
  },
];

const KEY = "roadkeep_campaign_v1";
const TRAIN: TrainKind[] = ["levy", "runner", "archer", "ward", "rammer"];

export interface CampaignProgress {
  cleared: number[];
  unlocked: TrainKind[];
}

function emptyProgress(): CampaignProgress {
  return { cleared: [], unlocked: [] };
}

export function loadCampaign(): CampaignProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<CampaignProgress>;
    const cleared = Array.isArray(parsed.cleared)
      ? parsed.cleared.filter((id) => MISSIONS.some((m) => m.id === id))
      : [];
    const unlocked = Array.isArray(parsed.unlocked)
      ? parsed.unlocked.filter((kind): kind is TrainKind => TRAIN.includes(kind as TrainKind))
      : [];
    return { cleared, unlocked };
  } catch {
    return emptyProgress();
  }
}

function saveCampaign(progress: CampaignProgress) {
  localStorage.setItem(KEY, JSON.stringify(progress));
}

export function unitPlural(kind: TrainKind) {
  const label = UNIT_DEFS[kind].label;
  if (label === "Levy") return "Levies";
  return `${label}s`;
}

export function missionById(id: number) {
  return MISSIONS.find((m) => m.id === id) ?? null;
}

export type MissionStatus = "held" | "open" | "locked";

export function missionStatus(id: number, progress: CampaignProgress = loadCampaign()): MissionStatus {
  if (progress.cleared.includes(id)) return "held";
  if (id === 1 || progress.cleared.includes(id - 1)) return "open";
  return "locked";
}

export function hasCampaignUnit(kind: string, progress: CampaignProgress = loadCampaign()) {
  return progress.unlocked.includes(kind as TrainKind);
}

export function unlockLine(kind: string) {
  const mission = MISSIONS.find((m) => m.mode === "march" && m.unit === kind);
  if (!mission || hasCampaignUnit(kind)) return "";
  return `Beat ${mission.nation} to muster ${unitPlural(mission.unit)}`;
}

/** Marks a win. The first clear of a march unlocks that nation's unit. */
export function recordVictory(id: number): { unit: TrainKind | null; fresh: boolean } {
  const mission = missionById(id);
  if (!mission) return { unit: null, fresh: false };
  const progress = loadCampaign();
  if (progress.cleared.includes(id)) return { unit: null, fresh: false };
  progress.cleared.push(id);
  let unit: TrainKind | null = null;
  if (mission.mode === "march" && !progress.unlocked.includes(mission.unit)) {
    progress.unlocked.push(mission.unit);
    unit = mission.unit;
  }
  saveCampaign(progress);
  return { unit, fresh: true };
}

/**
 * Enemy units per lane. Marches climb slowly so a tower line can answer them.
 * Wave 6 of an 8-wave march is still two per lane, not the spike that used to
 * walk into the enemy keep and end the match.
 */
export function campaignPerLane(mission: CampaignMission, waveIndex: number) {
  if (mission.mode === "onslaught") return 2 + Math.floor(waveIndex * 0.55);
  return 1 + Math.floor(waveIndex / 3);
}
