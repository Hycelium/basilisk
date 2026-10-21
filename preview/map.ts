import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const TEX = "/models/textures/";
const SIZE = 420;
const SEG = 220;

const GROUNDS = ["procedural", "withered_grass", "dry_ground_01", "leafy_grass"];
const ROADS = ["stony_dirt_path", "dirt", "gravel_road"];
const CLIFFS = ["cliff_side", "rock_face"];
const PRESETS: Record<string, { ground: string; tint: boolean; road: string; cliff: string; wheat: boolean }> = {
  "A · Painted fields (no textures)": { ground: "procedural", tint: true, road: "dirt", cliff: "cliff_side", wheat: true },
  "B · Withered grass + stony path": { ground: "withered_grass", tint: true, road: "stony_dirt_path", cliff: "cliff_side", wheat: true },
  "C · Leafy meadow + gravel road": { ground: "leafy_grass", tint: false, road: "gravel_road", cliff: "rock_face", wheat: false },
};

const roadX = (z: number) => Math.sin(z * 0.012) * 60 + Math.sin(z * 0.031) * 15;
function height(x: number, z: number) {
  let h = Math.sin(x * 0.021) * Math.cos(z * 0.017) * 6 + Math.sin(x * 0.05 + 1.3) * Math.sin(z * 0.043) * 2.5;
  h += Math.sin((x + z) * 0.11) * 0.5;
  const d = Math.abs(x - roadX(z));
  return h * (0.3 + 0.7 * THREE.MathUtils.smoothstep(d, 5, 18));
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb7d2ea);
scene.fog = new THREE.Fog(0xcfdce6, 380, 900);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 2000);
camera.position.set(-40, 150, 210);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(10, 0, 0);
controls.update();

scene.add(new THREE.HemisphereLight(0xdfeeff, 0x8a7240, 1.1));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
sun.position.set(-120, 180, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -220, right: 220, top: 220, bottom: -220, far: 600 });
scene.add(sun);

// Image-backed textures upload black in some embedded Chromium builds; a canvas copy is reliable.
const loader = new THREE.ImageLoader();
const texCache = new Map<string, THREE.Texture>();
function tex(name: string, repeat: number) {
  const key = name + repeat;
  if (!texCache.has(key)) {
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const t = new THREE.CanvasTexture(c);
    loader.load(TEX + name + ".jpg", (img) => {
      c.getContext("2d")!.drawImage(img, 0, 0, 1024, 1024);
      t.needsUpdate = true;
    });
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    texCache.set(key, t);
  }
  return texCache.get(key)!;
}

// Ground
const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
const gp = groundGeo.attributes.position as THREE.BufferAttribute;
const gold = new THREE.Color(0xd2a94c), olive = new THREE.Color(0x9a9645), straw = new THREE.Color(0xe2c47a);
const vcols = new Float32Array(gp.count * 3);
for (let i = 0; i < gp.count; i++) {
  const x = gp.getX(i), z = gp.getZ(i);
  gp.setY(i, height(x, z));
  const n = Math.sin(x * 0.07) * Math.cos(z * 0.06) * 0.5 + 0.5;
  const c = gold.clone().lerp(olive, n * 0.6).lerp(straw, Math.max(0, Math.sin(x * 0.013 + z * 0.02)) * 0.4);
  c.toArray(vcols, i * 3);
}
groundGeo.setAttribute("color", new THREE.BufferAttribute(vcols, 3));
groundGeo.computeVertexNormals();
const groundMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.receiveShadow = true;
scene.add(ground);

// Road ribbon
const roadGeo = new THREE.BufferGeometry();
{
  const pts: number[] = [], uvs: number[] = [], idx: number[] = [];
  const W = 9, N = 140;
  for (let s = 0; s <= N; s++) {
    const z = -SIZE / 2 + (s / N) * SIZE;
    const dx = roadX(z + 1) - roadX(z - 1);
    const len = Math.hypot(dx, 2);
    const nx = 2 / len, nz = -dx / len;
    for (const side of [-1, 1]) {
      const x = roadX(z) + nx * W * side * 0.5, zz = z + nz * W * side * 0.5;
      pts.push(x, height(x, zz) + 0.25, zz);
      uvs.push(side < 0 ? 0 : 1, s * 0.5);
    }
    if (s < N) idx.push(s * 2, s * 2 + 1, s * 2 + 2, s * 2 + 1, s * 2 + 3, s * 2 + 2);
  }
  roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  roadGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  roadGeo.setIndex(idx);
  roadGeo.computeVertexNormals();
}
const roadMat = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
const road = new THREE.Mesh(roadGeo, roadMat);
road.receiveShadow = true;
scene.add(road);

// Rocky outcrop with a stand-in keep for scale
const rockGeo = mergeVertices(new THREE.IcosahedronGeometry(30, 12).deleteAttribute("normal"));
const rp = rockGeo.attributes.position as THREE.BufferAttribute;
for (let i = 0; i < rp.count; i++) {
  const v = new THREE.Vector3().fromBufferAttribute(rp, i);
  const k = 1 + Math.sin(v.x * 0.3) * Math.cos(v.z * 0.25) * 0.15 + Math.sin(v.y * 0.5 + v.x * 0.2) * 0.08;
  v.multiplyScalar(k);
  v.y = Math.max(v.y * 1.1, -8);
  rp.setXYZ(i, v.x, v.y, v.z);
}
rockGeo.computeVertexNormals();
const cliffMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
const rock = new THREE.Mesh(rockGeo, cliffMat);
rock.position.set(85, height(85, -55) - 4, -55);
rock.castShadow = rock.receiveShadow = true;
scene.add(rock);
const keepMat = new THREE.MeshStandardMaterial({ color: 0xb8ad98, roughness: 0.9 });
const keep = new THREE.Mesh(new THREE.BoxGeometry(14, 22, 14), keepMat);
keep.position.set(85, rock.position.y + 40, -55);
keep.castShadow = true;
scene.add(keep);
const roof = new THREE.Mesh(new THREE.ConeGeometry(11, 10, 4), new THREE.MeshStandardMaterial({ color: 0x5b4636 }));
roof.position.set(85, keep.position.y + 16, -55);
roof.rotation.y = Math.PI / 4;
scene.add(roof);

// Wheat patches: striped crop rows draped over terrain
function wheatTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#d9b553";
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 8) {
    g.fillStyle = "#b58f36";
    g.fillRect(0, y, 256, 3);
  }
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = Math.random() < 0.5 ? "#ecd27f" : "#a98432";
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const wheatTex = wheatTexture();
const wheat = new THREE.Group();
const rand = (a: number, b: number) => a + Math.random() * (b - a);
for (let i = 0; i < 14; i++) {
  const z = rand(-180, 180);
  const side = Math.random() < 0.5 ? -1 : 1;
  const x = roadX(z) + side * rand(35, 150);
  if (Math.hypot(x - 85, z + 55) < 45) continue;
  const w = rand(35, 70), d = rand(25, 50);
  const geo = new THREE.PlaneGeometry(w, d, 16, 16).rotateX(-Math.PI / 2).rotateY(rand(0, Math.PI));
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let j = 0; j < p.count; j++) p.setY(j, height(p.getX(j) + x, p.getZ(j) + z) + 0.15);
  geo.computeVertexNormals();
  const t = wheatTex.clone();
  t.repeat.set(w / 20, d / 20);
  t.needsUpdate = true;
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: t, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }));
  m.position.set(x, 0, z);
  m.receiveShadow = true;
  wheat.add(m);
}
scene.add(wheat);

// Trees: reuse the existing Kenney oak
new GLTFLoader().load("/models/kenney/nature-tree_oak.glb", (gltf) => {
  gltf.scene.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  for (let i = 0; i < 70; i++) {
    const x = rand(-200, 200), z = rand(-200, 200);
    if (Math.abs(x - roadX(z)) < 12 || Math.hypot(x - 85, z + 55) < 38) continue;
    const t = gltf.scene.clone();
    t.position.set(x, height(x, z), z);
    t.scale.setScalar(rand(11, 17));
    t.rotation.y = rand(0, 6.28);
    scene.add(t);
  }
});

// UI
const $ = (id: string) => document.getElementById(id) as HTMLSelectElement & HTMLInputElement;
const fill = (id: string, opts: string[]) => ($(id).innerHTML = opts.map((o) => `<option>${o}</option>`).join(""));
fill("preset", Object.keys(PRESETS));
fill("ground", GROUNDS);
fill("road", ROADS);
fill("cliff", CLIFFS);

function apply() {
  const g = $("ground").value;
  const tint = $("tint").checked;
  groundMat.vertexColors = g === "procedural" || tint;
  groundMat.map = g === "procedural" ? null : tex(g, 40);
  groundMat.color.setScalar(groundMat.map && tint ? 1.7 : 1);
  groundMat.needsUpdate = true;
  roadMat.map = tex($("road").value, 1);
  roadMat.map.repeat.set(1, 1);
  roadMat.needsUpdate = true;
  cliffMat.map = tex($("cliff").value, 3);
  cliffMat.needsUpdate = true;
  wheat.visible = $("wheat").checked;
}
function applyPreset() {
  const p = PRESETS[$("preset").value];
  $("ground").value = p.ground;
  $("tint").checked = p.tint;
  $("road").value = p.road;
  $("cliff").value = p.cliff;
  $("wheat").checked = p.wheat;
  apply();
}
$("preset").onchange = applyPreset;
for (const id of ["ground", "tint", "road", "cliff", "wheat"]) $(id).onchange = apply;
applyPreset();
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));
