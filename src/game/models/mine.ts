import * as THREE from "three";
import { materials, tiledBox } from "./materials";

/** Gold mine (~13 tall, ~22 wide): granite mound with ore veins, timbered adit, rails, ore cart, props. */

const gold = new THREE.MeshStandardMaterial({ color: 0xffc83a, emissive: 0x7a5200, emissiveIntensity: 0.45, metalness: 0.85, roughness: 0.3 });
const dark = new THREE.MeshBasicMaterial({ color: 0x0a0806 });

let proto: THREE.Group | null = null;

function nuggets(g: THREE.Group, n: number, cx: number, cy: number, cz: number, spread: number, size: number) {
  const geo = new THREE.DodecahedronGeometry(size, 0);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, gold);
    m.position.set(cx + Math.sin(i * 2.4) * spread, cy + Math.abs(Math.cos(i * 1.7)) * spread * 0.4, cz + Math.cos(i * 2.4) * spread * 0.6);
    m.rotation.set(i, i * 2, 0);
    g.add(m);
  }
}

function barrel(x: number, z: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3, 12), materials.wood(1, 1));
  body.scale.set(1, 1, 1);
  body.position.y = 1.5;
  g.add(body);
  for (const y of [0.5, 2.5]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.1, 4, 16), materials.iron());
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
    g.add(hoop);
  }
  g.position.set(x, 0, z);
  return g;
}

function lantern(x: number, y: number, z: number) {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.7), materials.window());
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.5, 4), materials.iron());
  cap.position.y = 0.7;
  cap.rotation.y = Math.PI / 4;
  g.add(glass, cap);
  g.position.set(x, y, z);
  return g;
}

function build() {
  const g = new THREE.Group();

  // Rock mound: front face cut flat for the adit (front = +z)
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + Math.sin(x * 4.1 + z * 2.2) * 0.12 + Math.cos(y * 5.3 + x * 3) * 0.08;
    p.setXYZ(i, x * 10 * k, Math.max(y, -0.05) * 11 * k, Math.min(z * 8 * k, 4.5));
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  const rockMat = materials.granite(4, 4).clone();
  rockMat.flatShading = true;
  rockMat.color.setHex(0xe8e0d4);
  const mound = new THREE.Mesh(geo, rockMat);
  mound.position.z = -2;
  g.add(mound);
  for (const [x, y, z] of [[-5, 6, 1.5], [4, 8, 0.5], [6, 3, 2], [-2, 9.5, -1]] as const) nuggets(g, 4, x, y, z, 1.1, 0.7);

  // Adit: dark tunnel mouth framed by heavy timbers
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(5, 6.5), dark);
  mouth.position.set(0, 3.25, 2.55);
  g.add(mouth);
  for (const x of [-3, 3]) {
    const post = tiledBox(1, 7.5, 1, materials.wood, 4);
    post.position.set(x, 3.75, 2.9);
    g.add(post);
  }
  const lintel = tiledBox(8, 1.1, 1.2, materials.wood, 4);
  lintel.position.set(0, 7.9, 2.9);
  const sign = tiledBox(5, 1.6, 0.4, materials.wood, 3);
  sign.position.set(0, 9.3, 3.1);
  sign.rotation.z = 0.04;
  g.add(lintel, sign);
  const brace = tiledBox(0.6, 0.6, 3, materials.wood, 3);
  brace.position.set(0, 7.9, 1.5);
  g.add(brace);
  g.add(lantern(-3.9, 6.2, 3.3), lantern(3.9, 6.2, 3.3));

  // Rails + sleepers leading out of the adit
  for (let i = 0; i < 9; i++) {
    const sleeper = tiledBox(3.6, 0.3, 0.7, materials.wood, 3);
    sleeper.position.set(0, 0.15, 2 + i * 1.3);
    g.add(sleeper);
  }
  for (const x of [-1.1, 1.1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.25, 12), materials.iron());
    rail.position.set(x, 0.42, 7.2);
    g.add(rail);
  }

  // Ore cart heaped with gold
  const cart = new THREE.Group();
  const tub = tiledBox(3.4, 2, 4.4, materials.wood, 3);
  tub.position.y = 1.9;
  cart.add(tub);
  for (const y of [1.2, 2.6]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.2, 4.5), materials.iron());
    band.position.y = y;
    cart.add(band);
  }
  for (const x of [-1.1, 1.1])
    for (const z of [-1.4, 1.4]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.3, 10), materials.iron());
      w.rotation.z = Math.PI / 2;
      w.position.set(x, 0.65, z);
      cart.add(w);
    }
  const heap = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  heap.scale.set(1, 0.55, 1.3);
  heap.position.y = 2.9;
  cart.add(heap);
  nuggets(cart, 5, 0, 3.4, 0, 0.9, 0.35);
  cart.position.set(0, 0.2, 9.5);
  cart.rotation.y = 0.08;
  g.add(cart);

  // Props: barrels, gold sacks, pickaxe
  g.add(barrel(-6.5, 4), barrel(-8.2, 5.8), barrel(6.8, 4.5));
  const sack = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x8a6a44, roughness: 1 }));
  sack.scale.set(1, 0.9, 1);
  sack.position.set(5.5, 1, 7.5);
  g.add(sack);
  nuggets(g, 4, 5.5, 1.9, 7.5, 0.5, 0.3);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 6), materials.wood(1, 1));
  handle.position.set(-4.8, 1.6, 8);
  handle.rotation.z = 0.9;
  const head = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 4, 10, Math.PI), materials.iron());
  head.position.set(-3.3, 2.7, 8);
  head.rotation.z = 0.9 - Math.PI / 2;
  g.add(handle, head);

  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
}

export function buildGoldMine() {
  proto ??= build();
  return proto.clone();
}
