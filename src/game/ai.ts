import type { GameSim } from "./sim";
import { getFoeBrain, type LearnAction, type LearnFeatures } from "./learningAi";
import type { TrainKind } from "./types";

function featuresFrom(sim: GameSim): LearnFeatures {
  const s = sim.getState();
  const yours = s.buildings.filter((b) => b.team === "you");
  const foes = s.buildings.filter((b) => b.team === "foe");
  const isCombatStructure = (kind: (typeof yours)[number]["kind"]) =>
    kind !== "barracks" && kind !== "house" && kind !== "barricade";
  return {
    yourTowers: yours.filter((b) => isCombatStructure(b.kind)).length,
    yourArmy: s.units.filter((u) => u.team === "you").length,
    yourBarracks: yours.filter((b) => b.kind === "barracks").length,
    foeTowers: foes.filter((b) => isCombatStructure(b.kind)).length,
    foeArmy: s.units.filter((u) => u.team === "foe").length,
    foeBarracks: foes.filter((b) => b.kind === "barracks").length,
    foeGold: s.gold.foe,
    yourGold: s.gold.you,
    wave: s.waveIndex,
    hpLead: s.keeps.foe.hp - s.keeps.you.hp,
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
      if (!sim.aiUpgradeWeakestTower()) fallbackMacro(sim);
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

export function runAiTurn(sim: GameSim, _reserve: number) {
  const brain = getFoeBrain();
  const skill = brain.stats().intellect;
  const state = sim.getState();
  sim.aiAssignWorkers();

  // Defensive opening book: establish population, saturate economy, and cover
  // both lanes before spending heavily on aggression.
  const houses = sim.getBuildings("foe").filter((b) => b.kind === "house").length;
  const desiredHouses = state.waveIndex >= 4 ? 3 : state.waveIndex >= 2 ? 2 : 1;
  if (houses < desiredHouses && state.wood.foe >= 55) {
    sim.placeAiBuilding("house", 0);
  }
  if (sim.peonSlotsUsed("foe") < sim.peonCap("foe")) {
    sim.enqueuePeon("foe");
  }

  const defenses = sim
    .getBuildings("foe")
    .filter((b) => b.kind === "watchtower" || b.kind === "ballista" || b.kind === "catapult");
  const desiredDefenses = state.waveIndex < 2 ? 2 : state.waveIndex < 5 ? 3 : 4;
  if (defenses.length < desiredDefenses) {
    const heavyCoverage = defenses.length >= 2 && state.waveIndex >= 2;
    sim.placeAiBuilding(heavyCoverage ? "ballista" : "watchtower", skill >= 45 ? 0 : 10);
  }

  const barracks = sim.getBuildings("foe").filter((b) => b.kind === "barracks");
  if (barracks.length === 0 && state.waveIndex >= 1 && defenses.length >= 2) {
    sim.placeAiBuilding("barracks", 10);
  } else if (barracks.length > 0) {
    // Keep production active; failed attempts are harmless when resources are
    // reserved or queues are full.
    sim.aiTrainUnits();
  }

  const action = brain.choose(featuresFrom(sim));
  applyAction(sim, action);

  // Experienced brains execute a second macro action instead of waiting a
  // full decision cycle while floating resources.
  if (skill >= 45 && state.gold.foe > 120) {
    if (!sim.aiUpgradeWeakestTower()) sim.aiTrainUnits();
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
