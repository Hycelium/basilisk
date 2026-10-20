import "./localstorage-shim";
import { GameSim } from "../src/game/sim";
import { VILLAGER_HP, aiWaveStrength, combatWaveScale } from "../src/game/balance";
import { parseRoomInput, snapshotUsable, splitWire, WireReassembly, type NetMsg } from "../src/net/protocol";

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

const pictured = new GameSim();
pictured.setMatchMode("pvp");
pictured.startMatch();
const walker = pictured.getState().villagers.find((v) => v.team === "foe");
assert(walker, "foe peon for the picture");
const walkerStart = { ...walker.pos };
pictured.applyRemoteOrder({ t: "move", ids: [walker.id], x: walker.pos.x + 70, y: walker.pos.y + 50 });
for (let i = 0; i < 5; i++) pictured.update(0.1);
const snap1 = pictured.exportSnapshot();
for (let i = 0; i < 8; i++) pictured.update(0.1);
const snap2 = pictured.exportSnapshot();
assert(snapshotUsable(snap1) && snapshotUsable(snap2), "exported pictures are usable");
const single = splitWire({ t: "snap", snap: snap1 }, 1);
assert(single.length === 1 && single[0].t === "snap", "a normal picture stays one message");
const picturedSpot = snap2.villagers.find((v) => v.id === walker.id);
assert(picturedSpot && moved({ x: picturedSpot.x, y: picturedSpot.y }, walkerStart) > 8, "the two pictures differ");

const guest = new GameSim();
guest.setMatchMode("pvp");
guest.setLocalTeam("foe");
assert(guest.applySnapshot(snap1), "guest accepts the first picture");
const clock = guest.getState().time;
for (let i = 0; i < 4; i++) guest.tickPresentation(0.05);
assert(guest.getState().time > clock + 0.15, "guest clock advances between pictures");
const shown = guest.getState().villagers.find((v) => v.id === walker.id);
assert(shown, "pictured peon is on the guest");
const mid = { ...shown.pos };
assert(guest.applySnapshot(snap2), "guest accepts the second picture");
for (let i = 0; i < 30; i++) guest.tickPresentation(0.05);
const arrived = guest.getState().villagers.find((v) => v.id === walker.id);
assert(arrived, "pictured peon stays on the guest");
assert(moved(arrived.pos, mid) > 4, "guest peon slides toward the newer picture");
assert(moved(arrived.pos, { x: picturedSpot.x, y: picturedSpot.y }) < 1, "guest peon arrives at the pictured spot");
assert(guest.getState().gold.you === snap2.gold.you, "guest gold comes from the picture");
assert(guest.getState().buildTimer === snap2.buildTimer, "guest does not step the build clock itself");

const covered = new GameSim();
covered.setMatchMode("pvp");
covered.startMatch();
const coveredAt = covered.getState().time;
covered.stepMatch(1, true);
assert(covered.getState().time > coveredAt + 0.9, "a covered host catches up a second of match time");
const open = new GameSim();
open.setMatchMode("pvp");
open.startMatch();
const openAt = open.getState().time;
open.stepMatch(1, false);
assert(open.getState().time < openAt + 0.06, "a visible host still steps one slice per frame");

const bulky = "x".repeat(15000);
const parts = splitWire({ t: "note", text: bulky }, 7);
assert(parts.length > 1, "an oversized message is split");
assert(
  parts.every((part) => part.t === "part" && new TextEncoder().encode(JSON.stringify(part)).length < 16300),
  "each piece fits the JSON channel",
);
const box = new WireReassembly();
let rebuilt: NetMsg | "bad" | null = null;
for (const part of parts) {
  if (part.t !== "part") throw new Error("expected part");
  rebuilt = box.take(part);
}
assert(rebuilt !== "bad" && rebuilt?.t === "note" && rebuilt.text === bulky, "parts reassemble");

console.log("skirmish sanity ok");
