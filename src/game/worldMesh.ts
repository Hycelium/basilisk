import * as THREE from "three";
import { ROAD_Y_MAX, ROAD_Y_MIN, WORLD_H, WORLD_W } from "./balance";
import { cloneModel, type ModelKey } from "./assets3d";
import { riverSpec, rngFromSeed, roadCenterX } from "./map";
import type { Team } from "./types";

function teamColor(team: Team, lite = false) {
  if (team === "you") return lite ? 0x8ec8ff : 0x3a7ec8;
  return lite ? 0xf08090 : 0xa03040;
}

function hash2(x: number, z: number, seed: number) {
  let n = (x * 374761393 + z * 668265263 + seed * 1274126177) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function fbm(x: number, z: number, seed: number) {
  let a = 0;
  let f = 1;
  let amp = 1;
  let tot = 0;
  for (let i = 0; i < 5; i++) {
    a += amp * (hash2(Math.floor(x * f), Math.floor(z * f), seed + i * 97) * 2 - 1);
    tot += amp;
    f *= 2.05;
    amp *= 0.5;
  }
  return a / tot;
}

function makeRibbon(points: THREE.Vector3[], width: number, material: THREE.Material) {
  const verts: number[] = [];
  const indices: number[] = [];
  const half = width / 2;
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.max(0.001, Math.hypot(dx, dz));
    const px = -dz / len;
    const pz = dx / len;
    verts.push(
      points[i].x + px * half,
      points[i].y,
      points[i].z + pz * half,
      points[i].x - px * half,
      points[i].y,
      points[i].z - pz * half,
    );
    if (i < points.length - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** High-poly displaced battlefield with vertex colors + cobbled roads. */
export function buildTerrain(seed: number) {
  const g = new THREE.Group();
  const river = riverSpec(seed);
  const segsX = 96;
  const segsZ = 160;
  const geo = new THREE.PlaneGeometry(WORLD_W + 120, WORLD_H + 100, segsX, segsZ);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cSouth = new THREE.Color(0x4a8a58);
  const cNorth = new THREE.Color(0x7a4a55);
  const cMid = new THREE.Color(0x5a7a52);
  const cRoad = new THREE.Color(0x8a6e52);
  const cDirt = new THREE.Color(0x6a5a42);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const simX = x + WORLD_W / 2;
    const simY = z + WORLD_H / 2;

    let h = fbm(simX * 0.035, simY * 0.028, seed) * 7;
    h += fbm(simX * 0.09, simY * 0.08, seed + 3) * 2.2;

    // Flatten playable strip + roads
    const onRoad =
      simY > ROAD_Y_MIN - 8 &&
      simY < ROAD_Y_MAX + 8 &&
      (Math.abs(simX - roadCenterX(seed, 0, simY)) < 22 ||
        Math.abs(simX - roadCenterX(seed, 1, simY)) < 22);
    const riverY = river.y + Math.sin((simX / WORLD_W) * Math.PI * 2 + river.phase) * river.amplitude;
    const onRiver = river.enabled && Math.abs(simY - riverY) < river.width * 0.62;
    const inField = simX > 20 && simX < WORLD_W - 20 && simY > 60 && simY < WORLD_H - 40;
    if (onRiver) h = -2.2;
    else if (onRoad) h *= 0.05;
    else if (inField) h *= 0.35;
    else h += Math.max(0, Math.abs(simX - WORLD_W / 2) / WORLD_W - 0.35) * 18;

    // Edge cliffs
    const edge = Math.max(0, 28 - simX, simX - (WORLD_W - 28), 40 - simY, simY - (WORLD_H - 30));
    if (edge > 0) h += edge * 0.55;

    pos.setY(i, Math.max(-2, h));

    const t = THREE.MathUtils.clamp(simY / WORLD_H, 0, 1);
    const col = cSouth.clone().lerp(cMid, t * 1.2).lerp(cNorth, Math.max(0, t - 0.45) * 1.8);
    if (onRiver) col.setHex(0x315f72);
    else if (onRoad) col.copy(cRoad);
    else if (Math.abs(h) < 1.2 && inField) col.lerp(cDirt, 0.25);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const ground = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: false,
    }),
  );
  ground.receiveShadow = true;
  ground.castShadow = false;
  g.add(ground);

  // River ribbon first; roads cross it on timber/stone bridges.
  if (river.enabled) {
    const waterPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const simX = -30 + (i / 64) * (WORLD_W + 60);
      const simY = river.y + Math.sin((simX / WORLD_W) * Math.PI * 2 + river.phase) * river.amplitude;
      waterPts.push(new THREE.Vector3(simX - WORLD_W / 2, -0.5, simY - WORLD_H / 2));
    }
    const water = makeRibbon(
      waterPts,
      river.width,
      new THREE.MeshPhysicalMaterial({
        color: 0x3f91b0,
        roughness: 0.22,
        metalness: 0.05,
        transparent: true,
        opacity: 0.88,
        clearcoat: 0.7,
        clearcoatRoughness: 0.18,
      }),
    );
    g.add(water);
  }

  // Raised curved cobble roads
  for (let i = 0; i < 2; i++) {
    const roadPts: THREE.Vector3[] = [];
    for (let s = 0; s <= 64; s++) {
      const simY = ROAD_Y_MIN - 10 + (s / 64) * (ROAD_Y_MAX - ROAD_Y_MIN + 20);
      roadPts.push(
        new THREE.Vector3(roadCenterX(seed, i as 0 | 1, simY) - WORLD_W / 2, 0.32, simY - WORLD_H / 2),
      );
    }
    const road = makeRibbon(
      roadPts,
      29,
      new THREE.MeshStandardMaterial({ color: i === 0 ? 0x6a5340 : 0x7a5c44, roughness: 0.95, metalness: 0.05 }),
    );
    g.add(road);

    // Path edge stones
    for (let s = 0; s < 18; s++) {
      const zy = ROAD_Y_MIN + (s / 17) * (ROAD_Y_MAX - ROAD_Y_MIN);
      const cx = roadCenterX(seed, i as 0 | 1, zy);
      for (const side of [-1, 1]) {
        const pebble = new THREE.Mesh(
          new THREE.DodecahedronGeometry(1.4 + (s % 3) * 0.3, 1),
          new THREE.MeshStandardMaterial({ color: 0x5a5550, roughness: 0.88 }),
        );
        pebble.position.set(cx - WORLD_W / 2 + side * 15, 0.7, zy - WORLD_H / 2);
        pebble.rotation.set(s * 0.4, s * 0.7, 0);
        pebble.castShadow = true;
        g.add(pebble);
      }
    }

    if (river.enabled) {
      // Solve crossing approximately; river meanders horizontally while road meanders vertically.
      let crossY = river.y;
      for (let pass = 0; pass < 3; pass++) {
        const crossX = roadCenterX(seed, i as 0 | 1, crossY);
        crossY = river.y + Math.sin((crossX / WORLD_W) * Math.PI * 2 + river.phase) * river.amplitude;
      }
      const crossX = roadCenterX(seed, i as 0 | 1, crossY);
      const x0 = roadCenterX(seed, i as 0 | 1, crossY - 8);
      const x1 = roadCenterX(seed, i as 0 | 1, crossY + 8);
      const bridge = new THREE.Mesh(
        new THREE.BoxGeometry(34, 1.8, river.width + 12, 6, 1, 5),
        new THREE.MeshStandardMaterial({ color: 0x80613b, roughness: 0.82, metalness: 0.04 }),
      );
      bridge.position.set(crossX - WORLD_W / 2, 1.1, crossY - WORLD_H / 2);
      bridge.rotation.y = Math.atan2(x1 - x0, 16);
      bridge.castShadow = true;
      bridge.receiveShadow = true;
      g.add(bridge);
    }
  }

  return g;
}

/** Seeded forests, cliffs, rocks — uses oak GLB when loaded. */
export function buildScenery(seed: number) {
  const g = new THREE.Group();
  const rng = rngFromSeed(seed ^ 0xA5A5);

  // Distant mountain ridges (high-ish poly)
  for (let i = 0; i < 11; i++) {
    const ridge = new THREE.Mesh(
      new THREE.ConeGeometry(32 + (i % 4) * 14, 55 + (i % 5) * 18, 7 + (i % 3)),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.58, 0.18, 0.12 + (i % 4) * 0.03),
        roughness: 1,
        flatShading: true,
      }),
    );
    ridge.position.set(-220 + i * 48 + rng() * 10, 22, -WORLD_H / 2 - 55 - rng() * 30);
    ridge.rotation.y = rng() * Math.PI;
    g.add(ridge);
  }

  // Side cliffs
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 8; i++) {
      const cliff = new THREE.Mesh(
        new THREE.BoxGeometry(18 + rng() * 14, 28 + rng() * 40, 40 + rng() * 50, 2, 4, 3),
        new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.95, flatShading: true }),
      );
      cliff.position.set(side * (WORLD_W / 2 + 28 + rng() * 20), 10 + rng() * 12, -WORLD_H / 2 + 40 + i * 85);
      cliff.rotation.y = side * 0.2;
      cliff.castShadow = true;
      cliff.receiveShadow = true;
      g.add(cliff);
    }
  }

  // Forest belt
  const treeCount = 52;
  for (let i = 0; i < treeCount; i++) {
    let x = rng() * WORLD_W;
    let y = rng() * WORLD_H;
    // Prefer edges / avoid roads & keep centers
    if (i < 30) {
      const edge = Math.floor(rng() * 4);
      if (edge === 0) {
        x = 8 + rng() * 36;
        y = 80 + rng() * (WORLD_H - 160);
      } else if (edge === 1) {
        x = WORLD_W - 44 + rng() * 36;
        y = 80 + rng() * (WORLD_H - 160);
      } else if (edge === 2) {
        x = 40 + rng() * (WORLD_W - 80);
        y = 30 + rng() * 50;
      } else {
        x = 40 + rng() * (WORLD_W - 80);
        y = WORLD_H - 70 + rng() * 50;
      }
    }
    if (
      Math.abs(x - roadCenterX(seed, 0, y)) < 30 ||
      Math.abs(x - roadCenterX(seed, 1, y)) < 30
    ) continue;
    if (Math.abs(x - 200) < 40 && (y < 140 || y > 500)) continue;

    // Scenery is dark pines/cones only — never the bright oak used for wood nodes.
    const scenic: ModelKey[] = ["kPine", "kPine2", "kCone", "kBush"];
    const pickKey = scenic[Math.floor(rng() * scenic.length)];
    const scenicMesh = cloneModel(pickKey, pickKey === "kBush" ? 6 + rng() * 4 : 14 + rng() * 12);
    if (scenicMesh) {
      scenicMesh.position.set(x - WORLD_W / 2, 0, y - WORLD_H / 2);
      scenicMesh.rotation.y = rng() * Math.PI * 2;
      g.add(scenicMesh);
    } else {
      const tree = makeAoETree(0.55 + rng() * 0.25);
      tree.position.set(x - WORLD_W / 2, 0, y - WORLD_H / 2);
      tree.rotation.y = rng() * Math.PI * 2;
      tree.traverse((o) => {
        const m = o as THREE.Mesh;
        const mat = m.material;
        if (m.isMesh && mat instanceof THREE.MeshStandardMaterial) {
          const c = mat.clone();
          c.color.multiplyScalar(0.45);
          m.material = c;
        }
      });
      g.add(tree);
    }
  }

  // Boulder fields
  for (let i = 0; i < 28; i++) {
    const x = 30 + rng() * (WORLD_W - 60);
    const y = 70 + rng() * (WORLD_H - 140);
    if (
      Math.abs(x - roadCenterX(seed, 0, y)) < 26 ||
      Math.abs(x - roadCenterX(seed, 1, y)) < 26
    ) continue;
    const rock = new THREE.Mesh(
      new THREE.IcosahedronGeometry(3 + rng() * 6, 2),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.08, 0.08, 0.28 + rng() * 0.15),
        roughness: 0.92,
        flatShading: true,
      }),
    );
    rock.position.set(x - WORLD_W / 2, 2 + rng() * 2, y - WORLD_H / 2);
    rock.rotation.set(rng() * 2, rng() * 2, rng() * 2);
    rock.castShadow = true;
    rock.receiveShadow = true;
    g.add(rock);
  }

  // Grass tuft instances
  const tuftGeo = new THREE.ConeGeometry(0.7, 3.2, 5);
  const tuftMat = new THREE.MeshStandardMaterial({ color: 0x3a7a48, roughness: 0.8 });
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 220);
  const dummy = new THREE.Object3D();
  let ti = 0;
  for (let i = 0; i < 220; i++) {
    const x = 24 + rng() * (WORLD_W - 48);
    const y = 90 + rng() * (WORLD_H - 180);
    if (
      Math.abs(x - roadCenterX(seed, 0, y)) < 20 ||
      Math.abs(x - roadCenterX(seed, 1, y)) < 20
    ) continue;
    dummy.position.set(x - WORLD_W / 2, 1.4, y - WORLD_H / 2);
    dummy.rotation.y = rng() * Math.PI;
    dummy.scale.setScalar(0.7 + rng() * 1.1);
    dummy.updateMatrix();
    tufts.setMatrixAt(ti++, dummy.matrix);
  }
  tufts.count = ti;
  tufts.instanceMatrix.needsUpdate = true;
  g.add(tufts);

  return g;
}

/** Multi-mesh high-detail keep / castle. */
export function makeKeepMesh(team: Team) {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0x6e6a78, roughness: 0.82, metalness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a3844, roughness: 0.9 });
  const banner = new THREE.MeshStandardMaterial({ color: teamColor(team, true), side: THREE.DoubleSide });

  const body = new THREE.Mesh(new THREE.BoxGeometry(48, 34, 36, 3, 3, 2), stone);
  body.position.y = 17;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Battlements
  for (let i = -2; i <= 2; i++) {
    for (const z of [-18, 18]) {
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(7, 8, 5), dark);
      merlon.position.set(i * 10, 38, z);
      merlon.castShadow = true;
      g.add(merlon);
    }
  }

  // Corner towers
  for (const [sx, sz] of [
    [-26, -18],
    [26, -18],
    [-26, 18],
    [26, 18],
  ] as const) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(7, 8.5, 48, 12), stone);
    tower.position.set(sx, 24, sz);
    tower.castShadow = true;
    g.add(tower);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(10, 14, 8),
      new THREE.MeshStandardMaterial({ color: teamColor(team), roughness: 0.65 }),
    );
    roof.position.set(sx, 52, sz);
    roof.castShadow = true;
    g.add(roof);
  }

  // Gate arch
  const gate = new THREE.Mesh(new THREE.BoxGeometry(16, 18, 4), dark);
  gate.position.set(0, 9, 19);
  g.add(gate);
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(8, 2.2, 8, 16, Math.PI),
    stone,
  );
  arch.position.set(0, 18, 19);
  arch.rotation.x = Math.PI / 2;
  g.add(arch);

  // Banners
  for (const sx of [-14, 14]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 28, 6), dark);
    pole.position.set(sx, 40, 10);
    g.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(8, 12), banner);
    cloth.position.set(sx + 4, 42, 10);
    g.add(cloth);
  }

  // Courtyard platform
  const yard = new THREE.Mesh(
    new THREE.CylinderGeometry(22, 24, 3, 16),
    new THREE.MeshStandardMaterial({ color: 0x4a4538, roughness: 0.95 }),
  );
  yard.position.y = 1.2;
  yard.receiveShadow = true;
  g.add(yard);

  return g;
}

export function makeWatchtower(team: Team) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.82 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.8, 36, 10), wood);
  post.position.y = 18;
  post.castShadow = true;
  g.add(post);
  // Cross braces
  for (let i = 0; i < 3; i++) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(14, 1.2, 1.2), wood);
    brace.position.set(0, 8 + i * 8, 0);
    brace.rotation.y = (i * Math.PI) / 3;
    g.add(brace);
  }
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 2.5, 10), wood);
  platform.position.y = 34;
  platform.castShadow = true;
  g.add(platform);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(13, 14, 8),
    new THREE.MeshStandardMaterial({ color: teamColor(team), roughness: 0.6 }),
  );
  roof.position.y = 44;
  roof.castShadow = true;
  g.add(roof);
  // Lookout
  const rail = new THREE.Mesh(
    new THREE.TorusGeometry(9, 0.6, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0x3a2818 }),
  );
  rail.position.y = 36;
  rail.rotation.x = Math.PI / 2;
  g.add(rail);
  return g;
}

export function makeBallista(team: Team) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.8 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(20, 7, 14, 2, 1, 2), wood);
  base.position.y = 3.5;
  base.castShadow = true;
  g.add(base);
  const cheeks = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 16), wood);
  cheeks.position.set(0, 10, 0);
  g.add(cheeks);
  const bow = new THREE.Mesh(
    new THREE.TorusGeometry(10, 1.4, 8, 20, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xc8a878, metalness: 0.2, roughness: 0.45 }),
  );
  bow.position.set(0, 12, 0);
  bow.rotation.y = Math.PI / 2;
  g.add(bow);
  const bolt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.3, 18, 6),
    new THREE.MeshStandardMaterial({ color: teamColor(team, true), metalness: 0.5 }),
  );
  bolt.rotation.z = Math.PI / 2;
  bolt.position.set(0, 12, 6);
  g.add(bolt);
  return g;
}

export function makeCatapult(team: Team) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.8 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(18, 9, 14, 2, 1, 2), wood);
  base.position.y = 4.5;
  base.castShadow = true;
  g.add(base);
  for (const sx of [-8, 8]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(5, 5, 2.5, 14),
      new THREE.MeshStandardMaterial({ color: 0x3a2818, roughness: 0.85 }),
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(sx, 5, 0);
    wheel.castShadow = true;
    g.add(wheel);
  }
  const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 22, 2.4), new THREE.MeshStandardMaterial({ color: 0xb89060 }));
  arm.position.set(0, 14, 0);
  arm.name = "arm";
  arm.castShadow = true;
  g.add(arm);
  const basket = new THREE.Mesh(
    new THREE.SphereGeometry(3.5, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: teamColor(team, true), side: THREE.DoubleSide }),
  );
  basket.position.set(0, 26, 0);
  basket.rotation.x = Math.PI;
  g.add(basket);
  return g;
}

export function makeBarracks(team: Team) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.82 });
  const hall = new THREE.Mesh(new THREE.BoxGeometry(32, 16, 22, 2, 2, 2), wood);
  hall.position.y = 8;
  hall.castShadow = true;
  hall.receiveShadow = true;
  g.add(hall);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(22, 14, 4),
    new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 }),
  );
  roof.position.y = 22;
  roof.castShadow = true;
  g.add(roof);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(10, 12, 1.5),
    new THREE.MeshStandardMaterial({ color: teamColor(team, true) }),
  );
  door.position.set(0, 6, 11.5);
  g.add(door);
  // Side awnings
  for (const sx of [-18, 18]) {
    const lean = new THREE.Mesh(new THREE.BoxGeometry(8, 10, 14), wood);
    lean.position.set(sx, 5, 0);
    lean.castShadow = true;
    g.add(lean);
  }
  return g;
}

/** AoE2-flavored deciduous tree — layered canopy + thick trunk. */
export function makeAoETree(scale = 1) {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.92 });
  const leafA = new THREE.MeshStandardMaterial({ color: 0x2d7a3a, roughness: 0.78 });
  const leafB = new THREE.MeshStandardMaterial({ color: 0x1f5e2e, roughness: 0.82 });
  const leafC = new THREE.MeshStandardMaterial({ color: 0x3a8f45, roughness: 0.75 });

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.8 * scale, 2.6 * scale, 14 * scale, 10), bark);
  trunk.position.y = 7 * scale;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);

  // Knobby roots
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const root = new THREE.Mesh(new THREE.CapsuleGeometry(0.7 * scale, 3 * scale, 4, 6), bark);
    root.position.set(Math.cos(a) * 2.2 * scale, 1.2 * scale, Math.sin(a) * 2.2 * scale);
    root.rotation.z = Math.PI / 2;
    root.rotation.y = a;
    g.add(root);
  }

  const canopies: [number, number, number, THREE.Material][] = [
    [0, 18, 9.5, leafA],
    [-3.5, 16, 7.5, leafB],
    [3.2, 17, 7.2, leafC],
    [0.5, 22, 6.5, leafA],
    [-2, 20, 5.8, leafC],
    [2.4, 20.5, 5.5, leafB],
  ];
  for (const [x, y, r, mat] of canopies) {
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 1), mat);
    bush.position.set(x * scale, y * scale, ((x * 0.3) % 2) * scale);
    bush.castShadow = true;
    bush.receiveShadow = true;
    g.add(bush);
  }
  g.scale.setScalar(1);
  return g;
}

/** Stone / gold mine with timber frame — AoE2 camp feel. */
export function makeMine() {
  const g = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a7078, roughness: 0.9, flatShading: true });
  const darkRock = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.95, flatShading: true });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xe8b84a, metalness: 0.85, roughness: 0.28 });
  const timber = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.85 });

  // Ore mound
  for (let i = 0; i < 7; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(3.5 + (i % 3) * 1.2, 1), i % 2 ? rockMat : darkRock);
    const a = (i / 7) * Math.PI * 2;
    rock.position.set(Math.cos(a) * 5.5, 3 + (i % 3), Math.sin(a) * 5.5);
    rock.rotation.set(i * 0.4, i * 0.7, 0);
    rock.castShadow = true;
    rock.receiveShadow = true;
    g.add(rock);
  }
  const center = new THREE.Mesh(new THREE.DodecahedronGeometry(7, 1), rockMat);
  center.position.y = 5;
  center.castShadow = true;
  g.add(center);

  // Gold seams
  for (let i = 0; i < 6; i++) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 5 + i * 0.4, 1.2), goldMat);
    seam.position.set((i - 2.5) * 1.8, 5.5, (i % 3) - 1);
    seam.rotation.z = (i - 2.5) * 0.12;
    g.add(seam);
  }

  // Timber pit frame
  for (const [x, z] of [
    [-8, -8],
    [8, -8],
    [-8, 8],
    [8, 8],
  ] as const) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.4, 10, 1.4), timber);
    post.position.set(x, 5, z);
    post.castShadow = true;
    g.add(post);
  }
  for (const z of [-8, 8]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(18, 1.2, 1.2), timber);
    beam.position.set(0, 10, z);
    g.add(beam);
  }
  for (const x of [-8, 8]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 18), timber);
    beam.position.set(x, 10, 0);
    g.add(beam);
  }

  // Mine cart tracks hint
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.4, 14),
    new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 0.9 }),
  );
  rail.position.set(0, 0.3, 10);
  g.add(rail);

  return g;
}

export function makeHouse(team: Team) {
  const g = new THREE.Group();
  const plaster = new THREE.MeshStandardMaterial({ color: 0xc8b89a, roughness: 0.88 });
  const timber = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.85 });
  const thatch = new THREE.MeshStandardMaterial({ color: 0x8a6a38, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: teamColor(team, true), roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(22, 14, 18, 2, 2, 2), plaster);
  body.position.y = 7;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // Timber framing
  for (const x of [-10, 0, 10]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 14, 1.2), timber);
    beam.position.set(x, 7, 9.2);
    g.add(beam);
  }
  const cross = new THREE.Mesh(new THREE.BoxGeometry(22, 1.2, 1.2), timber);
  cross.position.set(0, 12, 9.2);
  g.add(cross);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(16, 12, 4), thatch);
  roof.position.y = 20;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  g.add(roof);

  const door = new THREE.Mesh(new THREE.BoxGeometry(5, 8, 1), timber);
  door.position.set(0, 4, 9.5);
  g.add(door);
  const doorTrim = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 1.2), trim);
  doorTrim.position.set(0, 8.5, 9.6);
  g.add(doorTrim);

  // Chimney
  const chim = new THREE.Mesh(new THREE.BoxGeometry(4, 10, 4), new THREE.MeshStandardMaterial({ color: 0x6a6670 }));
  chim.position.set(7, 18, -4);
  chim.castShadow = true;
  g.add(chim);

  return g;
}

export function makeCopperNode() {
  return makeMine();
}
