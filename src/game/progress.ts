import { hasCampaignUnit, unlockLine } from "./campaign";

export interface MetaProgress {
  xp: number;
  level: number;
  wins: number;
  matches: number;
  /** Bumps when player rerolls terrain at the same keep level. */
  scoutSalt: number;
}

const KEY = "roadkeep_meta_v1";

export function xpToLevel(xp: number) {
  return Math.max(1, Math.floor(Math.sqrt(xp / 40)) + 1);
}

export function xpForNextLevel(level: number) {
  return level * level * 40;
}

export function xpProgress(xp: number, level: number) {
  const prev = (level - 1) * (level - 1) * 40;
  const next = xpForNextLevel(level);
  return Math.max(0, Math.min(1, (xp - prev) / Math.max(1, next - prev)));
}

export function loadMeta(): MetaProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { xp: 0, level: 1, wins: 0, matches: 0, scoutSalt: 0 };
    const parsed = JSON.parse(raw) as MetaProgress;
    return {
      xp: parsed.xp ?? 0,
      level: xpToLevel(parsed.xp ?? 0),
      wins: parsed.wins ?? 0,
      matches: parsed.matches ?? 0,
      scoutSalt: parsed.scoutSalt ?? 0,
    };
  } catch {
    return { xp: 0, level: 1, wins: 0, matches: 0, scoutSalt: 0 };
  }
}

export function saveMeta(meta: MetaProgress) {
  localStorage.setItem(KEY, JSON.stringify(meta));
}

export function awardMatchXp(opts: {
  won: boolean;
  slain: number;
  waves: number;
  goldEarned: number;
}) {
  const meta = loadMeta();
  const prevLevel = meta.level;
  const gain =
    (opts.won ? 90 : 30) +
    opts.slain * 3 +
    opts.waves * 12 +
    Math.floor(opts.goldEarned / 40);
  meta.xp += gain;
  meta.level = xpToLevel(meta.xp);
  meta.matches += 1;
  if (opts.won) meta.wins += 1;
  // New keep level → fresh campaign map (reset scout salt)
  if (meta.level > prevLevel) meta.scoutSalt = 0;
  saveMeta(meta);
  return { meta, gain, leveledUp: meta.level > prevLevel };
}

export function bumpScoutSalt() {
  const meta = loadMeta();
  meta.scoutSalt += 1;
  saveMeta(meta);
  return meta;
}

/** Gather gold multiplier from keep level. */
export function gatherMult(level: number) {
  return 1 + Math.min(0.5, (level - 1) * 0.04);
}

/** Arcade and multiplayer leave every unit open. A march musters only what has been won. */
export function unitUnlocked(kind: string, _level: number, open = false) {
  if (open) return true;
  return hasCampaignUnit(kind);
}

export function unlockHint(kind: string) {
  return unlockLine(kind);
}
