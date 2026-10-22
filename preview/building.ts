import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { buildKeepModel } from "../src/game/models/keep";
import { buildGoldMine } from "../src/game/models/mine";
import { animateTrebuchet, animateUnit, buildPeonModel, buildUnitModel } from "../src/game/models/units";
import { buildRockPile, buildTree, type TreeKind } from "../src/game/models/nature";
import {
  buildBallistaModel,
  buildBarracksModel,
  buildCatapultModel,
  buildHouseModel,
  buildWatchtowerModel,
} from "../src/game/models/buildings";
import { cloneModel, ensureModelsLoaded } from "../src/game/assets3d";

type Build = (team: "you" | "foe") => THREE.Object3D;
const lineup: Build = (team) => {
  const g = new THREE.Group();
  [buildWatchtowerModel, buildBallistaModel, buildCatapultModel, buildBarracksModel, buildHouseModel].forEach((b, i) => {
    const m = b(team);
    m.position.x = (i - 2) * 30;
    g.add(m);
  });
  g.scale.setScalar(0.6);
  return g;
};
const nature: Build = (team) => {
  const g = new THREE.Group();
  const kinds: TreeKind[] = ["oak", "pine", "birch", "poplar", "maple"];
  kinds.forEach((k, i) => {
    const t = buildTree(k, team === "you" ? 0 : 1);
    t.position.x = (i - 2) * 24;
    g.add(t);
  });
  for (let i = 0; i < 3; i++) {
    const r = buildRockPile(i, 1.6);
    r.position.set((i - 1) * 24, 0, 14);
    g.add(r);
  }
  return g;
};
const animated: THREE.Object3D[] = [];
const UNIT_KINDS = ["peon", "levy", "raider", "soldier", "brute", "archer", "ward", "runner", "rammer", "trebuchet", "spy"] as const;
const unitModel = (k: (typeof UNIT_KINDS)[number], team: "you" | "foe") => {
  const m = k === "peon" ? buildPeonModel(team) : buildUnitModel(k, team);
  animated.push(m);
  return m;
};
const units: Build = (team) => {
  const g = new THREE.Group();
  UNIT_KINDS.forEach((k, i) => {
    const m = unitModel(k, team);
    m.position.x = (i - 4.5) * 16 + (k === "rammer" || k === "trebuchet" ? 4 : 0);
    g.add(m);
  });
  g.scale.setScalar(1.5);
  return g;
};
const MODELS: Record<string, { build: Build; current?: () => THREE.Object3D | null }> = {
  Units: { build: units },
  ...Object.fromEntries(
    UNIT_KINDS.map((k) => [
      `Unit: ${k}`,
      {
        build: (team: "you" | "foe") => {
          const g = new THREE.Group();
          g.add(unitModel(k, team));
          g.scale.setScalar(k === "rammer" || k === "runner" || k === "trebuchet" ? 2.2 : 3.2);
          return g;
        },
      },
    ]),
  ),
  "Gold mine": { build: () => {
    const m = buildGoldMine();
    m.scale.setScalar(2.2);
    return m;
  } },
  Nature: { build: nature },
  "All buildings": { build: lineup },
  Keep: { build: buildKeepModel, current: () => cloneModel("kKeep", 42) },
  Watchtower: { build: buildWatchtowerModel, current: () => cloneModel("kTower", 34) },
  Ballista: { build: buildBallistaModel, current: () => cloneModel("kBallista", 16) },
  Catapult: { build: buildCatapultModel, current: () => cloneModel("kCatapult", 18) },
  Barracks: { build: buildBarracksModel },
  House: { build: buildHouseModel },
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7d2ea);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 1, 2000);
camera.position.set(70, 70, 110);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 18, 0);
controls.update();
Object.assign(window, { camera, controls });

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x8a7240, 1.2));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.6);
sun.position.set(-80, 120, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, far: 400 });
sun.shadow.bias = -0.0005;
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb08a3c, roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);

const stage = new THREE.Group();
scene.add(stage);
Object.assign(window, { stage });

const $ = (id: string) => document.getElementById(id) as HTMLSelectElement & HTMLInputElement;
$("model").innerHTML = Object.keys(MODELS).map((k) => `<option>${k}</option>`).join("");

function show() {
  stage.clear();
  animated.length = 0;
  const m = MODELS[$("model").value];
  const you = m.build("you");
  const foe = m.build("foe");
  const all = ["All buildings", "Nature", "Units"].includes($("model").value);
  if ($("model").value.startsWith("Unit:")) controls.target.set(0, 20, 0);
  you.position.set(all ? 0 : -28, 0, all ? 25 : 0);
  foe.position.set(all ? 0 : 28, 0, all ? -25 : 0);
  if (!all) foe.rotation.y = Math.PI / 5;
  stage.add(you, foe);
  if ($("compare").checked && m.current) {
    const cur = m.current();
    if (cur) {
      cur.position.set(0, 0, -60);
      stage.add(cur);
    }
  }
}
$("model").onchange = show;
$("compare").onchange = show;
show();
ensureModelsLoaded().then(show);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => {
  if ($("spin").checked) stage.rotation.y += 0.003;
  const t = performance.now() / 1000;
  const mode = $("anim").value;
  animated.forEach((m, i) => {
    const local = t + i * 0.37;
    const walking = mode === "walk" || (mode === "cycle" && local % 8 < 3);
    const fighting = mode === "attack" || (mode === "cycle" && !walking);
    const cd = 1.3;
    if (m.getObjectByName("arm") && m.getObjectByName("shot")) {
      animateTrebuchet(m, {
        phase: walking ? "packed" : "ready",
        attackTimer: fighting ? 3.2 - (local % 3.2) : 0,
        attackCooldown: 3.2,
      });
      return;
    }
    animateUnit(m, local, {
      x: walking ? local * 10 : 0,
      y: 0,
      timer: fighting ? cd - (local % cd) : -1,
      fighting,
    });
  });
  renderer.render(scene, camera);
});
