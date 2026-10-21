import * as THREE from "three";
import type { Team } from "../types";
import { banner, crenellate, flaredRoof, materials, tiledBox, windowAt } from "./materials";

/** Hand-built structures in the keep's style: stone below, timber-framed above, flared slate roofs. */

const facing = (team: Team) => (team === "you" ? Math.PI / 2 : -Math.PI / 2);

/** Flared hip roof sized to cover a w×d footprint (with eaves). */
function hipRoof(w: number, d: number, h: number, team: Team) {
  const r = (Math.max(w, d) / 2) * 1.3;
  const roof = flaredRoof(r, h, team, 4);
  roof.scale.set(w >= d ? 1 : w / d, 1, d >= w ? 1 : d / w);
  return roof;
}

function windowsAround(g: THREE.Group, cx: number, cz: number, hw: number, hd: number, y: number, spacing: number, w = 1, h = 1.8) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const half = dx ? hd : hw;
    const n = Math.max(1, Math.floor((half * 2) / spacing));
    for (let i = 0; i < n; i++) {
      const s = -half + ((i + 0.5) / n) * half * 2;
      g.add(windowAt(cx + dx * (hw + 0.1) + dz * s, y, cz + dz * (hd + 0.1) + dx * s, Math.atan2(dx, dz), w, h));
    }
  }
}

function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, material: THREE.Material) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 5), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

function finish(g: THREE.Group) {
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}

/** ~34 tall: battered stone shaft with an overhanging timber lookout and spire. */
export function buildWatchtowerModel(team: Team) {
  const g = new THREE.Group();
  const plinth = tiledBox(11, 3, 11, materials.stone);
  plinth.position.y = 1.5;
  const shaft = tiledBox(8, 18, 8, materials.stone);
  shaft.position.y = 12;
  g.add(plinth, shaft);
  for (let i = 0; i < 3; i++) g.add(windowAt(0, 8 + i * 5, 4.1, 0, 0.5, 1.8), windowAt(4.1, 9.5 + i * 5, 0, Math.PI / 2, 0.5, 1.8));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const corbel = tiledBox(1, 1, 3, materials.wood, 4);
      corbel.position.set(sx * 4.3, 20.6, sz * 3);
      corbel.rotation.y = Math.PI / 2;
      g.add(corbel);
    }
  const look = tiledBox(11, 6, 11, materials.timber, 12);
  look.position.y = 24;
  g.add(look);
  windowsAround(g, 0, 0, 5.5, 5.5, 24, 5, 1.6, 1.6);
  const roof = hipRoof(11, 11, 10, team);
  roof.position.y = 27;
  g.add(roof);
  const flag = banner(team, 3);
  flag.position.y = 36;
  g.add(flag);
  return finish(g);
}

/** ~16 tall: crenellated stone emplacement with a timber bolt-thrower aimed at the foe. */
export function buildBallistaModel(team: Team) {
  const g = new THREE.Group();
  const base = tiledBox(18, 5, 18, materials.stone);
  base.position.y = 2.5;
  g.add(base, crenellate(18, 18, 5, 1.3));
  const gun = new THREE.Group();
  gun.position.y = 5;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 4, 10), materials.wood(1, 1));
  post.position.y = 2;
  const stock = tiledBox(14, 1.6, 2.4, materials.wood, 4);
  stock.position.set(1, 4.6, 0);
  stock.rotation.z = 0.12;
  gun.add(post, stock);
  for (const s of [-1, 1]) {
    const arm = tiledBox(1, 1, 7, materials.wood, 4);
    arm.position.set(5.5, 5.5, s * 3.6);
    arm.rotation.y = s * 0.45;
    gun.add(arm);
    const tip = new THREE.Vector3(5.5 + Math.sin(s * 0.45) * 3.5 * s, 5.5, s * (3.6 + Math.cos(0.45) * 3.5));
    gun.add(rod(tip, new THREE.Vector3(-2.5, 5, 0), 0.08, materials.iron()));
  }
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 12, 6), materials.iron());
  bolt.rotation.z = Math.PI / 2 + 0.12;
  bolt.position.set(2, 5.6, 0);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.6, 6), materials.iron());
  tip.rotation.z = -Math.PI / 2 + 0.12;
  tip.position.set(8.6, 6.4, 0);
  gun.add(bolt, tip);
  gun.rotation.y = facing(team);
  g.add(gun);
  const flag = banner(team, 3);
  flag.position.set(-8, 6, -8);
  g.add(flag);
  return finish(g);
}

/** ~18 tall: wheeled timber mangonel; child "arm" swings on its z axle when firing. */
export function buildCatapultModel(team: Team) {
  const g = new THREE.Group();
  const rig = new THREE.Group();
  for (const s of [-1, 1]) {
    const rail = tiledBox(16, 1.6, 1.6, materials.wood, 4);
    rail.position.set(0, 3.2, s * 4.5);
    rig.add(rail);
    for (const x of [-5.5, 5.5]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 1, 14), materials.wood(1, 1));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 2.6, s * 5.6);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.3, 8), materials.iron());
      hub.rotation.x = Math.PI / 2;
      hub.position.copy(wheel.position);
      rig.add(wheel, hub);
    }
    for (const lean of [-0.38, 0.38]) {
      const upright = tiledBox(1.2, 10, 1.2, materials.wood, 4);
      upright.position.set(lean * 6, 8, s * 4.5);
      upright.rotation.z = -lean;
      rig.add(upright);
    }
  }
  for (const x of [-6, 6]) {
    const cross = tiledBox(1.4, 1.4, 10.4, materials.wood, 4);
    cross.position.set(x, 3.2, 0);
    rig.add(cross);
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 10.4, 8), materials.iron());
  axle.rotation.x = Math.PI / 2;
  axle.position.y = 12.5;
  rig.add(axle);

  const arm = new THREE.Group();
  arm.name = "arm";
  arm.position.y = 12.5;
  const beam = new THREE.Group();
  beam.rotation.z = 0.9;
  const pole = tiledBox(1.4, 16, 1.4, materials.wood, 4);
  pole.position.y = 3;
  const bucket = new THREE.Mesh(new THREE.SphereGeometry(2, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), materials.wood(1, 1));
  bucket.position.y = 11;
  bucket.rotation.x = Math.PI;
  const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4, 0), materials.granite(1, 1));
  stone.position.y = 11.8;
  const weight = tiledBox(3.6, 3.6, 3.6, materials.stone, 6);
  weight.position.y = -5;
  beam.add(pole, bucket, stone, weight);
  arm.add(beam);
  rig.add(arm);
  rig.rotation.y = facing(team);
  g.add(rig);

  for (let i = 0; i < 5; i++) {
    const ammo = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), materials.granite(1, 1));
    ammo.position.set(-9 + (i % 3) * 1.9, 1 + Math.floor(i / 3) * 1.5, 8);
    g.add(ammo);
  }
  const flag = banner(team, 3);
  flag.position.set(8, 0, -8);
  g.add(flag);
  return finish(g);
}

/** ~30 tall, 32×22: stone drill hall with timber upper storey, yard banners and weapon rack. */
export function buildBarracksModel(team: Team) {
  const g = new THREE.Group();
  const hall = tiledBox(30, 9, 20, materials.stone);
  hall.position.y = 4.5;
  const upper = tiledBox(32, 7, 22, materials.timber, 16);
  upper.position.y = 12.5;
  g.add(hall, upper);
  windowsAround(g, 0, 0, 15, 10, 5.5, 6, 0.6, 2.2);
  windowsAround(g, 0, 0, 16, 11, 12.5, 6, 1.4, 1.8);
  const roof = hipRoof(32, 22, 13, team);
  roof.position.y = 16;
  g.add(roof);
  const doorArch = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.6, 16, 1, false, 0, Math.PI), materials.wood(1, 1));
  doorArch.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  doorArch.position.set(0, 5, 10.3);
  const door = tiledBox(6, 5, 0.6, materials.wood, 4);
  door.position.set(0, 2.5, 10.3);
  g.add(doorArch, door);
  for (const x of [-9, 9]) {
    const chim = tiledBox(2, 8, 2, materials.stone, 4);
    chim.position.set(x, 20, -4);
    g.add(chim);
  }
  for (const x of [-13, 13]) {
    const b = banner(team, 4);
    b.position.set(x, 0, 13);
    g.add(b);
  }
  const rack = tiledBox(8, 0.6, 0.6, materials.wood, 4);
  rack.position.set(-8, 3, 13);
  g.add(rack);
  for (let i = 0; i < 4; i++) {
    const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 7, 4), materials.wood(1, 1));
    spear.position.set(-11 + i * 2, 3.5, 13.3);
    spear.rotation.z = 0.15;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1, 4), materials.iron());
    head.position.set(-11.5 + i * 2, 7.4, 13.3);
    g.add(spear, head);
  }
  return finish(g);
}

/** ~26 tall, 22×18: stone-footed cottage with jettied timber storey and steep flared roof. */
export function buildHouseModel(team: Team) {
  const g = new THREE.Group();
  const base = tiledBox(18, 6, 14, materials.stone);
  base.position.y = 3;
  const upper = tiledBox(20, 7, 16, materials.timber, 14);
  upper.position.y = 9.5;
  g.add(base, upper);
  windowsAround(g, 0, 0, 10, 8, 9.5, 6, 1.4, 1.8);
  g.add(windowAt(-5, 3.5, 7.1, 0, 1.4, 1.6), windowAt(5, 3.5, 7.1, 0, 1.4, 1.6));
  const roof = hipRoof(20, 16, 13, team);
  roof.position.y = 13;
  g.add(roof);
  const door = tiledBox(3.4, 4.6, 0.5, materials.wood, 4);
  door.position.set(0, 2.3, 7.2);
  const chim = tiledBox(2.4, 9, 2.4, materials.stone, 4);
  chim.position.set(5, 18, -3);
  g.add(door, chim);
  for (let i = 0; i < 2; i++) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.1, 2.2, 10), materials.wood(1, 1));
    barrel.position.set(-8 + i * 2.3, 1.1, 9);
    g.add(barrel);
  }
  return finish(g);
}
