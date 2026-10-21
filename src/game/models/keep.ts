import * as THREE from "three";
import type { Team } from "../types";
import { banner, crenellate, flaredRoof, materials, roundTower, tiledBox, windowAt } from "./materials";

/** Hand-built keep (~46 units tall, ~40 wide): granite crag, curtain wall with round corner
 * towers, stone donjon with a timber-framed upper storey, and a tall stair tower spire. */
export function buildKeepModel(team: Team) {
  const g = new THREE.Group();

  // Granite crag
  const rockGeo = new THREE.IcosahedronGeometry(1, 4);
  const rp = rockGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
    const k = 1 + Math.sin(x * 5.1 + z * 2.3) * 0.08 + Math.sin(y * 7.7 + x * 3.1) * 0.06;
    rp.setXYZ(i, x * 21 * k, Math.max(y, -0.2) * 7 * k, z * 21 * k);
  }
  rockGeo.computeVertexNormals();
  const rock = new THREE.Mesh(rockGeo, materials.granite(3, 2));
  rock.position.y = 0.5;
  rock.receiveShadow = rock.castShadow = true;
  g.add(rock);

  const baseY = 6;

  // Curtain wall + corner towers
  const W = 34, wallH = 7, t = 1.8;
  for (const [w, d, x, z] of [
    [W, t, 0, W / 2], [W, t, 0, -W / 2], [t, W, W / 2, 0], [t, W, -W / 2, 0],
  ] as const) {
    const wall = tiledBox(w, wallH, d, materials.stone);
    wall.position.set(x, baseY + wallH / 2, z);
    g.add(wall);
  }
  const parapet = crenellate(W, W, baseY + wallH);
  g.add(parapet);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const tw = roundTower(3.4, 13);
      tw.position.set((sx * W) / 2, baseY + 6.5, (sz * W) / 2);
      const roof = flaredRoof(4, 8, team);
      roof.position.set((sx * W) / 2, baseY + 13, (sz * W) / 2);
      g.add(tw, roof);
      g.add(windowAt((sx * W) / 2 + sx * 2.5, baseY + 9, (sz * W) / 2 + sz * 2.5, Math.atan2(sx, sz), 0.8, 1.4));
    }

  // Gatehouse (front = +z)
  const gate = tiledBox(9, 11, 5, materials.stone);
  gate.position.set(0, baseY + 5.5, W / 2 + 0.5);
  g.add(gate, crenellate(9, 5, baseY + 11, 1.1).translateZ(W / 2 + 0.5));
  const door = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.6, 16, 1, false, 0, Math.PI), materials.wood(1, 1));
  door.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  door.position.set(0, baseY + 3.2, W / 2 + 3.05);
  const doorLow = tiledBox(4.8, 3.2, 0.6, materials.wood, 4);
  doorLow.position.set(0, baseY + 1.6, W / 2 + 3.05);
  g.add(door, doorLow);
  for (let i = 0; i < 6; i++) {
    const step = tiledBox(6, 1, 1.4, materials.stone, 4);
    step.position.set(0, baseY - 0.5 - i, W / 2 + 3.6 + i * 1.4);
    g.add(step);
  }

  // Donjon: stone lower, timber-framed overhanging upper storey, flared hip roof
  const donW = 15, donH = 17;
  const don = tiledBox(donW, donH, donW, materials.stone);
  don.position.set(-1, baseY + donH / 2, -2);
  g.add(don);
  const upper = tiledBox(donW + 2, 7, donW + 2, materials.timber, 16);
  upper.position.set(-1, baseY + donH + 3.5, -2);
  g.add(upper);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const o = donW / 2 + 0.15;
    for (const s of [-4, 0, 4]) {
      const along = s;
      g.add(windowAt(-1 + dx * o + dz * along, baseY + 8, -2 + dz * o + dx * along, Math.atan2(dx, dz), 1, 2.2));
      g.add(windowAt(-1 + dx * (o + 1.05) + dz * along, baseY + donH + 3.5, -2 + dz * (o + 1.05) + dx * along, Math.atan2(dx, dz), 1.2, 1.8));
    }
  }
  const hip = flaredRoof(11.2, 12, team, 4);
  hip.position.set(-1, baseY + donH + 7, -2);
  g.add(hip);
  const chimney = tiledBox(1.8, 6, 1.8, materials.stone, 3);
  chimney.position.set(3, baseY + donH + 12, -5);
  g.add(chimney);

  // Stair tower + spire with banner
  const stairX = 7, stairZ = 5;
  const st = roundTower(3.2, 32);
  st.position.set(stairX, baseY + 16, stairZ);
  g.add(st);
  const spire = flaredRoof(4.2, 13, team);
  spire.position.set(stairX, baseY + 32, stairZ);
  g.add(spire);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.6;
    g.add(windowAt(stairX + Math.sin(a) * 3.25, baseY + 8 + i * 6, stairZ + Math.cos(a) * 3.25, a, 0.7, 1.4));
  }
  const flag = banner(team, 4);
  flag.position.set(stairX, baseY + 44.5, stairZ);
  g.add(flag);
  for (const [x, z] of [[-W / 2, W / 2], [W / 2, -W / 2]] as const) {
    const b = banner(team, 2.6);
    b.position.set(x, baseY + 20.5, z);
    g.add(b);
  }

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return g;
}
