import type { GameSim } from "./sim";
import { getFoeBrain, type LearnAction, type LearnFeatures } from "./learningAi";
import type { TrainKind } from "./types";

function featuresFrom(sim: GameSim): LearnFeatures {
  const s = sim.getState();
  const yours = s.buildings.filter((b) => b.team === "you");
  const foes = s.buildings.filter((b) => b.team === "foe");
  return {
    yourTowers: yours.filter((b) => b.kind !== "barracks").length,
    yourArmy: s.units.filter((u) => u.team === "you").length,
    yourBarracks: yours.filter((b) => b.kind === "barracks").length,
    foeTowers: foes.filter((b) => b.kind !== "barracks").length,
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
  sim.aiAssignWorkers();
  // Eco first: houses raise peon cap; queue peons when under cap
  const houses = sim.getBuildings("foe").filter((b) => b.kind === "house").length;
  if (houses < 1 && sim.getState().wood.foe >= 55) {
    sim.placeAiBuilding("house");
  } else if (sim.peonSlotsUsed("foe") < sim.peonCap("foe") && Math.random() < 0.35) {
    sim.enqueuePeon("foe");
  }
  const action = brain.choose(featuresFrom(sim));
  applyAction(sim, action);
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
