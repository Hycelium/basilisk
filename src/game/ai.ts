import type { GameSim } from "./sim";
import { getFoeBrain, veryHard, type LearnAction, type LearnFeatures } from "./learningAi";
import type { TrainKind } from "./types";

function featuresFrom(sim: GameSim): LearnFeatures {
  const s = sim.getState();
  const yours = s.buildings.filter((b) => b.team === "you");
  const foes = s.buildings.filter((b) => b.team === "foe");
  // Composition knowledge is limited to units that have crossed toward the
  // foe's half of the map; production queues remain hidden.
  const observedArmy = s.units.filter((u) => u.team === "you" && u.pos.y <= 430);
  const isCombatStructure = (kind: (typeof yours)[number]["kind"]) =>
    kind !== "barracks" && kind !== "house" && kind !== "barricade";
  return {
    yourTowers: yours.filter((b) => isCombatStructure(b.kind)).length,
    yourArmy: observedArmy.length,
    yourBarracks: yours.filter((b) => b.kind === "barracks").length,
    foeTowers: foes.filter((b) => isCombatStructure(b.kind)).length,
    foeArmy: s.units.filter((u) => u.team === "foe").length,
    foeBarracks: foes.filter((b) => b.kind === "barracks").length,
    foeGold: s.gold.foe,
    yourGold: s.gold.you,
    wave: s.waveIndex,
    hpLead: s.keeps.foe.hp - s.keeps.you.hp,
    yourFast: observedArmy.filter((u) => u.kind === "runner" || u.kind === "raider").length,
    yourHeavy: observedArmy.filter((u) => u.kind === "brute" || u.kind === "ward" || u.kind === "rammer").length,
    yourRanged: observedArmy.filter((u) => u.kind === "archer").length,
  };
}

function applyAction(sim: GameSim, action: LearnAction) {
  switch (action) {
    case "build_watch":
      if (!sim.placeAiBuilding("watchtower")) sim.aiTrainUnits();
      break;
    case "build_ballista":
      if (!sim.placeAiBuilding("ballista")) sim.aiTrainUnits();
      break;
    case "build_catapult":
      if (!sim.placeAiBuilding("catapult")) sim.aiTrainUnits();
      break;
    case "build_barracks":
      if (!sim.placeAiBuilding("barracks")) sim.aiTrainUnits();
      break;
    case "train_levy":
      if (!sim.aiEnqueueTrain("levy")) fallbackMacro(sim);
      break;
    case "train_runner":
      if (!sim.aiEnqueueTrain("runner")) fallbackMacro(sim);
      break;
    case "train_archer":
      if (!sim.aiEnqueueTrain("archer")) fallbackMacro(sim);
      break;
    case "train_ward":
      if (!sim.aiEnqueueTrain("ward")) fallbackMacro(sim);
      break;
    case "train_rammer":
      if (!sim.aiEnqueueTrain("rammer")) fallbackMacro(sim);
      break;
    case "upgrade":
      if (!sim.aiUpgradeDefense("adaptive")) fallbackMacro(sim);
      break;
    case "upgrade_damage":
      if (!sim.aiUpgradeDefense("damage")) fallbackMacro(sim);
      break;
    case "upgrade_rate":
      if (!sim.aiUpgradeDefense("rate")) fallbackMacro(sim);
      break;
    case "econ":
      sim.aiAssignWorkers();
      break;
    case "wait":
    default:
      // Still gather so idle ticks aren't wasted
      sim.aiAssignWorkers();
      break;
  }
}

/** If the chosen micro-action fails (no gold / no pad), keep pressure. */
function fallbackMacro(sim: GameSim) {
  const foes = sim.getBuildings("foe");
  if (foes.length < 2) {
    sim.placeAiBuilding("watchtower");
    return;
  }
  if (!foes.some((b) => b.kind === "barracks")) {
    sim.placeAiBuilding("barracks");
    return;
  }
  sim.aiTrainUnits();
}

function learnedFrom(kind: TrainKind | null, rush: boolean): LearnAction {
  if (kind === "levy") return "train_levy";
  if (kind === "runner") return "train_runner";
  if (kind === "archer") return "train_archer";
  if (kind === "ward") return "train_ward";
  if (kind === "rammer") return "train_rammer";
  return rush ? "build_watch" : "wait";
}

export function runAiTurn(sim: GameSim, _reserve: number) {
  const brain = getFoeBrain();
  const skill = brain.stats().intellect;
  const hard = veryHard(skill);
  const state = sim.getState();
  const read = sim.readHumanForAi();
  // Awareness is always recorded. Only level 10+ lets it pull workers or
  // replace the learning book, so a new brain stays beatable.
  const rush = hard && read.rush;
  const rushNear = hard && read.rushNear;

  if (!rushNear) sim.aiAssignWorkers();

  // Defensive opening book: establish population, saturate economy, and cover
  // both lanes before spending heavily on aggression. A real levy rush skips
  // new houses so gold is not sitting in eco while levies walk the road.
  const houses = sim.getBuildings("foe").filter((b) => b.kind === "house").length;
  const desiredHouses = state.waveIndex >= 4 ? 3 : state.waveIndex >= 2 ? 2 : 1;
  if (!rush && houses < desiredHouses && state.wood.foe >= 55) {
    sim.placeAiBuilding("house", 0);
  }
  if (!rushNear && sim.peonSlotsUsed("foe") < sim.peonCap("foe")) {
    sim.enqueuePeon("foe");
  }

  const defenses = sim
    .getBuildings("foe")
    .filter((b) => b.kind === "watchtower" || b.kind === "ballista" || b.kind === "catapult");
  const desiredDefenses = state.waveIndex < 2 ? 2 : state.waveIndex < 5 ? 3 : 4;
  if (defenses.length < desiredDefenses) {
    // Past the old cap, step into ballista a wave sooner instead of stacking watchtowers.
    const heavyCoverage =
      skill > 99
        ? defenses.length >= 1 && state.waveIndex >= 1
        : defenses.length >= 2 && state.waveIndex >= 2;
    sim.placeAiBuilding(heavyCoverage ? "ballista" : "watchtower", skill >= 45 ? 0 : 10);
  }
  if (rush) {
    sim.aiAnswerLevyRush();
  } else if (defenses.length >= (skill > 160 ? 1 : 2) && state.waveIndex >= 1) {
    sim.aiBuildDefensiveBarricade();
  }

  const barracks = sim.getBuildings("foe").filter((b) => b.kind === "barracks");
  let filled: TrainKind | null = null;
  if (barracks.length === 0 && state.waveIndex >= 1 && defenses.length >= (rush ? 1 : 2)) {
    sim.placeAiBuilding("barracks", rush ? 0 : 10);
  } else if (barracks.length > 0) {
    // Keep production active; failed attempts are harmless when resources are
    // reserved or queues are full. Very hard fills a mixed wave instead of
    // whatever single kind the last observe suggested.
    if (hard) filled = sim.aiFillWave(skill);
    else sim.aiTrainUnits();
  }
  sim.aiCoordinateRush(skill);

  const holding = hard && sim.foeWaveHolding();
  const action = brain.choose(featuresFrom(sim));
  // Explore must not spend the gold a levy rush needs, or queue a stray unit
  // that would walk out alone. Greedy Q may still nudge an upgrade or a
  // counter that matches the rush.
  const contradictsRush =
    rush &&
    (action === "wait" ||
      action === "econ" ||
      action === "train_levy" ||
      action === "train_runner" ||
      action === "train_rammer" ||
      action === "build_catapult");
  if ((rush || holding) && brain.tookExplore()) {
    brain.commitAction(learnedFrom(filled, rush));
  } else if (contradictsRush) {
    brain.commitAction(learnedFrom(filled, true));
  } else {
    applyAction(sim, action);
  }

  // Experienced brains spend a second action on the learned plan instead of
  // floating gold. The gate keeps falling past level 99, with a floor so they
  // still hold a reserve.
  const followGold = skill <= 99 ? 120 : Math.max(72, 120 - (skill - 99) * 0.28);
  if (skill >= 45 && state.gold.foe > followGold) {
    if (!sim.aiUpgradeDefense("adaptive")) {
      if (hard) sim.aiFillWave(skill);
      else sim.aiTrainUnits();
    }
  }
}

export function notifyAiMatchStart() {
  getFoeBrain().beginMatch();
}

/** won === true means the human won (foe lost). */
export function notifyAiMatchEnd(humanWon: boolean | null) {
  const wonByFoe = humanWon === null ? null : !humanWon;
  getFoeBrain().endMatch(wonByFoe);
}

export function foeBrainStats() {
  return getFoeBrain().stats();
}

// Re-export for trainers that want typed train kinds
export type { TrainKind };
