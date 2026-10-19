/**
 * Persistent tabular Q-learning foe.
 * Learns across browser sessions (localStorage) — counters your build patterns over time.
 */

export type LearnAction =
  | "build_watch"
  | "build_ballista"
  | "build_catapult"
  | "build_barracks"
  | "train_levy"
  | "train_runner"
  | "train_archer"
  | "train_ward"
  | "train_rammer"
  | "upgrade"
  | "upgrade_damage"
  | "upgrade_rate"
  | "econ"
  | "wait";

export const LEARN_ACTIONS: LearnAction[] = [
  "build_watch",
  "build_ballista",
  "build_catapult",
  "build_barracks",
  "train_levy",
  "train_runner",
  "train_ward",
  "train_rammer",
  "upgrade",
  "econ",
  "wait",
  "train_archer",
  "upgrade_damage",
  "upgrade_rate",
];

export interface LearnFeatures {
  yourTowers: number;
  yourArmy: number;
  yourBarracks: number;
  foeTowers: number;
  foeArmy: number;
  foeBarracks: number;
  foeGold: number;
  yourGold: number;
  wave: number;
  hpLead: number; // foeKeep - yourKeep (positive = foe ahead)
  yourFast: number;
  yourHeavy: number;
  yourRanged: number;
}

export interface BrainStats {
  games: number;
  wins: number;
  losses: number;
  updates: number;
  epsilon: number;
  /** Uncapped. Grows with experience and never falls. */
  intellect: number;
  /** Fraction of the way from this level to the next. Never a "max" bar. */
  intellectProgress: number;
  lastAction: string;
}

interface BrainSave {
  q: Record<string, number[]>;
  games: number;
  wins: number;
  losses: number;
  updates: number;
  version: number;
  /**
   * Older sessions may have written a display intellect clamped at 99.
   * It is never read. Level is always recomputed from games, wins, and updates.
   */
  intellect?: number;
  level?: number;
}

const KEY = "roadkeep_foe_brain_v1";
/** Fixed on purpose: the learning rate never anneals to zero, so every match still updates Q. */
const ALPHA = 0.36;
const GAMMA = 0.88;
const EPS_START = 0.24;
/** Explore rate sinks toward this after the old level-99 mark and never reaches zero. */
const EPS_FLOOR = 0.012;
/** Experience that used to display as intellect 99 (`8 + experience`). */
const OLD_CAP_EXPERIENCE = 91;

/**
 * Monotonic experience. Wins, games, and updates only increase, so intellect
 * cannot go backwards after a loss.
 */
export function foeExperience(games: number, wins: number, updates: number) {
  return Math.max(0, games) * 4 + Math.max(0, wins) * 3 + Math.max(0, updates) / 24;
}

/** Uncapped level. A new brain is 8; each full point of experience adds one level. */
export function intellectFromExperience(experience: number) {
  if (!Number.isFinite(experience) || experience <= 0) return 8;
  return 8 + Math.floor(experience);
}

/** Progress toward the next level only (the fractional point of experience). */
export function intellectProgressFromExperience(experience: number) {
  if (!Number.isFinite(experience) || experience <= 0) return 0;
  return experience - Math.floor(experience);
}

export function intellectFromCounters(counters: { games?: number; wins?: number; updates?: number }) {
  return intellectFromExperience(foeExperience(counters.games ?? 0, counters.wins ?? 0, counters.updates ?? 0));
}

/**
 * Explore rate. Through the old cap this matches the previous schedule
 * (start 0.24, floor 0.03). Past that, the floor itself keeps falling toward
 * EPS_FLOOR so exploitation gets sharper forever without stopping discovery.
 */
export function epsilonFrom(games: number, experience: number) {
  const early = EPS_START - Math.max(0, games) * 0.022;
  const throughOldCap = Math.min(EPS_START, Math.max(0.03, early));
  if (!Number.isFinite(experience) || experience <= OLD_CAP_EXPERIENCE) return throughOldCap;
  const past = experience - OLD_CAP_EXPERIENCE;
  const veteran = EPS_FLOOR + (0.03 - EPS_FLOOR) / (1 + past / 420);
  return Math.min(throughOldCap, veteran);
}

/**
 * Seconds between foe decisions. The old curve holds through level 99
 * (about 1.76s at 8, 0.72s at 99), then eases toward 0.40s. Never instant.
 */
export function thinkInterval(intellect: number) {
  const iq = Number.isFinite(intellect) ? intellect : 8;
  const classic = 1.85 - Math.min(iq, 99) * 0.0115;
  if (iq <= 99) return Math.max(0.72, classic);
  return 0.4 + (0.72 - 0.4) / (1 + (iq - 99) / 80);
}

/**
 * Seconds a warband holds before releasing. Same curve through level 100
 * (floor 6s), then eases toward 3.2s so veteran rushes commit sooner.
 */
export function rushCommitDelay(intellect: number) {
  const iq = Number.isFinite(intellect) ? intellect : 8;
  const classic = 10 - Math.min(iq, 100) * 0.04;
  if (iq <= 100) return Math.max(6, classic);
  return 3.2 + (6 - 3.2) / (1 + (iq - 100) / 120);
}

/**
 * Level 10 is the very-hard line. The same brain stays very hard after that;
 * further levels only tighten timing and fill waves. Below 10 it is still
 * the learning opponent a new player can beat.
 */
export const VERY_HARD_LEVEL = 10;

export function veryHard(intellect: number) {
  return Number.isFinite(intellect) && intellect >= VERY_HARD_LEVEL;
}

/** How many levels past the very-hard line. Zero until then. */
export function executionEdge(intellect: number) {
  if (!veryHard(intellect)) return 0;
  return intellect - VERY_HARD_LEVEL;
}

/**
 * Units a warband waits to assemble. The old cap (7) stays below level 10.
 * Past that the wave grows slowly and stops at 11 — a fuller rush, not a
 * larger supply cap.
 */
export function waveSizeTarget(intellect: number) {
  const iq = Number.isFinite(intellect) ? intellect : 8;
  if (!veryHard(iq)) return Math.min(7, 4 + Math.floor(Math.max(0, iq) / 35));
  return Math.min(11, 6 + Math.floor(executionEdge(iq) / 20));
}

/**
 * Longest a very-hard warband holds while it builds a mixed wave.
 * About 16s at level 10, tightening toward 9s as execution sharpens.
 */
export function veryHardHoldSeconds(intellect: number) {
  const edge = executionEdge(intellect);
  return 8.5 + 7.5 / (1 + edge / 36);
}

export function formatIntellect(n: number) {
  const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 8;
  return v.toLocaleString("en-US");
}

function band(n: number, edges: number[]) {
  for (let i = 0; i < edges.length; i++) if (n <= edges[i]) return i;
  return edges.length;
}

function stateKey(f: LearnFeatures) {
  // Compact discrete state — enough to generalize, small enough to learn in-browser
  const yt = band(f.yourTowers, [0, 1, 2, 4]);
  const ya = band(f.yourArmy, [0, 2, 5, 10]);
  const yb = f.yourBarracks > 0 ? 1 : 0;
  const ft = band(f.foeTowers, [0, 1, 2, 4]);
  const fa = band(f.foeArmy, [0, 2, 5, 10]);
  const fb = f.foeBarracks > 0 ? 1 : 0;
  const g = band(f.foeGold, [40, 80, 140, 220]);
  const w = band(f.wave, [2, 5, 9, 13]);
  const h = band(f.hpLead + 200, [120, 180, 220, 280]); // centered-ish around keep HP
  return `${yt}${ya}${yb}${ft}${fa}${fb}${g}${w}${h}`;
}

function emptyRow() {
  return LEARN_ACTIONS.map(() => 0);
}

export class LearningBrain {
  private q: Record<string, number[]> = {};
  private games = 0;
  private wins = 0;
  private losses = 0;
  private updates = 0;
  private lastKey: string | null = null;
  private lastActionIdx = 0;
  private lastActionName: LearnAction = "wait";
  private matchRewardAcc = 0;
  private lastFeatures: LearnFeatures | null = null;
  /** True when the latest choose() rolled exploration rather than the greedy action. */
  private explored = false;

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as BrainSave;
      if (data.version !== 1) return;
      this.q = data.q ?? {};
      this.games = data.games ?? 0;
      this.wins = data.wins ?? 0;
      this.losses = data.losses ?? 0;
      this.updates = data.updates ?? 0;
      // data.intellect / data.level are ignored. A save that displayed 99
      // still has the raw counters, and the next read recomputes past 99.
    } catch {
      /* fresh brain */
    }
  }

  save() {
    try {
      const data: BrainSave = {
        q: this.q,
        games: this.games,
        wins: this.wins,
        losses: this.losses,
        updates: this.updates,
        version: 1,
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* quota / private mode */
    }
  }

  /** Raw experience. Not stored; always derived so a clamped display cannot stick. */
  experience() {
    return foeExperience(this.games, this.wins, this.updates);
  }

  epsilon() {
    return epsilonFrom(this.games, this.experience());
  }

  intellect() {
    return intellectFromExperience(this.experience());
  }

  /**
   * Hand-authored nudge used when Q values are still small. Past the old cap
   * it fades so the learned action wins more often. It never changes sign of
   * experience and is not a resource or damage bonus.
   */
  private priorScale() {
    const past = this.experience() - OLD_CAP_EXPERIENCE;
    if (past <= 0) return 1;
    return 1 / (1 + past / 220);
  }

  private actionBias(features: LearnFeatures, index: number) {
    const name = LEARN_ACTIONS[index];
    let v = 0;
    if (features.foeTowers < 2 && name.startsWith("build")) v += 0.15;
    if (features.foeBarracks > 0 && name.startsWith("train")) v += 0.22;
    if (features.yourTowers >= 3 && (name === "train_ward" || name === "train_runner")) v += 0.42;
    if (features.yourArmy >= 4 && name === "train_archer") v += 0.38;
    if (features.yourRanged >= 2 && name === "train_ward") v += 0.5;
    if (features.yourFast >= 2 && name === "upgrade_rate") v += 0.38;
    if (features.yourHeavy >= 2 && name === "upgrade_damage") v += 0.38;
    if (features.foeTowers >= 2 && name.startsWith("upgrade_")) v += 0.16;
    if (features.yourBarracks > 0 && name === "train_rammer") v += 0.24;
    if (features.foeGold > 170 && name === "wait") v -= 0.5;
    if (features.hpLead < -50 && (name === "upgrade" || name === "build_ballista")) v += 0.3;
    return v;
  }

  /** Rare explores after the old cap prefer strong actions, but stay stochastic. */
  private sampleSoftmax(row: number[], features: LearnFeatures) {
    const past = Math.max(0, this.experience() - OLD_CAP_EXPERIENCE);
    const temperature = 0.28 + 0.9 / (1 + past / 160);
    const scale = this.priorScale();
    const scores = row.map((q, i) => q + this.actionBias(features, i) * scale);
    const maxS = Math.max(...scores);
    const weights = scores.map((s) => Math.exp(Math.max(-40, Math.min(40, (s - maxS) / temperature))));
    let sum = 0;
    for (const w of weights) sum += w;
    let roll = Math.random() * sum;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  stats(): BrainStats {
    const experience = this.experience();
    return {
      games: this.games,
      wins: this.wins,
      losses: this.losses,
      updates: this.updates,
      epsilon: epsilonFrom(this.games, experience),
      intellect: intellectFromExperience(experience),
      intellectProgress: intellectProgressFromExperience(experience),
      lastAction: this.lastActionName,
    };
  }

  private row(key: string) {
    if (!this.q[key]) this.q[key] = emptyRow();
    while (this.q[key].length < LEARN_ACTIONS.length) this.q[key].push(0);
    if (this.q[key].length > LEARN_ACTIONS.length) {
      this.q[key] = this.q[key].slice(0, LEARN_ACTIONS.length);
    }
    return this.q[key];
  }

  beginMatch() {
    this.lastKey = null;
    this.matchRewardAcc = 0;
    this.lastFeatures = null;
  }

  /** Called each AI tick — returns chosen action. */
  choose(features: LearnFeatures): LearnAction {
    const key = stateKey(features);
    const row = this.row(key);

    // Temporal-difference update from previous step (shaping reward)
    if (this.lastKey) {
      const reward = this.stepReward(features, this.lastFeatures);
      this.matchRewardAcc += reward;
      this.tdUpdate(this.lastKey, this.lastActionIdx, reward, key);
    }

    const explore = Math.random() < this.epsilon();
    this.explored = explore;
    let idx: number;
    if (explore) {
      idx =
        this.experience() > OLD_CAP_EXPERIENCE
          ? this.sampleSoftmax(row, features)
          : Math.floor(Math.random() * LEARN_ACTIONS.length);
    } else {
      idx = 0;
      let best = -Infinity;
      const scale = this.priorScale();
      for (let i = 0; i < row.length; i++) {
        const v = row[i] + this.actionBias(features, i) * scale;
        if (v > best) {
          best = v;
          idx = i;
        }
      }
    }

    this.lastKey = key;
    this.lastActionIdx = idx;
    this.lastActionName = LEARN_ACTIONS[idx];
    this.lastFeatures = { ...features };
    return this.lastActionName;
  }

  /** Whether the action just returned by choose() was an explore roll. */
  tookExplore() {
    return this.explored;
  }

  /**
   * The scripted policy actually did this, so the next TD update credits it
   * instead of an explore roll we refused to apply.
   */
  commitAction(action: LearnAction) {
    const idx = LEARN_ACTIONS.indexOf(action);
    if (idx < 0 || !this.lastKey) return;
    this.lastActionIdx = idx;
    this.lastActionName = action;
  }

  private stepReward(f: LearnFeatures, previous: LearnFeatures | null) {
    if (!previous) return 0;
    // Reward actual improvement since the previous decision rather than the
    // absolute board state, which previously reinforced stale actions.
    let r = (f.hpLead - previous.hpLead) * 0.035;
    const armySwing =
      (f.foeArmy - f.yourArmy) -
      (previous.foeArmy - previous.yourArmy);
    r += armySwing * 0.16;
    r += (f.foeTowers - previous.foeTowers) * 0.12;
    r += (f.foeBarracks - previous.foeBarracks) * 0.18;
    if (f.foeGold > 220) r -= 0.08;
    if (f.foeGold < 20) r -= 0.04;
    return r;
  }

  private tdUpdate(s: string, a: number, reward: number, s2: string) {
    const row = this.row(s);
    const next = this.row(s2);
    const maxNext = Math.max(...next);
    const target = reward + GAMMA * maxNext;
    row[a] += ALPHA * (target - row[a]);
    this.updates += 1;
    if (this.updates % 20 === 0) this.save();
  }

  endMatch(wonByFoe: boolean | null) {
    if (this.lastKey) {
      let terminal = this.matchRewardAcc * 0.05;
      if (wonByFoe === true) terminal += 4;
      else if (wonByFoe === false) terminal -= 3;
      else terminal -= 0.35;
      const row = this.row(this.lastKey);
      row[this.lastActionIdx] += ALPHA * (terminal - row[this.lastActionIdx]);
      this.updates += 1;
    }
    this.games += 1;
    if (wonByFoe === true) this.wins += 1;
    if (wonByFoe === false) this.losses += 1;
    this.save();
    this.lastKey = null;
  }
}

let brainSingleton: LearningBrain | null = null;

export function getFoeBrain() {
  if (!brainSingleton) brainSingleton = new LearningBrain();
  return brainSingleton;
}
