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
}

export interface BrainStats {
  games: number;
  wins: number;
  losses: number;
  updates: number;
  epsilon: number;
  intellect: number; // 1–99 display
  lastAction: string;
}

interface BrainSave {
  q: Record<string, number[]>;
  games: number;
  wins: number;
  losses: number;
  updates: number;
  version: number;
}

const KEY = "roadkeep_foe_brain_v1";
const ALPHA = 0.36;
const GAMMA = 0.88;
const EPS_START = 0.24;
const EPS_MIN = 0.03;

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

  epsilon() {
    return Math.max(EPS_MIN, EPS_START - this.games * 0.022);
  }

  intellect() {
    // Permanent experience only: games, updates, and wins never decrease, so
    // the displayed IQ can no longer reverse after a loss.
    const experience =
      this.games * 4 +
      this.wins * 3 +
      Math.floor(this.updates / 24);
    return Math.max(8, Math.min(99, 8 + experience));
  }

  stats(): BrainStats {
    return {
      games: this.games,
      wins: this.wins,
      losses: this.losses,
      updates: this.updates,
      epsilon: this.epsilon(),
      intellect: this.intellect(),
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

    let idx: number;
    if (Math.random() < this.epsilon()) {
      idx = Math.floor(Math.random() * LEARN_ACTIONS.length);
    } else {
      idx = 0;
      let best = -Infinity;
      for (let i = 0; i < row.length; i++) {
        // Soft prior: early game prefer economy/build, late prefer train
        let v = row[i];
        if (features.foeTowers < 2 && LEARN_ACTIONS[i].startsWith("build")) v += 0.15;
        if (features.foeBarracks > 0 && LEARN_ACTIONS[i].startsWith("train")) v += 0.22;
        if (features.yourTowers >= 3 && (LEARN_ACTIONS[i] === "train_ward" || LEARN_ACTIONS[i] === "train_runner")) v += 0.42;
        if (features.yourArmy >= 4 && LEARN_ACTIONS[i] === "train_archer") v += 0.38;
        if (features.yourBarracks > 0 && LEARN_ACTIONS[i] === "train_rammer") v += 0.24;
        if (features.foeGold > 170 && LEARN_ACTIONS[i] === "wait") v -= 0.5;
        if (features.hpLead < -50 && (LEARN_ACTIONS[i] === "upgrade" || LEARN_ACTIONS[i] === "build_ballista")) v += 0.3;
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
