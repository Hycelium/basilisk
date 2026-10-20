import "./localstorage-shim";
import { GameSim } from "../src/game/sim";
import { VILLAGER_HP, aiWaveStrength, combatWaveScale } from "../src/game/balance";
import { parseRoomInput } from "../src/net/protocol";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

function moved(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const parsed = parseRoomInput("https://ka9krew.github.io/roadkeep/?room=abc123");
assert(parsed === "abc123", `parse room from link, got ${parsed}`);
assert(parseRoomInput("room=deadbeef") === "deadbeef", "parse room from query fragment");

const pvp = new GameSim();
pvp.setMatchMode("pvp");
pvp.startMatch();
const foe = pvp.getState().villagers.find((v) => v.team === "foe");
const you = pvp.getState().villagers.find((v) => v.team === "you");
assert(foe && you, "both peons exist");
const foeStart = { ...foe.pos };
const youStart = { ...you.pos };
pvp.getState().selectedVillagerIds = [you.id];
pvp.applyRemoteOrder({ t: "move", ids: [foe.id, you.id], x: foe.pos.x + 36, y: foe.pos.y + 48 });
for (let i = 0; i < 40; i++) pvp.update(0.1);
assert(moved(foe.pos, foeStart) > 12, "foe peon should walk");
assert(moved(you.pos, youStart) < 1, "you peon must stay put");
assert(pvp.getState().selectedVillagerIds.includes(you.id), "host selection stays local");

const stoppedAt = { ...foe.pos };
pvp.applyRemoteOrder({ t: "stop", ids: [foe.id] });
assert(foe.state === "defend", "stop holds the foe peon");
for (let i = 0; i < 10; i++) pvp.update(0.1);
assert(foe.state === "defend", "guard order sticks");
assert(moved(foe.pos, stoppedAt) < 2, "stopped foe peon does not keep marching");
assert(moved(you.pos, youStart) < 1, "stop does not touch the host peon");

const beforeBuildings = pvp.getState().buildings.filter((b) => b.team === "foe").length;
pvp.getState().gold.foe = 4000;
pvp.getState().wood.foe = 4000;
for (let i = 0; i < 80; i++) pvp.update(0.1);
assert(
  pvp.getState().buildings.filter((b) => b.team === "foe").length === beforeBuildings,
  "pvp must not run foe economy AI",
);
assert(pvp.getState().keeps.foe.peonQueue.length === 0, "pvp must not queue foe peons by AI");

pvp.getState().waveIndex = 16;
assert(pvp.placeAiBuilding("house", 0), "house pad available for the scale check");
assert(pvp.enqueuePeon("foe"), "foe pop allows another peon");
for (let i = 0; i < 120; i++) pvp.update(0.1);
const trained = pvp.getState().villagers.filter((v) => v.team === "foe");
assert(trained.length > 2, "trained foe peon spawned");
assert(
  trained.every((v) => Math.abs(v.maxHp - VILLAGER_HP) < 0.01),
  "pvp foe peons stay at human hit points",
);

const ai = new GameSim();
assert(ai.getMatchMode() === "ai", "vs AI is the default");
ai.startMatch();
ai.getState().gold.foe = 4000;
ai.getState().wood.foe = 4000;
let constructed = false;
for (let i = 0; i < 30 && !constructed; i++) {
  ai.update(0.1);
  constructed = ai.getState().buildings.filter((b) => b.team === "foe").length > 1;
}
assert(constructed, "vs AI still constructs");

ai.getState().waveIndex = 16;
assert(ai.placeAiBuilding("house", 0), "ai house for wave scale");
const before = ai.getState().villagers.filter((v) => v.team === "foe").length;
assert(ai.enqueuePeon("foe"), "ai can queue a foe peon");
for (let i = 0; i < 120; i++) ai.update(0.1);
const scaled = ai.getState().villagers.filter((v) => v.team === "foe");
assert(scaled.length > before, "ai foe peon spawned");
const doubled = VILLAGER_HP * aiWaveStrength(16);
assert(
  scaled.some((v) => Math.abs(v.maxHp - doubled) < 0.01),
  "vs AI foe still uses the wave helper",
);
assert(combatWaveScale("foe", 16) === 2, "wave helper at wave 16 is unchanged");
assert(combatWaveScale("you", 16) === 1, "human side of the helper is unchanged");
assert(combatWaveScale("foe", 1) === 1, "wave 1 foe scale is unchanged");

console.log("skirmish sanity ok");
