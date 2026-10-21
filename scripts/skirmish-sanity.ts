import "./localstorage-shim";
import { GameSim } from "../src/game/sim";
import {
  FIRST_BUILD,
  RUSH_BONUS,
  START_GOLD,
  START_WOOD,
  UNIT_DEFS,
  VILLAGER_HP,
  WAVE_START_INCOME,
  WORLD_H,
  aiWaveStrength,
  combatWaveScale,
} from "../src/game/balance";
import { homeCameraZ } from "../src/game/homeCamera";
import { buildNodes, buildPads, keepPos, riverSpec, roadCenterX, skirmishMaps, villagerStart } from "../src/game/map";
import { isEnemyStructure, isOwnStructure } from "../src/game/ownership";
import { asNetMsg, parseRoomInput, snapshotUsable, splitWire, WireReassembly, type NetMsg, type RemoteOrder } from "../src/net/protocol";

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
pvp.applyRemoteOrder({ t: "move", team: "foe", ids: [foe.id, you.id], x: foe.pos.x + 36, y: foe.pos.y + 48 });
for (let i = 0; i < 40; i++) pvp.update(0.1);
assert(moved(foe.pos, foeStart) > 12, "foe peon should walk");
assert(moved(you.pos, youStart) < 1, "you peon must stay put");
assert(pvp.getState().selectedVillagerIds.includes(you.id), "host selection stays local");

const stoppedAt = { ...foe.pos };
pvp.applyRemoteOrder({ t: "stop", team: "foe", ids: [foe.id] });
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
pictured.applyRemoteOrder({ t: "move", team: "foe", ids: [walker.id], x: walker.pos.x + 70, y: walker.pos.y + 50 });
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

const predictHost = new GameSim();
predictHost.setMatchMode("pvp");
predictHost.startMatch();
const predictOpen = predictHost.exportSnapshot();
const predictGuest = new GameSim();
predictGuest.setMatchMode("pvp");
predictGuest.setLocalTeam("foe");
predictGuest.setOrderSink(() => {});
assert(predictGuest.applySnapshot(predictOpen), "prediction guest takes the opening picture");
for (let i = 0; i < 6; i++) predictGuest.tickPresentation(0.05);
const predictFoe = predictGuest.getState().villagers.find((v) => v.team === "foe");
const predictYou = predictGuest.getState().villagers.find((v) => v.team === "you");
assert(predictFoe && predictYou, "prediction picture has both peons");
const predictGold = predictGuest.getState().gold.foe;
const predictWood = predictGuest.getState().wood.foe;
predictGuest.click({ kind: "villager", id: String(predictFoe.id) });
const predictFrom = { ...predictFoe.pos };
const enemyFrom = { ...predictYou.pos };
predictGuest.commandSelected({ x: predictFoe.pos.x + 90, y: predictFoe.pos.y + 50 }, null, false);
assert(
  predictGuest.getState().commandMarkers.some((marker) => marker.kind === "move"),
  "guest move marker shows before the picture",
);
for (let i = 0; i < 5; i++) predictGuest.tickPresentation(0.05);
assert(moved(predictFoe.pos, predictFrom) > 4, "guest move prediction changes a foe peon's position before a snapshot");
assert(moved(predictYou.pos, enemyFrom) < 1, "an enemy you peon is not predicted from a guest order");
assert(predictGuest.getState().gold.foe === predictGold, "prediction does not change guest gold");
assert(predictGuest.getState().wood.foe === predictWood, "prediction does not change guest wood");
predictGuest.getState().selectedVillagerIds = [predictYou.id, predictFoe.id];
const enemyHeld = { ...predictYou.pos };
predictGuest.commandSelected({ x: predictYou.pos.x + 70, y: predictYou.pos.y + 40 }, null, false);
for (let i = 0; i < 4; i++) predictGuest.tickPresentation(0.05);
assert(moved(predictYou.pos, enemyHeld) < 1, "a guest order does not predict the enemy peon");

const predictedAt = { ...predictFoe.pos };
const near = predictHost.exportSnapshot();
const nearFoe = near.villagers.find((v) => v.id === predictFoe.id);
assert(nearFoe, "near picture still has the foe peon");
nearFoe.x = predictedAt.x + 12;
nearFoe.y = predictedAt.y + 6;
assert(moved(predictedAt, { x: nearFoe.x, y: nearFoe.y }) < 40, "near picture is a small correction");
assert(predictGuest.applySnapshot(near), "guest accepts the near picture");
const easing = predictGuest.getState().villagers.find((v) => v.id === predictFoe.id);
assert(easing, "easing peon stays on the guest");
assert(moved(easing.pos, predictedAt) < 1.5, "small picture error eases from the prediction");
assert(moved(easing.pos, { x: nearFoe.x, y: nearFoe.y }) > 4, "small picture error does not snap");
for (let i = 0; i < 8; i++) predictGuest.tickPresentation(0.05);
const eased = predictGuest.getState().villagers.find((v) => v.id === predictFoe.id);
assert(eased && moved(eased.pos, { x: nearFoe.x, y: nearFoe.y }) < 1, "eased peon reaches the host picture");
predictGuest.click({ kind: "villager", id: String(predictFoe.id) });
predictGuest.commandSelected({ x: eased.pos.x + 40, y: eased.pos.y + 24 }, null, false);
for (let i = 0; i < 3; i++) predictGuest.tickPresentation(0.05);
const beforeFar = { ...eased.pos };
const far = predictHost.exportSnapshot();
const farFoe = far.villagers.find((v) => v.id === predictFoe.id);
assert(farFoe, "far picture still has the foe peon");
farFoe.x = beforeFar.x + 120;
farFoe.y = beforeFar.y - 80;
assert(moved(beforeFar, { x: farFoe.x, y: farFoe.y }) > 40, "far picture is a large correction");
assert(predictGuest.applySnapshot(far), "guest accepts the far picture");
const snapped = predictGuest.getState().villagers.find((v) => v.id === predictFoe.id);
assert(snapped && moved(snapped.pos, { x: farFoe.x, y: farFoe.y }) < 1, "large picture error snaps to the host");
const enemyAfter = predictGuest.getState().villagers.find((v) => v.id === predictYou.id);
assert(enemyAfter && moved(enemyAfter.pos, enemyHeld) < 1, "enemy peon still follows pictures, not the guest order");

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

const northKeepZ = keepPos("foe").y - WORLD_H / 2;
const southKeepZ = keepPos("you").y - WORLD_H / 2;
assert(homeCameraZ("foe") < northKeepZ, "guest camera sits north of the north keep");
assert(homeCameraZ("you") > southKeepZ, "host camera stays south of the south keep");

const equal = new GameSim();
equal.setMatchMode("pvp");
equal.startMatch();
assert(equal.getState().gold.you === equal.getState().gold.foe, "both sides start with the same gold");
assert(equal.getState().wood.you === equal.getState().wood.foe, "both sides start with the same wood");
assert(
  equal.getState().villagers.filter((v) => v.team === "you").length ===
    equal.getState().villagers.filter((v) => v.team === "foe").length,
  "both sides start with the same peon count",
);

const youPeon = equal.getState().villagers.find((v) => v.team === "you");
const foePeon = equal.getState().villagers.find((v) => v.team === "foe");
assert(youPeon && foePeon, "equal start has both peons");
const youHeld = { ...youPeon.pos };
equal.applyRemoteOrder({ t: "move", team: "you", ids: [youPeon.id], x: youPeon.pos.x + 48, y: youPeon.pos.y - 36 });
for (let i = 0; i < 20; i++) equal.update(0.1);
assert(moved(youPeon.pos, youHeld) < 1, "a you-team order cannot move a you peon");

const guestOrders: RemoteOrder[] = [];
const guestCmd = new GameSim();
guestCmd.setMatchMode("pvp");
guestCmd.setLocalTeam("foe");
guestCmd.startMatch();
assert(guestCmd.getLocalTeam() === "foe", "guest local team is foe");
assert(guestCmd.getUiSnapshot().localTeam === "foe", "guest hud reads the foe side");
guestCmd.setOrderSink((order) => guestOrders.push(order));
const guestYou = guestCmd.getState().villagers.find((v) => v.team === "you");
const guestFoe = guestCmd.getState().villagers.find((v) => v.team === "foe");
assert(guestYou && guestFoe, "guest picture has both peons");
guestCmd.click({ kind: "villager", id: String(guestYou.id) });
assert(!guestCmd.getState().selectedVillagerIds.includes(guestYou.id), "guest cannot select a you peon");
guestCmd.click({ kind: "villager", id: String(guestFoe.id) });
assert(guestCmd.getState().selectedVillagerIds.includes(guestFoe.id), "guest selects a foe peon");
guestCmd.commandSelected({ x: guestFoe.pos.x + 20, y: guestFoe.pos.y + 30 }, null, false);
assert(guestOrders.some((order) => order.t === "move" && order.team === "foe"), "guest move order is stamped foe");
guestCmd.getState().selectedVillagerIds = [guestYou.id];
const sent = guestOrders.length;
guestCmd.commandSelected({ x: 40, y: 40 }, null, false);
assert(guestOrders.length === sent, "guest does not emit an order for a you peon");

const emptyPad = (sim: GameSim, team: "you" | "foe") =>
  sim.getState().pads.find(
    (pad) =>
      pad.team === team &&
      pad.zone === "combat" &&
      !sim.getState().buildings.some((building) => building.padId === pad.id),
  );
const guestPad = emptyPad(guestCmd, "foe");
assert(guestPad, "guest has an open combat pad");
guestCmd.selectBuild("barracks");
guestCmd.click({ kind: "pad", id: guestPad.id });
assert(guestCmd.getState().buildSelection === null, "guest leaves placement mode after ordering a build");
const guestBuild = guestOrders.find((order) => order.t === "build" && order.team === "foe");
assert(guestBuild?.t === "build" && guestBuild.padId === guestPad.id, "guest build order names the foe pad");
const hostPicture = new GameSim();
hostPicture.setMatchMode("pvp");
hostPicture.startMatch();
hostPicture.getState().gold.foe = 500;
hostPicture.getState().wood.foe = 500;
hostPicture.applyRemoteOrder(guestBuild!);
assert(guestCmd.applySnapshot(hostPicture.exportSnapshot()), "guest picture includes the ordered barracks");
assert(guestCmd.getState().selectedBuildingId != null, "guest selects the barracks they just placed");
assert(guestCmd.getUiSnapshot().trainOptions.length > 0, "placed barracks opens with training");
assert(guestCmd.getUiSnapshot().buildSelection === null, "placement mode stays off after the picture");

const foePad = emptyPad(equal, "foe");
const youPad = emptyPad(equal, "you");
assert(foePad && youPad, "both sides have an open combat pad");
equal.getState().gold.foe = 500;
equal.getState().wood.foe = 200;
equal.getState().gold.you = 500;
equal.getState().wood.you = 200;
const hostGold = equal.getState().gold.you;
equal.applyRemoteOrder({ t: "build", team: "foe", kind: "barracks", padId: foePad.id });
const foeBarracks = equal.getState().buildings.find((b) => b.padId === foePad.id);
assert(foeBarracks?.team === "foe" && foeBarracks.kind === "barracks", "remote build spawns a foe barracks");
assert(
  !equal.getState().buildings.some((b) => b.kind === "barracks" && b.team === "you"),
  "remote build does not spawn a you barracks",
);
equal.applyRemoteOrder({ t: "build", team: "you", kind: "barracks", padId: youPad.id });
assert(!equal.getState().buildings.some((b) => b.padId === youPad.id), "a you-team build is refused");
assert(equal.getState().gold.you === hostGold, "refused build does not spend host gold");

assert(isEnemyStructure("foe", "you"), "a you building is enemy to the guest");
assert(isOwnStructure("foe", "foe"), "a foe barracks is the guest's own");
assert(isEnemyStructure("you", "foe"), "a foe building stays enemy to the host");
assert(!isEnemyStructure("foe", foeBarracks.team), "guest helper treats the new barracks as own");

const viewer = new GameSim();
viewer.setMatchMode("pvp");
viewer.setLocalTeam("foe");
assert(viewer.applySnapshot(equal.exportSnapshot()), "guest copies the foe barracks");
viewer.getState().selectedBuildingId = foeBarracks.id;
const ownSheet = viewer.getUiSnapshot();
assert(ownSheet.localTeam === "foe", "copied guest still plays foe");
assert(ownSheet.selectedBuildingTeam === "foe", "selected barracks is foe");
assert(isOwnStructure(ownSheet.localTeam, ownSheet.selectedBuildingTeam), "guest sheet owns the foe barracks");
assert(ownSheet.trainOptions.length > 0, "guest barracks offers training");
const youBuilding = equal.getState().buildings.find((b) => b.team === "you");
assert(youBuilding, "host still has a building");
viewer.getState().selectedBuildingId = youBuilding.id;
const enemySheet = viewer.getUiSnapshot();
assert(isEnemyStructure(enemySheet.localTeam, enemySheet.selectedBuildingTeam), "host building is inspection-only for the guest");
assert(enemySheet.trainOptions.length === 0, "guest cannot train from a you building");
assert(!enemySheet.selectedCanRaze, "guest cannot raze a you building");

equal.applyRemoteOrder({ t: "train", team: "foe", kind: "levy", buildingId: foeBarracks.id });
assert(foeBarracks.queue.length === 1, "guest train queues on the foe barracks");
equal.applyRemoteOrder({ t: "train", team: "you", kind: "levy", buildingId: foeBarracks.id });
assert(foeBarracks.queue.length === 1, "a you-team train does not touch the foe barracks");
equal.getState().waveIndex = 16;
equal.selectBuild("barracks");
equal.click({ kind: "pad", id: youPad.id });
const youBarracks = equal.getState().buildings.find((b) => b.team === "you" && b.kind === "barracks");
assert(youBarracks, "host can still raise their own barracks");
equal.getState().selectedBuildingId = youBarracks.id;
assert(equal.enqueueTrain("levy", "you"), "host queues a levy");
equal.applyRemoteOrder({ t: "train", team: "foe", kind: "levy", buildingId: youBarracks.id });
assert(youBarracks.queue.length === 1, "guest train cannot use a you barracks");
for (let i = 0; i < 100; i++) equal.update(0.1);
const foeLevy = equal.getState().units.find((u) => u.team === "foe" && u.kind === "levy");
const youLevy = equal.getState().units.find((u) => u.team === "you" && u.kind === "levy");
assert(foeLevy && youLevy, "both skirmish sides trained a levy");
assert(Math.abs(foeLevy.maxHp - UNIT_DEFS.levy.hp) < 0.01, "skirmish foe levy has no wave buff");
assert(Math.abs(youLevy.maxHp - UNIT_DEFS.levy.hp) < 0.01, "skirmish you levy has no wave buff");
assert(Math.abs(foeLevy.damage - UNIT_DEFS.levy.damage) < 0.01, "skirmish foe levy damage is unscaled");
assert(Math.abs(youLevy.damage - UNIT_DEFS.levy.damage) < 0.01, "skirmish you levy damage is unscaled");

const aiLevy = new GameSim();
aiLevy.startMatch();
aiLevy.getState().waveIndex = 16;
aiLevy.getState().gold.foe = 500;
aiLevy.getState().wood.foe = 200;
assert(aiLevy.placeAiBuilding("barracks", 0), "ai barracks for the wave buff");
assert(aiLevy.enqueueTrain("levy", "foe"), "ai queues a levy");
for (let i = 0; i < 100; i++) aiLevy.update(0.1);
const scaledLevy = aiLevy.getState().units.find((u) => u.team === "foe" && u.kind === "levy");
assert(scaledLevy, "vs AI foe levy spawned");
assert(
  Math.abs(scaledLevy.maxHp - UNIT_DEFS.levy.hp * aiWaveStrength(16)) < 0.01,
  "vs AI foe still receives the wave buff",
);

const fallen = new GameSim();
fallen.setMatchMode("pvp");
fallen.setLocalTeam("foe");
fallen.startMatch();
fallen.getState().keeps.foe.hp = 0;
fallen.update(0.05);
const loss = fallen.getUiSnapshot();
assert(loss.phase === "ended", "foe keep falling ends the match");
assert(loss.yourHp === 0, "guest hud life is their own keep");
assert(loss.endReason.startsWith("Defeat"), "guest loses when their keep falls");

const levy = UNIT_DEFS.levy;
const threaten = (sim: GameSim, team: "you" | "foe", y: number) => {
  sim.getState().units.push({
    id: 8000 + sim.getState().units.length,
    team,
    kind: "levy",
    lane: 0,
    pos: { x: 200, y },
    hp: levy.hp,
    maxHp: levy.hp,
    speed: levy.speed,
    damage: levy.damage,
    bounty: levy.bounty,
    attackCooldown: levy.cooldown,
    attackTimer: 0,
    towerResist: levy.towerResist,
    keepMult: levy.keepMult,
    siegeGap: levy.siegeGap,
    targetKeep: true,
    fromBarracks: true,
    ignoreEnemyCreeps: false,
  });
};
const rally = new GameSim();
rally.setMatchMode("pvp");
rally.startMatch();
const rallyNotes: string[] = [];
rally.setRemoteNote((text) => rallyNotes.push(text));
threaten(rally, "foe", 640);
threaten(rally, "you", 40);
rally.update(0.1);
assert(
  rally.getState().villagers.filter((v) => v.team === "you").every((v) => v.state === "defend"),
  "host idle peons rally when their keep is threatened",
);
assert(
  rally.getState().villagers.filter((v) => v.team === "foe").every((v) => v.state === "defend"),
  "guest idle peons rally when their keep is threatened",
);
assert(rallyNotes.some((text) => text.includes("Peons rally")), "guest hears their own rally");
assert(
  rally.getState().toasts.some((toast) => toast.text.includes("Peons rally")),
  "host hears their own rally",
);

const rushHost = new GameSim();
rushHost.setMatchMode("pvp");
rushHost.startMatch();
const rushGold = { you: rushHost.getState().gold.you, foe: rushHost.getState().gold.foe };
const rushWave = rushHost.getState().waveIndex;
const rushPhase = rushHost.getState().wavePhase;
rushHost.rushNextWave();
rushHost.applyRemoteOrder({ t: "rush" });
assert(rushHost.getState().waveIndex === rushWave, "pvp rejects a rush-wave request");
assert(rushHost.getState().wavePhase === rushPhase, "pvp rush stays in the build phase");
assert(
  rushHost.getState().gold.you === rushGold.you && rushHost.getState().gold.foe === rushGold.foe,
  "pvp rush pays neither side",
);
const rushHud = rushHost.getUiSnapshot();
assert(rushHud.pvp && !rushHud.canRush, "host hud cannot rush in skirmish");

const rushGuest = new GameSim();
rushGuest.setMatchMode("pvp");
rushGuest.setLocalTeam("foe");
rushGuest.startMatch();
const guestRushOrders: RemoteOrder[] = [];
rushGuest.setOrderSink((order) => guestRushOrders.push(order));
rushGuest.rushNextWave();
assert(!guestRushOrders.some((order) => order.t === "rush"), "guest does not send a rush order");
const guestHud = rushGuest.getUiSnapshot();
assert(guestHud.pvp && !guestHud.canRush, "guest hud cannot rush in skirmish");
rushGuest.getState().buildTimer = 0.05;
const clockWave = rushGuest.getState().waveIndex;
rushGuest.update(0.1);
assert(rushGuest.getState().waveIndex === clockWave + 1, "skirmish clock still launches the wave");

const rushAi = new GameSim();
rushAi.startMatch();
assert(rushAi.getMatchMode() === "ai" && rushAi.getUiSnapshot().canRush, "vs AI rush stays available");
const aiGold = { you: rushAi.getState().gold.you, foe: rushAi.getState().gold.foe };
const aiWave = rushAi.getState().waveIndex;
rushAi.rushNextWave();
assert(rushAi.getState().waveIndex === aiWave + 1, "vs AI still accepts a rush-wave request");
assert(rushAi.getState().wavePhase === "spawning", "vs AI rush starts the wave");
const rushPay = RUSH_BONUS + WAVE_START_INCOME + Math.floor(aiWave * 3);
assert(rushAi.getState().gold.you === aiGold.you + rushPay, "vs AI rush still pays the human");
assert(rushAi.getState().gold.foe === aiGold.foe + rushPay, "vs AI rush still pays the foe");

const campaign = new GameSim();
const campaignId = campaign.getState().mapId;
campaign.startMatch();
assert(campaign.getMatchMode() === "ai", "versus AI stays versus AI");
assert(campaign.getState().mapId === campaignId, "versus AI keeps its current map");

const layouts = skirmishMaps();
assert(
  layouts.map((map) => map.name).join("|") === "Night Crossing|Ashen Ford|Copper Bend|Hollow March",
  "skirmish maps are named",
);
assert(new Set(layouts.map((map) => map.id)).size === layouts.length, "skirmish map ids differ");
assert(new Set(layouts.map((map) => map.seed)).size === layouts.length, "skirmish seeds differ");
const rivers = layouts.map((map) => riverSpec(map.seed));
assert(rivers.every((river) => river.enabled), "each skirmish map has a river");
for (let i = 0; i < rivers.length; i++) {
  for (let j = i + 1; j < rivers.length; j++) {
    assert(Math.abs(rivers[i].y - rivers[j].y) >= 40, "rivers sit in different places");
  }
}
const roadSig = (seed: number) => {
  const ys = [180, 280, 360, 440, 540];
  const pts: number[] = [];
  for (const lane of [0, 1] as const) {
    for (const y of ys) pts.push(Math.round(roadCenterX(seed, lane, y)));
  }
  return pts.join(",");
};
assert(new Set(layouts.map((map) => roadSig(map.seed))).size === layouts.length, "roads bend differently");
for (const map of layouts) {
  const pads = buildPads(map);
  const nodes = buildNodes(map);
  assert(
    pads.filter((pad) => pad.team === "you").length === pads.filter((pad) => pad.team === "foe").length,
    `${map.name} pads mirror`,
  );
  assert(
    nodes.filter((node) => node.team === "you").length === nodes.filter((node) => node.team === "foe").length,
    `${map.name} resources mirror`,
  );
  assert(nodes.filter((node) => node.team === "you").length >= 3, `${map.name} has resources`);
}

const rematchGuest = new GameSim();
rematchGuest.setMatchMode("pvp");
rematchGuest.setLocalTeam("foe");
rematchGuest.startMatch();
const beforeMap = rematchGuest.getState().mapId;
const nextMap = layouts.find((map) => map.id !== beforeMap) ?? layouts[0];
const donor = rematchGuest.getState().villagers[0];
const spareTower = rematchGuest.getState().buildings[0];
rematchGuest.getState().villagers.push({ ...donor, id: 4242, pos: { x: donor.pos.x, y: donor.pos.y } });
rematchGuest.getState().buildings.push({ ...spareTower, id: 4343, kind: "barracks", padId: "leftover-pad" });
rematchGuest.getState().gold.you = 7777;
rematchGuest.getState().gold.foe = 7777;
rematchGuest.getState().wood.you = 1;
rematchGuest.getState().wood.foe = 1;
rematchGuest.getState().waveIndex = 11;
rematchGuest.getState().wavePhase = "fighting";
rematchGuest.getState().allWavesLaunched = true;
rematchGuest.getState().phase = "ended";
const node = rematchGuest.getState().nodes[0];
node.loadsLeft = 0;

const rematchMsg: NetMsg = { t: "rematch", mapId: nextMap.id };
const parsedRematch = asNetMsg(JSON.parse(JSON.stringify(rematchMsg)));
assert(parsedRematch?.t === "rematch" && parsedRematch.mapId === nextMap.id, "rematch message carries the map id");
if (parsedRematch?.t !== "rematch") throw new Error("rematch message");
const rematchId = parsedRematch.mapId;
assert(asNetMsg({ t: "rematch", mapId: "seed-999999" }) === null, "an unknown rematch map is rejected");
assert(asNetMsg({ t: "pick", mapId: layouts[1].id })?.t === "pick", "map choice message parses");

const hostIdentity = new GameSim();
hostIdentity.setMatchMode("pvp");
hostIdentity.setLocalTeam("you");
hostIdentity.startMatch();
const hostMap = hostIdentity.getState().mapId;
const hostPeons = hostIdentity.getState().villagers.length;
hostIdentity.getState().villagers.push({ ...hostIdentity.getState().villagers[0], id: 5151, pos: { x: 1, y: 1 } });
assert(!hostIdentity.applyRematch(rematchId, "guest"), "guest cannot apply rematch onto the host's team identity");
assert(hostIdentity.getLocalTeam() === "you", "host team stays you");
assert(hostIdentity.getState().mapId === hostMap, "refused rematch does not switch the host map");
assert(hostIdentity.getState().villagers.some((v) => v.id === 5151), "refused rematch leaves the host match alone");
assert(hostIdentity.getState().villagers.length === hostPeons + 1, "refused rematch does not reset the host");

assert(rematchGuest.applyRematch(rematchId, "guest"), "guest applies the host rematch");
assert(rematchGuest.getState().mapId === rematchId && rematchGuest.getState().mapId !== beforeMap, "rematch switches map id");
assert(rematchGuest.getLocalTeam() === "foe", "guest stays on the north side");
assert(rematchGuest.getState().commandTeam === "foe", "guest commands stay foe");
assert(rematchGuest.getUiSnapshot().localTeam === "foe", "guest hud stays foe");
assert(!rematchGuest.getState().villagers.some((v) => v.id === 4242), "rematch clears a leftover peon");
assert(!rematchGuest.getState().buildings.some((b) => b.id === 4343), "rematch clears a leftover building");
assert(rematchGuest.getState().buildings.length === 2, "new match has the two starting towers");
assert(rematchGuest.getState().buildings.every((b) => b.kind === "watchtower"), "starting towers only");
assert(rematchGuest.getState().villagers.length === 4, "new match has the starting peons");
assert(rematchGuest.getState().units.length === 0, "new match has no soldiers");
assert(rematchGuest.getState().phase === "running", "rematch is a live match");
assert(rematchGuest.getState().waveIndex === 0 && rematchGuest.getState().wavePhase === "build", "wave state is a new match");
assert(!rematchGuest.getState().allWavesLaunched, "wave flag resets");
assert(rematchGuest.getState().buildTimer === FIRST_BUILD, "build clock resets");
assert(
  rematchGuest.getState().gold.you === START_GOLD && rematchGuest.getState().gold.foe === START_GOLD,
  "gold resets for both sides",
);
assert(
  rematchGuest.getState().wood.you === START_WOOD && rematchGuest.getState().wood.foe === START_WOOD,
  "wood resets for both sides",
);
assert(rematchGuest.getState().nodes.every((n) => n.loadsLeft === n.maxLoads), "resources are full again");
const north = villagerStart("foe", 0);
const south = villagerStart("you", 0);
const guestPeon = rematchGuest.getState().villagers.find((v) => v.team === "foe");
const hostPeon = rematchGuest.getState().villagers.find((v) => v.team === "you");
assert(guestPeon && Math.abs(guestPeon.pos.y - north.y) < 1, "guest peons start at the north keep");
assert(hostPeon && Math.abs(hostPeon.pos.y - south.y) < 1, "host peons stay at the south keep");
assert(!rematchGuest.getUiSnapshot().canRush, "rematch still cannot rush");
rematchGuest.rushNextWave();
assert(rematchGuest.getState().waveIndex === 0, "rematch rush does not start a wave");

const walked = { ...guestPeon!.pos };
rematchGuest.applyRemoteOrder({
  t: "move",
  team: "foe",
  ids: [guestPeon!.id],
  x: guestPeon!.pos.x + 36,
  y: guestPeon!.pos.y + 40,
});
for (let i = 0; i < 30; i++) rematchGuest.update(0.1);
assert(moved(guestPeon!.pos, walked) > 8, "orders still move a peon on the new match");
const picture = rematchGuest.exportSnapshot();
assert(picture.mapId === rematchId && picture.phase === "running", "snapshot is the new match");
assert(picture.buildings.length === 2 && picture.villagers.length === 4, "snapshot has no leftovers");

console.log("skirmish sanity ok");
