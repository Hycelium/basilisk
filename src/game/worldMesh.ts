import * as THREE from "three";
import { WORLD_H, WORLD_W } from "./balance";
import { groundLookForSeed, groundTexture, wheatTexture } from "./groundLooks";
import { buildRockPile, buildTree, SCENERY_TREES } from "./models/nature";
import { BACK_FIELD, MAP_CX, mapBounds, mapLanes, riverSpec, rngFromSeed, roadCenterX, roadGap } from "./map";
import { wheatPatches } from "./wheat";
import { deerSpots, FORD_X, isBasiliskSeed, SPINE_Y } from "./basiliskMap";
import { buildBackdrop, buildCliffs, buildValleyLakes, canyonCenterX, fbm, valleyLakeT } from "./landscape";
import type { Team } from "./types";

function teamColor(team: Team, lite = false) {
  if (team === "you") return lite ? 0x8ec8ff : 0x3a7ec8;
  return lite ? 0xf08090 : 0xa03040;
}

function makeRibbon(points: THREE.Vector3[], width: number, material: THREE.Material) {
  const verts: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const half = width / 2;
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) along += points[i].distanceTo(points[i - 1]);
    uvs.push(0, along / width, 1, along / width);
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
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  return mesh;
}

function sampleGround(simX: number, simY: number, seed: number, river: ReturnType<typeof riverSpec>) {
  const { minX, maxX, width } = mapBounds(seed);
  let h = fbm(simX * 0.012, simY * 0.01, seed) * 9;
  h += fbm(simX * 0.05, simY * 0.05, seed + 3) * 2.4;
  h += fbm(simX * 0.2, simY * 0.2, seed + 5, 3) * 0.5;

  // Flatten playable strip + roads
  const onRoad = simY > 40 && simY < WORLD_H - 40 && roadGap(seed, simX, simY) < 22;
  const riverY = river.y + Math.sin((simX / WORLD_W) * Math.PI * 2 + river.phase) * river.amplitude;
  const onRiver = river.enabled && Math.abs(simY - riverY) < river.width * 0.62;
  const inField = simX > minX + 20 && simX < maxX - 20 && simY > -20 && simY < WORLD_H + 40;
  if (onRiver) h = -2.2;
  else if (onRoad) h *= 0.05;
  else if (inField) h *= 0.35;
  else h += Math.max(0, Math.abs(simX - MAP_CX) / width - 0.35) * 12.6;

  if (isBasiliskSeed(seed) && onRiver) {
    const alongSpine = Math.abs(simY - SPINE_Y);
    const nearFord = FORD_X.some((fx) => Math.abs(simX - fx) < 18 && alongSpine < 32);
    if (nearFord) h = Math.min(h, 0.42);
    else h = -2.2;
  }

  // Deep valley in the center behind each keep, past the house yard.
  const southDrop = Math.max(0, simY - (WORLD_H + 28));
  const northDrop = Math.max(0, -28 - simY);
  const along = Math.max(southDrop, northDrop);
  if (along > 0) {
    const mid = Math.max(0, 1 - Math.abs(simX - MAP_CX - canyonCenterX(simY - WORLD_H / 2)) / 34);
    h -= Math.min(28, along * mid * mid * 0.22);
  }

  // Side and far-end cliffs — the far rise starts past the house yard, 30% lower than before.
  const sideEdge = Math.min(Math.max(0, minX + 28 - simX, simX - (maxX - 28)), 30);
  const endCliff = Math.max(0, -BACK_FIELD + 50 - simY, simY - (WORLD_H + BACK_FIELD - 50));
  const edge = Math.max(sideEdge * 0.6, endCliff * 0.35);
  if (edge > 0) h += edge * 0.16 + fbm(simX * 0.06, simY * 0.06, seed + 11) * Math.min(edge, 20) * 0.1;

  // Basin under the lake, so the V in the mountains holds water instead of dirt.
  const lake = valleyLakeT(simX, simY);
  let underLake = false;
  if (lake < 1) {
    underLake = lake < 0.78;
    h = Math.min(h, -26 + lake * 32);
  }

  return { h: Math.max(-48, h), onRoad, onRiver, inField, riverY, underLake };
}

/** High-poly displaced battlefield; ground look (painted / textured, wheat patches) rotates per seed. */
export function buildTerrain(seed: number) {
  const g = new THREE.Group();
  const river = riverSpec(seed);
  const look = groundLookForSeed(seed);
  const { minX, width } = mapBounds(seed);
  const segsX = Math.round((200 * width) / WORLD_W);
  const sizeX = width + 120;
  const sizeZ = WORLD_H + BACK_FIELD * 2;
  const segsZ = Math.round((330 * sizeZ) / (WORLD_H + 100));
  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segsX, segsZ);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cSouth = new THREE.Color(0x9c7a30);
  const cMid = new THREE.Color(0x8a7832);
  const cNorth = new THREE.Color(0x7c5a2a);
  const cOlive = new THREE.Color(0x6e6c2c);
  const cStraw = new THREE.Color(0xb09048);
  const cRoad = new THREE.Color(0x8a6e52);
  const cValley = new THREE.Color(0x4f7a38);

  for (let i = 0; i < pos.count; i++) {
    const simX = pos.getX(i) + WORLD_W / 2;
    const simY = pos.getZ(i) + WORLD_H / 2;
    const s = sampleGround(simX, simY, seed, river);
    pos.setY(i, s.h);
    uv.setXY(i, uv.getX(i) * (sizeX / 14), uv.getY(i) * (sizeZ / 14));

    const t = THREE.MathUtils.clamp(simY / WORLD_H, 0, 1);
    const col = cSouth.clone().lerp(cMid, t * 1.2).lerp(cNorth, Math.max(0, t - 0.45) * 1.8);
    col.lerp(cOlive, (fbm(simX * 0.02, simY * 0.02, seed + 21) * 0.5 + 0.5) * 0.6);
    col.lerp(cStraw, Math.max(0, fbm(simX * 0.008, simY * 0.008, seed + 22)) * 0.5);
    col.multiplyScalar(0.92 + fbm(simX * 0.15, simY * 0.15, seed + 23, 3) * 0.12);
    if (s.underLake) col.setHex(0x1c4658);
    else if (s.onRiver) col.setHex(0x315f72);
    else if (s.onRoad) col.lerp(cRoad, 0.35);
    else if (isBasiliskSeed(seed) && Math.abs(simY - SPINE_Y) > 48) {
      col.lerp(cValley, 0.38);
    }
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const cRock = new THREE.Color(0x857868);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const slope = THREE.MathUtils.smoothstep(1 - nrm.getY(i), 0.06, 0.3);
    if (slope <= 0) continue;
    tmp.fromArray(colors, i * 3).lerp(cRock, slope * 0.85).toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const groundMat = new THREE.MeshStandardMaterial({
    vertexColors: !look.ground || look.tint,
    map: look.ground ? groundTexture(look.ground) : null,
    roughness: 0.92,
    metalness: 0.02,
  });
  if (look.ground) groundMat.color.setScalar(look.tint ? 1.15 : 0.7);
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  ground.castShadow = false;
  g.add(ground);

  if (look.wheat || isBasiliskSeed(seed)) g.add(buildWheatPatches(seed, river));
  if (isBasiliskSeed(seed)) g.add(buildBasiliskFords(seed, river));

  // River ribbon first; roads cross it on timber/stone bridges.
  if (river.enabled) {
    const waterPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const simX = minX - 30 + (i / 64) * (width + 60);
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
  for (const i of mapLanes(seed)) {
    const roadPts: THREE.Vector3[] = [];
    const roadMin = 48;
    const roadMax = WORLD_H - 48;
    for (let s = 0; s <= 96; s++) {
      const simY = roadMin + (s / 96) * (roadMax - roadMin);
      roadPts.push(
        new THREE.Vector3(roadCenterX(seed, i, simY) - WORLD_W / 2, 0.6, simY - WORLD_H / 2),
      );
    }
    const road = makeRibbon(
      roadPts,
      29,
      new THREE.MeshStandardMaterial({
        map: groundTexture(look.road),
        color: i % 2 === 0 ? 0xc4b49c : 0xb8a890,
        roughness: 0.95,
        metalness: 0.05,
      }),
    );
    g.add(road);

    // Path edge stones
    for (let s = 0; s < 18; s++) {
      const zy = 72 + (s / 17) * (WORLD_H - 144);
      const cx = roadCenterX(seed, i, zy);
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
        const crossX = roadCenterX(seed, i, crossY);
        crossY = river.y + Math.sin((crossX / WORLD_W) * Math.PI * 2 + river.phase) * river.amplitude;
      }
      const crossX = roadCenterX(seed, i, crossY);
      const x0 = roadCenterX(seed, i, crossY - 8);
      const x1 = roadCenterX(seed, i, crossY + 8);
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

/** Timber planks on the three river fords — the only walkable chokes. */
function buildBasiliskFords(seed: number, river: ReturnType<typeof riverSpec>) {
  const g = new THREE.Group();
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x6e5230, roughness: 0.88, metalness: 0.04 });
  for (const fx of FORD_X) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(22, 1.2, river.width + 10, 4, 1, 3), plankMat);
    const gy = sampleGround(fx, SPINE_Y, seed, river).h;
    plank.position.set(fx - WORLD_W / 2, Math.max(0.4, gy + 0.8), SPINE_Y - WORLD_H / 2);
    plank.castShadow = true;
    plank.receiveShadow = true;
    g.add(plank);
  }
  const pitMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 });
  for (const pit of [
    { x: 268, y: 600 },
    { x: 132, y: 118 },
  ]) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 4, 10), pitMat);
    mesh.position.set(pit.x - WORLD_W / 2, -0.4, pit.y - WORLD_H / 2);
    mesh.userData.scarPit = true;
    g.add(mesh);
  }
  const hide = new THREE.MeshStandardMaterial({ color: 0x6b4a28, roughness: 0.9 });
  const antler = new THREE.MeshStandardMaterial({ color: 0xd8c49a, roughness: 0.7 });
  for (const team of ["you", "foe"] as const) {
    for (const spot of deerSpots(team)) {
      const deer = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, 5.4), hide);
      body.position.y = 2.4;
      const neck = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 1.4), hide);
      neck.position.set(0, 3.8, -2.2);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.3, 2.2), hide);
      head.position.set(0, 5.1, -3.1);
      const hornL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.4, 0.35), antler);
      hornL.position.set(-0.6, 6.4, -3.2);
      const hornR = hornL.clone();
      hornR.position.x = 0.6;
      deer.add(body, neck, head, hornL, hornR);
      deer.position.set(spot.x - WORLD_W / 2, 0, spot.y - WORLD_H / 2);
      deer.rotation.y = team === "you" ? 0.4 : Math.PI - 0.4;
      g.add(deer);
    }
  }
  return g;
}

/** Striped crop fields draped on the terrain, kept clear of roads and the river. */
function buildWheatPatches(seed: number, river: ReturnType<typeof riverSpec>) {
  const g = new THREE.Group();
  const tex = wheatTexture();
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xc4b28c,
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  for (const patch of wheatPatches(seed)) {
    const { x: cx, y: cy, w, d, rot } = patch;
    const geo = new THREE.PlaneGeometry(w, d, 12, 12).rotateX(-Math.PI / 2).rotateY(rot);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const puv = geo.attributes.uv as THREE.BufferAttribute;
    for (let j = 0; j < p.count; j++) {
      p.setY(j, sampleGround(cx + p.getX(j), cy + p.getZ(j), seed, river).h + 0.7);
      puv.setXY(j, puv.getX(j) * (w / 20), puv.getY(j) * (d / 20));
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx - WORLD_W / 2, 0, cy - WORLD_H / 2);
    m.receiveShadow = true;
    m.userData.scarField = true;
    g.add(m);
  }
  return g;
}

/** Seeded forests, cliffs, rocks — uses oak GLB when loaded. */
export function buildScenery(seed: number) {
  const g = new THREE.Group();
  const rng = rngFromSeed(seed ^ 0xA5A5);

  g.add(buildBackdrop(seed), buildValleyLakes(), buildCliffs(seed));
  const { minX, maxX, width } = mapBounds(seed);
  const density = width / WORLD_W;

  // Forest belt
  const treeCount = Math.round(52 * density);
  const edgeTrees = Math.round(30 * density);
  for (let i = 0; i < treeCount; i++) {
    let x = minX + rng() * width;
    let y = rng() * WORLD_H;
    // Prefer edges / avoid roads & keep centers
    if (i < edgeTrees) {
      const edge = Math.floor(rng() * 4);
      if (edge === 0) {
        x = minX + 8 + rng() * 36;
        y = 80 + rng() * (WORLD_H - 160);
      } else if (edge === 1) {
        x = maxX - 44 + rng() * 36;
        y = 80 + rng() * (WORLD_H - 160);
      } else if (edge === 2) {
        x = minX + 40 + rng() * (width - 80);
        y = -BACK_FIELD + 40 + rng() * (BACK_FIELD - 20);
      } else {
        x = minX + 40 + rng() * (width - 80);
        y = WORLD_H + 20 + rng() * (BACK_FIELD - 40);
      }
    }
    if (roadGap(seed, x, y) < 30) continue;
    // Keep both yards and the lake clear.
    if (valleyLakeT(x, y) < 1.05) continue;
    if (Math.abs(x - MAP_CX) < 80 && (y < 140 || y > WORLD_H - 90)) continue;

    // Scenery never uses the oak, which marks wood nodes.
    const kind = SCENERY_TREES[Math.floor(rng() * SCENERY_TREES.length)];
    const tree = buildTree(kind, rng() * 3, 14 + rng() * 12);
    tree.position.set(x - WORLD_W / 2, 0, y - WORLD_H / 2);
    tree.rotation.y = rng() * Math.PI * 2;
    const lumberBelt = (x < 110 || x > 290) && Math.abs(y - SPINE_Y) > 90;
    if (lumberBelt) tree.userData.scarTree = true;
    g.add(tree);
  }

  // Rock piles
  for (let i = 0; i < Math.round(28 * density); i++) {
    const x = minX + 30 + rng() * (width - 60);
    const y = 70 + rng() * (WORLD_H - 140);
    if (roadGap(seed, x, y) < 26) continue;
    if (Math.abs(x - MAP_CX) < 70 && (y < 90 || y > WORLD_H - 90)) continue;
    const pile = buildRockPile(rng() * 3, 0.9 + rng() * 1.1);
    pile.position.set(x - WORLD_W / 2, 0, y - WORLD_H / 2);
    pile.rotation.y = rng() * Math.PI * 2;
    g.add(pile);
  }

  // Grass tuft instances
  const tuftGeo = new THREE.ConeGeometry(0.7, 3.2, 5);
  const tuftMat = new THREE.MeshStandardMaterial({ color: 0x3a7a48, roughness: 0.8 });
  const tuftCount = Math.round(220 * density);
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftCount);
  const dummy = new THREE.Object3D();
  let ti = 0;
  for (let i = 0; i < tuftCount; i++) {
    const x = minX + 24 + rng() * (width - 48);
    const y = 90 + rng() * (WORLD_H - 180);
    if (roadGap(seed, x, y) < 20) continue;
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
