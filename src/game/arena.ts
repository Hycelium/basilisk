import * as THREE from "three";
import { WORLD_H, WORLD_W } from "./balance";
import type { MapDef, Team, UnitKind } from "./types";
import { crenellate, flaredRoof, materials, roundTower, tiledBox } from "./models/materials";

/** Gun-game ladder: one kill advances one rung; death drops one (floor peon). */
export const ARENA_LADDER: UnitKind[] = ["peon", "levy", "archer", "ward", "runner"];
export const ARENA_BOT_COUNT = 6;
/** Half-extent of the playable courtyard (sim units). */
export const ARENA_HALF = 108;
export const ARENA_CX = WORLD_W / 2;
export const ARENA_CY = WORLD_H / 2;
export const ARENA_RESPAWN_DELAY = 2.4;
/** Courtyard wall half-width in model units (oversized keep footprint). */
export const ARENA_COURTYARD_W = 92;

export const ARENA_SEED = 424242;

export function arenaMap(): MapDef {
  return {
    id: "arena-gun",
    seed: ARENA_SEED,
    name: "The Courtyard",
    tagline: "Gun game · free-for-all practice",
    lanes: 1,
    pads: [{ id: "yard", x: ARENA_CX, y: ARENA_CY, laneCoverage: [0], zone: "combat" }],
    nodes: [],
    startTowerPad: "yard",
  };
}

export function arenaSpawnPoints(count: number): { x: number; y: number }[] {
  const n = Math.max(1, count);
  const radius = ARENA_HALF * 0.72;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push({
      x: ARENA_CX + Math.cos(a) * radius,
      y: ARENA_CY + Math.sin(a) * radius,
    });
  }
  return out;
}

export function clampToArena(pos: { x: number; y: number }, margin = 6) {
  const lim = ARENA_HALF - margin;
  pos.x = Math.max(ARENA_CX - lim, Math.min(ARENA_CX + lim, pos.x));
  pos.y = Math.max(ARENA_CY - lim, Math.min(ARENA_CY + lim, pos.y));
}

export function arenaRungKind(rung: number): UnitKind {
  const i = Math.max(0, Math.min(ARENA_LADDER.length - 1, Math.floor(rung)));
  return ARENA_LADDER[i];
}

export function demoteRung(rung: number) {
  return Math.max(0, rung - 1);
}

export function promoteRung(rung: number) {
  return Math.min(ARENA_LADDER.length - 1, rung + 1);
}

/** Empty keep courtyard: curtain walls + corner towers, no donjon. */
export function buildArenaCourtyardModel(team: Team = "you") {
  const g = new THREE.Group();
  const W = ARENA_COURTYARD_W;
  const wallH = 8;
  const t = 2.2;
  const baseY = 0.4;

  const floor = tiledBox(W - 2, 0.6, W - 2, materials.stone, 24);
  floor.position.set(0, 0.2, 0);
  floor.receiveShadow = true;
  g.add(floor);

  for (const [w, d, x, z] of [
    [W, t, 0, W / 2],
    [W, t, 0, -W / 2],
    [t, W, W / 2, 0],
    [t, W, -W / 2, 0],
  ] as const) {
    const wall = tiledBox(w, wallH, d, materials.stone);
    wall.position.set(x, baseY + wallH / 2, z);
    g.add(wall);
  }
  g.add(crenellate(W, W, baseY + wallH));

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const tw = roundTower(4.2, 16);
      tw.position.set((sx * W) / 2, baseY + 8, (sz * W) / 2);
      const roof = flaredRoof(5, 9, team);
      roof.position.set((sx * W) / 2, baseY + 16, (sz * W) / 2);
      g.add(tw, roof);
    }
  }

  // Gate gaps on +Z and −Z so the yard reads open
  for (const z of [W / 2, -W / 2]) {
    const gate = tiledBox(14, 11, 4.5, materials.stone);
    gate.position.set(0, baseY + 5.5, z + Math.sign(z) * 0.4);
    g.add(gate);
  }

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

export function arenaCameraFrame() {
  return {
    yaw: 0.35,
    pitch: 1.05,
    dist: 320,
    lookX: 0,
    lookY: 8,
    lookZ: 0,
  };
}
