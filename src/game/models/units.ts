import * as THREE from "three";
import type { Team, UnitKind } from "../types";
import { TEAM_CLOTH } from "./materials";
import { G, M, aim, bake, box, cyl, dag, folds, joint, lathe, put, rodZ, solveArm, sphere, torus, type ArmChain, type UTex } from "./unitKit";

/**
 * Detailed hand-built soldiers, peons, horse and ram. Every humanoid shares one jointed skeleton; weapons are
 * posed in chest space per attack phase and the arms follow them with two-bone IK.
 */

type V3 = [number, number, number];

const HIP_Y = 6.6, THIGH = 3.0, SHIN = 2.9, SPINE_Y = 0.7, SH_Y = 3.0, SH_X = 1.5, UA = 2.35, FA = 2.15, HAND = 0.42, NECK_Y = 3.3;
const SKIN = 0xe0ae8a;
const HAIR = { brown: 0x4a2e1a, dark: 0x22180f, auburn: 0x7a3a1c, grey: 0x8a8580, blond: 0xa8844a };

const mats = {
  skin: () => M(SKIN, "skin", { rep: [1, 1], rough: 0.7 }),
  hair: (c: number) => M(c, "fur", { rep: [2, 2], bump: 1.5, rough: 0.9 }),
  eye: () => M(0x1a120c, null, { rough: 0.25 }),
  lip: () => M(0x9a5a48, null, { rough: 0.6 }),
  wood: () => M(0xa87a48, "grain", { rep: [1, 4], bump: 0.8, rough: 0.7 }),
  darkWood: () => M(0x6a4a2c, "grain", { rep: [1, 4], bump: 0.8 }),
  iron: () => M(0x9aa0a8, "steel", { rep: [1, 1], metal: 0.4, rough: 0.42, bump: 0.25 }),
  steel: () => M(0xdfe4ea, "steel", { rep: [2, 2], metal: 0.45, rough: 0.28, bump: 0.15 }),
  brass: () => M(0xd8a648, "steel", { rep: [1, 1], metal: 0.4, rough: 0.35 }),
  leather: (c = 0x6a4428) => M(c, "leather", { rep: [2, 2], bump: 1.2, rough: 0.75 }),
  mail: (rep: [number, number] = [6, 4]) => M(0xd0d4da, "mail", { rep, metal: 0.35, rough: 0.45, bump: 2 }),
  cloth: (c: number, t: UTex = "wool", rep: [number, number] = [4, 3], side: THREE.Side = THREE.FrontSide) =>
    M(c, t, { rep, bump: 1.2, side }),
};

/* ------------------------------------------------------------------ body */

interface HumanSpec {
  prefix?: string;
  hair?: number;
  hairStyle?: "short" | "long" | "none";
  beard?: "none" | "moustache" | "short" | "full";
  bulk?: number;
  coat: { color: number; tex?: UTex; hem: number; flare?: number };
  chest?: THREE.Material;
  under?: { mat: THREE.Material; hem: number };
  sleeves: { mat: THREE.Material; rolled?: boolean; fore?: THREE.Material };
  legs: { mat: THREE.Material; wraps?: number; shin?: THREE.Material };
  boots: THREE.Material;
  feet?: THREE.Material;
  gloves?: THREE.Material;
  belt?: THREE.Material;
}

const JOINTS = ["hips", "spine", "head", "shR", "elR", "wrR", "shL", "elL", "wrL", "thR", "knR", "thL", "knL"] as const;
type JointName = (typeof JOINTS)[number];
type Rig = Record<JointName, THREE.Object3D>;

function skirtGeo(b: number, hem: number, flare: number, top: number) {
  return G(`skirt${b}|${hem}|${flare}|${top}`, () =>
    folds(
      lathe(
        [
          [(1.5 + 0.28 * hem) * flare * b, top - hem],
          [(1.48 + 0.14 * hem) * flare * b, top - hem * 0.55],
          [1.5 * b, top - 0.35],
          [1.45 * b, top + 0.15],
          [1.36 * b, top + 0.35],
        ],
        28,
      ),
      9,
      0.1,
      top - 0.3,
    ),
  );
}

function human(s: HumanSpec) {
  const P = s.prefix ?? "";
  const b = s.bulk ?? 1;
  const root = new THREE.Group();
  const hips = joint(root, P + "hips", [0, HIP_Y, 0]);
  const spine = joint(hips, P + "spine", [0, SPINE_Y, 0]);
  const skin = mats.skin();
  const coat = mats.cloth(s.coat.color, s.coat.tex ?? "wool", [5, 3], THREE.DoubleSide);
  const flare = s.coat.flare ?? 1;

  if (s.under) put(hips, skirtGeo(b * 0.98, s.under.hem, flare * 0.95, SPINE_Y), s.under.mat, [0, 0, 0], undefined, [1, 1, 0.8]);
  put(hips, skirtGeo(b, s.coat.hem, flare, SPINE_Y), coat, [0, 0, 0], undefined, [1, 1, 0.8]);
  put(
    spine,
    G(`torso${b}`, () =>
      lathe(
        [
          [1.4 * b, -0.3],
          [1.48 * b, 0.4],
          [1.64 * b, 1.4],
          [1.74 * b, 2.25],
          [1.62 * b, 2.8],
          [1.2 * b, 3.12],
          [0.55, 3.38],
        ],
        28,
      ),
    ),
    s.chest ?? coat,
    [0, 0, 0],
    undefined,
    [1, 1, 0.74],
  );
  const belt = s.belt ?? mats.leather(0x4a2e1a);
  put(hips, cyl(1, 1, 0.34, 28, true), belt, [0, SPINE_Y, 0], undefined, [1.5 * b, 1, 1.2 * b]);
  put(hips, box(0.5, 0.42, 0.12), mats.brass(), [0, SPINE_Y, 1.2 * b]);
  put(hips, box(0.3, 0.26, 0.14), belt, [0, SPINE_Y, 1.21 * b]);
  put(hips, sphere(12), mats.leather(0x7a5434), [1.25 * b, 0.05, 0.55], [0, 0, 0.2], [0.35, 0.45, 0.25]);

  const arm = (side: -1 | 1) => {
    const n = side < 0 ? "R" : "L";
    put(spine, sphere(14), s.sleeves.mat, [side * SH_X * b, SH_Y - 0.05, 0], undefined, [0.66, 0.6, 0.62]);
    const sh = joint(spine, P + "sh" + n, [side * SH_X * b, SH_Y, 0]);
    put(sh, G("uarm", () => lathe([[0.42, -UA], [0.48, -UA * 0.55], [0.53, -0.35], [0.46, 0.18]], 14)), s.sleeves.mat);
    const el = joint(sh, P + "el" + n, [0, -UA, 0]);
    put(el, sphere(12), s.sleeves.mat, [0, 0, 0], undefined, 0.43);
    put(el, G("farm", () => lathe([[0.31, -FA], [0.38, -FA * 0.45], [0.43, -0.1], [0.41, 0.12]], 14)), s.sleeves.fore ?? (s.sleeves.rolled ? skin : s.sleeves.mat));
    if (s.sleeves.rolled) put(el, torus(0.44, 0.13, 16), s.sleeves.mat, [0, -0.25, 0], [Math.PI / 2, 0, 0]);
    else if (!s.sleeves.fore) put(el, torus(0.33, 0.08, 16), s.sleeves.mat, [0, -FA + 0.2, 0], [Math.PI / 2, 0, 0]);
    const wr = joint(el, P + "wr" + n, [0, -FA, 0]);
    const hand = s.gloves ?? skin;
    put(wr, sphere(12), hand, [0, -HAND, 0], undefined, [0.26, 0.36, 0.3]);
    put(wr, sphere(10), hand, [0, -HAND - 0.05, 0.2], [0.4, 0, 0], [0.2, 0.26, 0.12]);
    put(wr, sphere(8), hand, [-side * 0.2, -0.3, 0.1], [0, 0, side * 0.5], [0.11, 0.22, 0.11]);
    if (s.gloves) put(wr, cyl(0.42, 0.34, 0.5, 12), hand, [0, 0.0, 0]);
  };
  arm(-1);
  arm(1);

  const leg = (side: -1 | 1) => {
    const n = side < 0 ? "R" : "L";
    const th = joint(hips, P + "th" + n, [side * 0.78 * b, -0.05, 0]);
    put(th, G("thigh", () => lathe([[0.5, -THIGH], [0.62, -THIGH * 0.55], [0.73, -0.4], [0.66, 0.3]], 14)), s.legs.mat);
    const kn = joint(th, P + "kn" + n, [0, -THIGH, 0]);
    put(kn, sphere(12), s.legs.mat, [0, 0, 0.05], undefined, 0.52);
    put(kn, G("shin", () => lathe([[0.36, -SHIN], [0.46, -SHIN * 0.62], [0.52, -0.35], [0.47, 0.12]], 14)), s.legs.shin ?? s.legs.mat);
    put(
      kn,
      G("boot", () => lathe([[0.45, -SHIN - 0.08], [0.5, -SHIN * 0.8], [0.54, -SHIN * 0.55], [0.6, -SHIN * 0.48]], 14)),
      s.boots,
    );
    put(kn, torus(0.58, 0.09, 14), s.boots, [0, -SHIN * 0.48, 0], [Math.PI / 2, 0, 0]);
    put(kn, sphere(12), s.feet ?? s.boots, [0, -SHIN - 0.38, 0.42], undefined, [0.45, 0.36, 0.95]);
    put(kn, box(0.72, 0.1, 1.55), mats.leather(0x2a1c12), [0, -SHIN - 0.66, 0.42]);
    if (s.legs.wraps !== undefined) {
      for (let i = 0; i < 9; i++) {
        const y = -SHIN * 0.5 + 0.5 - i * 0.22;
        if (y < -SHIN * 0.48) break;
        put(kn, torus(0.5 - i * 0.012, 0.075, 14), i % 2 ? s.legs.mat : M(s.legs.wraps, "linen"), [0, y, 0], [Math.PI / 2 + 0.12, 0, 0]);
      }
    }
  };
  leg(-1);
  leg(1);

  const head = joint(spine, P + "head", [0, NECK_Y, 0.05]);
  put(head, cyl(0.4, 0.5, 1.0, 14), skin, [0, 0.25, 0]);
  put(head, sphere(22), skin, [0, 1.05, 0], undefined, [0.76, 0.9, 0.84]);
  put(head, sphere(18), skin, [0, 0.66, 0.22], undefined, [0.6, 0.45, 0.6]);
  put(head, G("nose", () => new THREE.ConeGeometry(0.14, 0.46, 10).rotateX(Math.PI / 2 + 0.45)), skin, [0, 0.96, 0.84]);
  put(head, sphere(10), skin, [0, 0.86, 0.95], undefined, [0.12, 0.1, 0.1]);
  put(head, sphere(12), skin, [0, 1.25, 0.6], undefined, [0.6, 0.16, 0.25]);
  for (const x of [-1, 1]) {
    put(head, sphere(10), skin, [x * 0.76, 0.98, -0.02], undefined, [0.1, 0.22, 0.15]);
    put(head, sphere(8), mats.eye(), [x * 0.27, 1.11, 0.71], undefined, 0.085);
    put(head, box(0.34, 0.07, 0.1), mats.hair(s.hair ?? HAIR.brown), [x * 0.27, 1.26, 0.77], [0, 0, x * -0.15]);
  }
  put(head, box(0.32, 0.05, 0.06), mats.lip(), [0, 0.68, 0.81]);

  const hairM = mats.hair(s.hair ?? HAIR.brown);
  if (s.hairStyle !== "none") {
    put(head, G("hairCap", () => new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)), hairM, [0, 1.06, -0.04], [-0.25, 0, 0], [0.82, 0.95, 0.9]);
    put(head, sphere(14), hairM, [0, 0.95, -0.28], undefined, [0.78, 0.65, 0.62]);
    if (s.hairStyle === "long") put(head, G("hairLong", () => folds(lathe([[0.7, -0.6], [0.8, 0.3], [0.75, 1.0]], 18, Math.PI - 1.2, 2.4), 8, 0.1, 0.8)), hairM, [0, 0.6, -0.1]);
  }
  const beard = s.beard ?? "none";
  if (beard === "full") put(head, sphere(16), hairM, [0, 0.5, 0.36], undefined, [0.6, 0.46, 0.5]);
  if (beard === "short") put(head, sphere(16), hairM, [0, 0.55, 0.38], undefined, [0.56, 0.3, 0.44]);
  if (beard !== "none") put(head, torus(0.2, 0.075, 12, Math.PI), hairM, [0, 0.72, 0.84], [0.2, 0, 0], [1.2, 0.7, 1]);

  return { root, hips, spine, head, P };
}

/* ------------------------------------------------------------------ headgear & clothing */

function hood(parent: THREE.Object3D, spine: THREE.Object3D, color: number, dagged = 0) {
  const m = mats.cloth(color, "wool", [4, 3], THREE.DoubleSide);
  put(parent, G("hood", () => new THREE.SphereGeometry(1, 22, 14, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.72)), m, [0, 1.08, -0.04], undefined, [0.96, 1.04, 1.02]);
  put(parent, torus(0.62, 0.1, 18), m, [0, 1.08, 0.63], [0.2, 0, 0], [1, 1.25, 1]);
  put(parent, G("liripipe", () => new THREE.ConeGeometry(0.28, 1.6, 10)), m, [0, 0.8, -1.05], [-2.6, 0, 0]);
  const geo = G(`cape${dagged}`, () => {
    const g = folds(lathe([[2.55, 1.45], [2.35, 2.3], [2.05, 2.95], [1.2, 3.4], [0.6, 3.65]], 36), 12, 0.07, 2.6);
    return dagged ? dag(g, dagged, 0.35) : g;
  });
  put(spine, geo, m, [0, 0, 0], undefined, [1, 1, 0.82]);
}

function kettleHat(parent: THREE.Object3D, y = 1.3) {
  put(parent, G("kettle", () => lathe([[1.55, 0], [1.5, 0.07], [0.95, 0.12], [0.93, 0.5], [0.82, 0.88], [0.5, 1.1], [0.01, 1.18]], 28)), mats.iron(), [0, y, 0]);
  put(parent, torus(1.52, 0.06, 32), mats.iron(), [0, y + 0.02, 0], [Math.PI / 2, 0, 0]);
  put(parent, torus(0.93, 0.05, 28), mats.iron(), [0, y + 0.18, 0], [Math.PI / 2, 0, 0]);
}

function nasalHelm(parent: THREE.Object3D, coif = true) {
  put(parent, G("nasal", () => lathe([[0.9, 0], [0.92, 0.25], [0.84, 0.6], [0.6, 0.92], [0.24, 1.15], [0.02, 1.28]], 26)), mats.steel(), [0, 1.18, 0]);
  put(parent, torus(0.9, 0.07, 28), mats.iron(), [0, 1.22, 0], [Math.PI / 2, 0, 0]);
  put(parent, box(0.14, 0.65, 0.09), mats.iron(), [0, 1.0, 0.86], [-0.12, 0, 0]);
  put(parent, sphere(8), mats.brass(), [0, 2.47, 0], undefined, [0.09, 0.14, 0.09]);
  if (coif)
    put(parent, G("coif", () => lathe([[1.15, 0.0], [1.0, 0.3], [0.86, 0.75], [0.9, 1.25]], 22, 0.9, Math.PI * 2 - 1.8)), mats.mail([5, 2]), [0, 0, 0]);
}

function bascinet(parent: THREE.Object3D, plume: number) {
  put(parent, G("bascinet", () => lathe([[0.94, 0], [0.97, 0.45], [0.9, 0.85], [0.62, 1.25], [0.25, 1.52], [0.02, 1.62]], 28)), mats.steel(), [0, 0.5, -0.03]);
  put(parent, G("visor", () => lathe([[0.86, 0], [1.02, 0.35], [1.0, 0.65], [0.86, 0.95]], 20, -1.1, 2.2)), mats.steel(), [0, 0.55, 0.06], undefined, [1, 1, 1.12]);
  put(parent, box(1.1, 0.07, 0.3), mats.eye(), [0, 1.18, 0.98]);
  for (let i = -2; i <= 2; i++) put(parent, sphere(6), mats.eye(), [i * 0.16, 0.82, 1.08], undefined, 0.04);
  put(parent, torus(0.96, 0.05, 28), mats.brass(), [0, 0.52, -0.03], [Math.PI / 2, 0, 0]);
  put(parent, G("gorget", () => lathe([[1.3, -0.1], [1.0, 0.35], [0.62, 0.6]], 24)), mats.steel(), [0, 0, 0]);
  put(parent, G("plume", () => folds(lathe([[0.02, -1.6], [0.3, -1.0], [0.42, 0], [0.12, 0.35]], 14), 6, 0.25, 0)), mats.cloth(plume, "fur", [2, 2]), [0, 2.1, -0.5], [-2.2, 0, 0]);
}

function wrapHead(parent: THREE.Object3D, spine: THREE.Object3D, color: number) {
  const m = mats.cloth(color, "linen", [4, 2]);
  put(parent, G("wrapDome", () => new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55)), m, [0, 1.12, -0.04], [-0.15, 0, 0], [0.92, 1.0, 0.98]);
  for (let i = 0; i < 3; i++) put(parent, torus(0.84 - i * 0.04, 0.16, 22), m, [0, 1.3 + i * 0.18, -0.04 - i * 0.04], [Math.PI / 2 - 0.25, 0, 0.2 * (i - 1)]);
  put(spine, G("scarf", () => folds(lathe([[1.5, 2.55], [1.25, 3.0], [0.75, 3.4], [0.6, 3.7]], 26), 10, 0.1, 3.3)), mats.cloth(color, "linen", [4, 2], THREE.DoubleSide), [0, 0, 0.08], undefined, [1, 1, 0.85]);
}

function furCap(parent: THREE.Object3D, color: number) {
  put(parent, G("capDome", () => lathe([[0.88, 0], [0.86, 0.45], [0.66, 0.85], [0.3, 1.05], [0.02, 1.1]], 22)), mats.cloth(color, "wool", [3, 2]), [0, 1.35, -0.03]);
  put(parent, torus(0.9, 0.24, 24), M(0x6a5038, "fur", { rep: [6, 1], bump: 2 }), [0, 1.4, -0.03], [Math.PI / 2, 0, 0]);
  put(parent, sphere(8), mats.brass(), [0, 2.48, 0], undefined, 0.12);
}

function cloak(spine: THREE.Object3D, color: number, len = 7.5) {
  const geo = G(`cloak${len}`, () => folds(lathe([[2.4, 3.2 - len], [2.05, 3.2 - len * 0.6], [1.85, 2.2], [1.5, 3.1], [0.6, 3.45]], 28, 0.95, Math.PI * 2 - 1.9), 11, 0.12, 2.6));
  put(spine, geo, mats.cloth(color, "wool", [5, 3], THREE.DoubleSide), [0, 0, -0.1], undefined, [1, 1, 0.82]);
  for (const x of [-1, 1]) put(spine, sphere(8), mats.brass(), [x * 0.85, 3.1, 0.95], undefined, 0.17);
}

function pauldrons(spine: THREE.Object3D, b = 1) {
  for (const x of [-1, 1]) {
    for (let i = 0; i < 3; i++)
      put(
        spine,
        G("pauldron", () => new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)),
        mats.steel(),
        [x * (SH_X * b + 0.05 + i * 0.1), SH_Y + 0.25 - i * 0.42, 0],
        [0, 0, x * -(0.5 + i * 0.22)],
        [0.8 - i * 0.05, 0.62, 0.78],
      );
  }
}

/* ------------------------------------------------------------------ weapons (grip at origin, +Z toward the business end) */

function item(name: string) {
  const g = new THREE.Group();
  g.name = name;
  return g;
}

function extrudeYZ(key: string, pts: number[][], depth: number) {
  return G(key, () => {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 1, curveSegments: 8 })
      .translate(0, 0, -depth / 2)
      .rotateY(-Math.PI / 2);
  });
}

function sword(name: string) {
  const g = item(name);
  put(g, G("blade", () => new THREE.CylinderGeometry(0.12, 0.25, 3.9, 4).rotateX(Math.PI / 2).translate(0, 0, 2.55)), mats.steel(), undefined, undefined, [0.22, 1, 1]);
  put(g, G("fuller", () => new THREE.BoxGeometry(0.06, 0.08, 3.0).translate(0, 0, 2.3)), mats.iron());
  put(g, box(0.2, 1.5, 0.2), mats.iron(), [0, 0, 0.5]);
  for (const y of [-0.75, 0.75]) put(g, sphere(8), mats.iron(), [0, y, 0.5], undefined, 0.13);
  put(g, rodZ(0.14, 1.0, 10), mats.leather(0x3a2416), [0, 0, -0.5]);
  put(g, sphere(12), mats.brass(), [0, 0, -0.65], undefined, [0.2, 0.22, 0.2]);
  return g;
}

function heater(name: string, color: number) {
  const g = item(name);
  const outline = (s: number) => {
    const sh = new THREE.Shape();
    sh.moveTo(-1.45 * s, 1.7 * s);
    sh.lineTo(1.45 * s, 1.7 * s);
    sh.lineTo(1.45 * s, 0.2 * s);
    sh.quadraticCurveTo(1.35 * s, -1.6 * s, 0, -2.7 * s);
    sh.quadraticCurveTo(-1.35 * s, -1.6 * s, -1.45 * s, 0.2 * s);
    return sh;
  };
  const curve = (geo: THREE.BufferGeometry) => {
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - 0.28 * (p.getX(i) / 1.45) ** 2);
    geo.computeVertexNormals();
    return geo;
  };
  const make = (s: number, depth: number, z: number) =>
    curve(
      new THREE.ExtrudeGeometry(outline(s), { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2, curveSegments: 14 })
        .translate(0, 0, z)
        .rotateX(Math.PI / 2)
        .rotateZ(Math.PI)
        .translate(0, 0.45, -0.3),
    );
  put(g, G("heaterRim", () => make(1, 0.16, -0.08)), mats.iron());
  put(g, G("heaterFace", () => make(0.93, 0.08, 0.06)), M(color, "leather", { rep: [2, 2], bump: 0.8, rough: 0.6 }));
  const pale = M(0xe8d8a8, "leather", { rep: [1, 1], rough: 0.6 });
  for (const s of [-1, 1]) put(g, box(0.32, 0.08, 1.9), pale, [s * 0.55, 0.68, -0.2], [0, s * -0.6, 0]);
  put(g, rodZ(0.07, 0.9, 6), mats.leather(), [0, 0.05, -0.45]);
  return g;
}

function roundShield(color: number) {
  const g = new THREE.Group();
  put(g, cyl(1.7, 1.7, 0.18, 28), mats.cloth(color, "leather", [2, 2]), [0, 0, 0], [Math.PI / 2, 0, 0]);
  put(g, torus(1.7, 0.09, 32), mats.iron());
  put(g, sphere(12), mats.iron(), [0, 0, 0.12], undefined, [0.45, 0.45, 0.3]);
  for (let i = 0; i < 4; i++) put(g, box(0.12, 1.5, 0.05), mats.iron(), [Math.cos(i * 1.57) * 0.95, Math.sin(i * 1.57) * 0.95, 0.1], [0, 0, i * 1.57]);
  return g;
}

function pitchfork(name: string) {
  const g = item(name);
  put(g, rodZ(0.12, 10.6, 8, 0.1), mats.wood(), [0, 0, -2.6]);
  put(g, rodZ(0.16, 0.5, 8), mats.leather(0x5a3a22), [0, 0, 7.6]);
  put(g, G("forkBar", () => new THREE.TorusGeometry(0.62, 0.07, 6, 14, Math.PI).rotateZ(Math.PI)), mats.iron(), [0, 0, 8.2], [Math.PI / 2, 0, 0]);
  for (const x of [-0.6, 0, 0.6]) put(g, rodZ(0.07, 2.3, 6, 0.015), mats.iron(), [x, 0, 8.15]);
  return g;
}

function axe(name: string, scale = 1, bearded = false) {
  const g = item(name);
  put(g, rodZ(0.12, 5.2, 8, 0.11), mats.wood(), [0, 0, -1.5], undefined, [scale, scale, scale]);
  put(
    g,
    extrudeYZ(`axeHead${bearded}`, bearded
      ? [[-0.25, 0.15], [0.4, 0.15], [0.5, 0.9], [1.0, 1.9], [-1.1, 2.0], [-0.5, 1.1], [-0.3, 0.6]]
      : [[-0.32, 0.15], [0.32, 0.15], [0.45, 0.8], [0.75, 1.45], [-0.6, 1.55], [-0.38, 0.8]], 0.14),
    mats.iron(),
    [0, 0, 3.15 * scale],
    undefined,
    scale,
  );
  put(g, G(`axeEdge${bearded}`, () => new THREE.BoxGeometry(0.05, 0.08, bearded ? 2.2 : 1.4)), mats.steel(), [0, (bearded ? 1.96 : 1.5) * scale, 3.1 * scale], undefined, scale);
  put(g, box(0.3, 0.5, 0.7), mats.iron(), [0, -0.1 * scale, 3.15 * scale], undefined, scale);
  return g;
}

function peonTool(name: string) {
  const g = item(name);
  put(g, rodZ(0.12, 5.2, 8, 0.11), mats.wood(), [0, 0, -1.5]);
  const axeHead = new THREE.Group();
  axeHead.name = "axeHead";
  put(axeHead, extrudeYZ("axeHeadfalse", [[-0.32, 0.15], [0.32, 0.15], [0.45, 0.8], [0.75, 1.45], [-0.6, 1.55], [-0.38, 0.8]], 0.14), mats.iron(), [0, 0, 3.15]);
  put(axeHead, box(0.05, 0.08, 1.4), mats.steel(), [0, 1.5, 3.1]);
  put(axeHead, box(0.3, 0.5, 0.7), mats.iron(), [0, -0.1, 3.15]);
  const pickHead = new THREE.Group();
  pickHead.name = "pickHead";
  for (const s of [-1, 1]) put(pickHead, G("pickSpike", () => new THREE.CylinderGeometry(0.03, 0.17, 1.9, 6).translate(0, 0.95, 0)), mats.iron(), [0, s * 0.15, 3.25], [s * -0.25 + (s < 0 ? Math.PI : 0), 0, 0]);
  put(pickHead, box(0.34, 0.5, 0.6), mats.iron(), [0, 0, 3.25]);
  pickHead.visible = false;
  g.add(axeHead, pickHead);
  return g;
}

function halberd(name: string, tassel: number) {
  const g = item(name);
  put(g, rodZ(0.13, 10.4, 8, 0.11), mats.darkWood(), [0, 0, -3.4]);
  for (const z of [-3.45, 1.2, 1.9]) put(g, rodZ(0.17, 0.25, 8), mats.iron(), [0, 0, z]);
  put(g, G("halSpike", () => new THREE.CylinderGeometry(0.02, 0.22, 1.9, 4).rotateX(Math.PI / 2).translate(0, 0, 7.9)), mats.steel(), undefined, undefined, [0.45, 1, 1]);
  put(g, extrudeYZ("halBlade", [[-0.75, 0.1], [0.75, 0.1], [0.9, 0.7], [0.6, 1.5], [-0.2, 1.75], [-1.0, 1.55], [-0.85, 0.7]], 0.12), mats.steel(), [0, 0, 6.3]);
  put(g, extrudeYZ("halHook", [[-0.25, -0.1], [0.25, -0.1], [-0.1, -1.2], [-0.35, -1.3]], 0.12), mats.iron(), [0, 0, 6.4]);
  put(g, box(0.28, 0.32, 1.7), mats.iron(), [0, 0, 6.3]);
  for (const s of [-1, 1]) put(g, box(0.05, 0.08, 1.8), mats.iron(), [s * 0.13, 0, 5.2]);
  put(g, G("tassel", () => folds(lathe([[0.32, -0.9], [0.28, -0.3], [0.12, 0]], 12), 7, 0.3, -0.1).rotateX(Math.PI / 2)), mats.cloth(tassel, "fur", [2, 2]), [0, 0, 5.4]);
  return g;
}

function lance(name: string, team: number) {
  const g = item(name);
  put(g, rodZ(0.17, 14.5, 10, 0.1), mats.wood(), [0, 0, -3.5]);
  put(g, G("vamplate", () => new THREE.ConeGeometry(0.6, 0.9, 16, 1, true).rotateX(-Math.PI / 2)), mats.steel(), [0, 0, 0.95]);
  put(g, G("lanceTip", () => new THREE.CylinderGeometry(0.01, 0.28, 1.6, 4).rotateX(Math.PI / 2).translate(0, 0, 11.8)), mats.steel(), undefined, undefined, [0.4, 1, 1]);
  put(g, cyl(0.3, 0.3, 0.35, 14), mats.brass(), [0, 0, 10.5], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) put(g, G("crownPt", () => new THREE.ConeGeometry(0.07, 0.4, 5)), mats.brass(), [Math.cos(i) * 0.26, Math.sin(i) * 0.26, 10.8], [Math.PI / 2, 0, 0]);
  put(g, G("horsetail", () => folds(lathe([[0.55, -2.6], [0.42, -1.4], [0.32, -0.4], [0.2, 0]], 16), 9, 0.35, -0.2).rotateX(Math.PI / 2)), M(0x2a2220, "fur", { rep: [3, 1], bump: 2 }), [0, 0, 10.3]);
  put(g, G("pennon", () => {
    const pl = new THREE.PlaneGeometry(2.6, 1.3, 8, 2);
    const p = pl.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setZ(i, Math.sin(x * 2.2) * 0.18);
      p.setY(i, p.getY(i) * (1 - (x + 1.3) / 3.6));
    }
    pl.computeVertexNormals();
    return pl.rotateY(Math.PI / 2).rotateX(Math.PI / 2).translate(0, -0.7, 8.6);
  }), mats.cloth(team, "linen", [2, 1], THREE.DoubleSide));
  return g;
}

const BOW_TIP = 4.5, BOW_BACK = -0.7;
function longbow(name: string) {
  const g = item(name);
  put(g, G("bowStave", () => {
    const pts = [-BOW_TIP, -2.9, -1.4, 0, 1.4, 2.9, BOW_TIP].map((y) => new THREE.Vector3(0, y, 0.25 - (y / BOW_TIP) ** 2 * (0.25 - BOW_BACK)));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 48, 0.1, 6);
    const p = tube.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 1 - Math.abs(p.getY(i)) / BOW_TIP * 0.55;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, 0.25 - (p.getY(i) / BOW_TIP) ** 2 * (0.25 - BOW_BACK) + (p.getZ(i) - (0.25 - (p.getY(i) / BOW_TIP) ** 2 * (0.25 - BOW_BACK))) * k);
    }
    tube.computeVertexNormals();
    return tube;
  }), M(0xc49a52, "grain", { rep: [1, 6], rough: 0.5, bump: 0.5 }));
  put(g, cyl(0.15, 0.15, 1.0, 10), mats.leather(0x3a2416), [0, 0, 0.25]);
  for (const s of [-1, 1]) put(g, G("nock", () => new THREE.ConeGeometry(0.08, 0.35, 6)), M(0xe8dcc0, null), [0, s * (BOW_TIP + 0.1), BOW_BACK], [s < 0 ? Math.PI : 0, 0, 0]);
  const string = M(0xf0e6cc, null, { rough: 0.6 });
  for (const n of ["strTop", "strBot"]) {
    const s = new THREE.Mesh(G("string", () => new THREE.CylinderGeometry(0.025, 0.025, 1, 4).translate(0, 0.5, 0)), string);
    s.name = n;
    g.add(s);
  }
  return g;
}

function arrow(name: string, fletch: number) {
  const g = item(name);
  put(g, rodZ(0.05, 6.1, 6), M(0xd8bc8a, "grain", { rep: [1, 4] }), [0, 0, 0]);
  put(g, G("arrowHead", () => new THREE.CylinderGeometry(0.01, 0.14, 0.6, 4).rotateX(Math.PI / 2).translate(0, 0, 6.35)), mats.iron(), undefined, undefined, [0.4, 1, 1]);
  for (let i = 0; i < 3; i++) {
    const f = put(g, box(0.02, 0.3, 1.0), M(i ? 0xf0ece0 : fletch, null, { side: THREE.DoubleSide }), [0, 0, 0.75]);
    f.position.set(Math.cos(i * 2.09) * 0.14, Math.sin(i * 2.09) * 0.14, 0.75);
    f.rotation.z = i * 2.09 + Math.PI / 2;
  }
  return g;
}

function quiver(parent: THREE.Object3D, fletch: number, p: V3, r: V3) {
  const q = new THREE.Group();
  q.position.set(...p);
  q.rotation.set(...r);
  put(q, G("quiver", () => lathe([[0.42, -2.2], [0.52, -1.0], [0.55, 0.9], [0.6, 1.1]], 14)), mats.leather(0x5a3a22));
  put(q, torus(0.58, 0.07, 14), mats.leather(0x3a2416), [0, 1.05, 0], [Math.PI / 2, 0, 0]);
  put(q, torus(0.53, 0.06, 14), mats.brass(), [0, -1.7, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9, rr = 0.15 + (i % 3) * 0.12;
    put(q, rodZ(0.04, 1.2, 4), M(0xd8bc8a, "grain"), [Math.cos(a) * rr, 0.8, Math.sin(a) * rr], [-Math.PI / 2, 0, 0]);
    put(q, box(0.3, 0.6, 0.02), M(i % 2 ? 0xf0ece0 : fletch, null, { side: THREE.DoubleSide }), [Math.cos(a) * rr, 1.6, Math.sin(a) * rr], [0, a, 0]);
  }
  parent.add(q);
}

/* ------------------------------------------------------------------ poses */

/** Flat pose layout so blends and smoothing are plain array lerps. */
const I = { m: 0, o: 9, sp: 18, hp: 21, lg: 24, g2: 28, pull: 29, arrow: 30, act: 31 } as const;
const POSE_LEN = 32;
type Pose = Float32Array;

interface PoseSpec {
  m?: number[];
  o?: number[];
  sp?: V3;
  hp?: V3;
  lg?: number[];
  g2?: number;
  pull?: number;
  arrow?: number;
  act?: number;
}

/** Item transform in chest space: grip position, pointing direction, and an "up" hint (defaults to the edge leading a vertical swing). */
const ip = (p: V3, d: V3, u?: V3) => [...p, ...d, ...(u ?? [0, -d[2], d[1]])];

function pose(spec: PoseSpec, from?: Pose): Pose {
  const out = from ? from.slice() : new Float32Array(POSE_LEN);
  if (!from) out[I.arrow] = 1;
  const set = (at: number, v?: number[]) => v && v.forEach((x, i) => (out[at + i] = x));
  set(I.m, spec.m);
  set(I.o, spec.o);
  set(I.sp, spec.sp ?? (from ? undefined : [0, 0, 0]));
  set(I.hp, spec.hp ?? (from ? undefined : [0, 0, 0]));
  set(I.lg, spec.lg ?? (from ? undefined : [0, 0, 0, 0]));
  if (spec.g2 !== undefined) out[I.g2] = spec.g2;
  if (spec.pull !== undefined) out[I.pull] = spec.pull;
  if (spec.arrow !== undefined) out[I.arrow] = spec.arrow;
  if (spec.act !== undefined) out[I.act] = spec.act;
  return out;
}

const STANCE = [-0.32, 0.38, 0.28, 0.32];
const LUNGE = [0.32, 0.3, -0.62, 0.55];

interface Style {
  carry: Pose;
  guard: Pose;
  cocked: Pose;
  impact: Pose;
  windup: number;
  recover: number;
  /** What the right hand holds: its item, or a named marker (ram crew). */
  right: "item" | string;
  /** Left hand: its own item (shield/bow), the right item's second grip, a named marker, or nothing. */
  left: "item" | "g2" | string;
  leftAxis?: "y" | "z";
  rightAxis?: "y" | "z";
  poleR?: V3;
  seated?: boolean;
}

function style(s: { carry: PoseSpec; guard: PoseSpec; cocked: PoseSpec; impact: PoseSpec } & Omit<Style, "carry" | "guard" | "cocked" | "impact">): Style {
  const carry = pose(s.carry);
  const guard = pose({ lg: STANCE, ...s.guard }, carry);
  const cocked = pose(s.cocked, guard);
  const impact = pose({ lg: LUNGE, ...s.impact }, cocked);
  return { ...s, carry, guard, cocked, impact };
}

const STYLES: Record<string, Style> = {
  sword: style({
    right: "item",
    left: "item",
    leftAxis: "z",
    windup: 0.45,
    recover: 0.35,
    carry: { m: ip([-1.6, 0.3, 1.5], [0.05, 0.7, 0.72], [0, 0.72, -0.7]), o: ip([1.95, 1.3, 1.1], [0, 1, 0.1], [0.35, 0, 1]) },
    guard: { m: ip([-1.35, 1.7, 2.3], [0.15, 0.85, 0.5], [0, -0.5, 0.85]), o: ip([1.05, 2.0, 2.6], [0.1, 1, 0.15], [-0.25, 0, 1]), sp: [0.1, 0.15, 0] },
    cocked: { m: ip([-1.75, 4.3, -0.2], [0.45, 0.35, -0.82]), o: ip([0.95, 2.3, 2.8], [0.1, 1, 0.1], [-0.3, 0, 1]), sp: [-0.06, -0.45, 0.05] },
    impact: { m: ip([0.35, 1.1, 3.1], [0.55, -0.4, 0.73], [0.3, -0.9, -0.3]), o: ip([1.6, 1.6, 2.2], [0, 1, 0.2], [0, 0, 1]), sp: [0.3, 0.42, 0] },
  }),
  thrust: style({
    right: "item",
    left: "g2",
    windup: 0.5,
    recover: 0.35,
    carry: { m: ip([-1.5, 0.6, 0.9], [0.12, 0.88, 0.45], [1, 0, 0]), g2: 2.2 },
    guard: { m: ip([-1.3, 0.5, 0.7], [0.22, 0.2, 0.95], [1, 0, 0]), sp: [0.05, 0.1, 0] },
    cocked: { m: ip([-1.7, 0.9, -0.9], [0.2, 0.18, 0.96], [1, 0, 0]), sp: [-0.1, -0.35, 0] },
    impact: { m: ip([-0.9, 1.1, 1.8], [0.1, 0.02, 1], [1, 0, 0]), sp: [0.32, 0.28, 0] },
  }),
  cleave: style({
    right: "item",
    left: "g2",
    windup: 0.55,
    recover: 0.4,
    carry: { m: ip([-1.1, 2.2, 1.6], [-0.15, 0.55, -0.82]), g2: -1.1 },
    guard: { m: ip([-0.9, 1.4, 2.3], [-0.45, 0.85, 0.25], [-0.25, 0, 1]) },
    cocked: { m: ip([-2.0, 3.0, 0.2], [-0.55, 0.25, -0.8], [-0.8, 0, 0.55]), sp: [0, -0.6, -0.1] },
    impact: { m: ip([0.6, 1.8, 2.6], [0.75, -0.05, 0.65], [0.65, 0, -0.75]), sp: [0.15, 0.5, 0.05] },
  }),
  poleaxe: style({
    right: "item",
    left: "g2",
    windup: 0.55,
    recover: 0.45,
    carry: { m: ip([-1.8, 0.4, 0.9], [0.05, 0.97, 0.22], [0, 0, 1]), g2: 1.6 },
    guard: { m: ip([-1.0, 1.2, 1.4], [0.1, 0.5, 0.86], [0, 0.86, -0.5]), g2: 1.8 },
    cocked: { m: ip([-0.7, 4.2, 0.9], [0.05, 0.55, -0.83]), g2: 1.4, sp: [-0.25, -0.1, 0] },
    impact: { m: ip([-0.4, 0.9, 2.2], [0.03, -0.45, 0.89]), sp: [0.5, 0.05, 0] },
  }),
  chop: style({
    right: "item",
    left: "g2",
    windup: 0.45,
    recover: 0.4,
    carry: { m: ip([-1.4, 0.9, 1.6], [0.95, 0.15, 0.25], [0, -1, 0]), g2: 1.8 },
    guard: { m: ip([-0.9, 1.6, 2.0], [0, 0.85, 0.5]), g2: -0.9 },
    cocked: { m: ip([-0.6, 4.1, 0.7], [0.05, 0.5, -0.86]), sp: [-0.2, 0, 0] },
    impact: { m: ip([-0.3, 0.5, 2.5], [0.02, -0.55, 0.83]), sp: [0.5, 0, 0], lg: [-0.1, 0.5, 0.25, 0.5] },
  }),
  bow: style({
    right: "item",
    left: "item",
    leftAxis: "y",
    rightAxis: "y",
    poleR: [-1, 0.4, -1],
    windup: 0.6,
    recover: 0.3,
    carry: { m: ip([-1.8, -0.9, 0.6], [0, 0.2, 1], [0, 1, 0]), o: ip([1.8, 0.5, 1.3], [0.1, -0.25, 0.96], [0.15, 1, 0.25]), arrow: 0, pull: 0 },
    guard: { m: ip([-1.7, -0.5, -0.3], [0.2, 0.95, 0.1], [0, 0, 1]), o: ip([1.9, 1.5, 2.2], [0.3, 0.1, 0.95], [0.4, 1, 0]), hp: [0, -0.3, 0], sp: [0, -0.2, 0], arrow: 1, pull: 0, lg: [-0.2, 0.25, 0.3, 0.2] },
    cocked: { m: ip([-0.3, 3.95, 0.6], [0.964, -0.134, 0.229], [0.05, 1, 0.2]), o: ip([5.33, 3.17, 1.94], [0.964, -0.134, 0.229], [0.05, 1, 0.2]), hp: [0, -0.55, 0], sp: [0, -0.55, 0], pull: 1 },
    impact: { m: ip([-1.3, 4.1, -0.7], [0.964, -0.134, 0.229], [0.05, 1, 0.2]), pull: 0, arrow: 0, lg: [-0.2, 0.25, 0.3, 0.2] },
  }),
  lance: style({
    right: "item",
    left: "reins",
    seated: true,
    windup: 0.5,
    recover: 0.45,
    carry: { m: ip([-1.9, 0.8, 0.8], [0.05, 0.98, 0.15], [0, 0, 1]), act: 0 },
    guard: { m: ip([-1.9, 1.4, 1.0], [0.05, 0.6, 0.8], [0, 0.8, -0.6]), lg: [0, 0, 0, 0] },
    cocked: { m: ip([-1.6, 1.5, -0.6], [0.12, 0.05, 0.99], [0, 1, 0]), sp: [-0.15, -0.3, 0], act: -1 },
    impact: { m: ip([-1.3, 1.8, 2.6], [0.1, -0.15, 0.98], [0, 1, 0]), sp: [0.3, 0.2, 0], act: 0.5, lg: [0, 0, 0, 0] },
  }),
  push: style({
    right: "barR",
    left: "barL",
    windup: 0.8,
    recover: 0.6,
    carry: { sp: [0.45, 0, 0], act: 0 },
    guard: { sp: [0.5, 0, 0], lg: [-0.45, 0.55, 0.35, 0.3] },
    cocked: { sp: [0.3, 0, 0], act: -1 },
    impact: { sp: [0.65, 0, 0], act: 1, lg: [-0.6, 0.7, 0.45, 0.25] },
  }),
};

/* ------------------------------------------------------------------ units */

const cloth = (t: Team) => TEAM_CLOTH[t];
const TRIM = 0xd8b060;

interface FigureDef {
  P: string;
  style: string;
}

function finish(root: THREE.Group, kind: string, figures: FigureDef[], scale = 1) {
  root.scale.setScalar(scale);
  root.userData.unit = { kind, figures };
  root.traverse((o) => ((o as THREE.Mesh).isMesh && ((o as THREE.Mesh).castShadow = true)));
  return bake(root);
}

function levy(t: Team) {
  const h = human({
    hair: HAIR.dark,
    beard: "short",
    coat: { color: 0x7a7a5a, tex: "linen", hem: 3.4, flare: 1.08 },
    chest: mats.cloth(0x6a6a48, "quilt", [6, 2]),
    sleeves: { mat: mats.cloth(cloth(t), "wool", [2, 2]) },
    legs: { mat: mats.cloth(0x4a3e30, "wool"), wraps: 0xe0d6bc },
    boots: mats.leather(0x4a3020),
  });
  wrapHead(h.head, h.spine, 0xece4d0);
  for (const x of [-1, 1]) for (const y of [-0.6, -1.2, -1.8]) put(h.spine.getObjectByName(`${x < 0 ? "shR" : "shL"}`) ?? h.spine, torus(0.5, 0.05, 14), mats.cloth(0xe0d6bc, "linen"), [0, y, 0], [Math.PI / 2, 0, 0]);
  h.spine.add(pitchfork("main"));
  return finish(h.root, "levy", [{ P: "", style: "thrust" }]);
}

function raider(t: Team) {
  const h = human({
    hair: HAIR.auburn,
    beard: "full",
    coat: { color: 0x5a4a38, tex: "wool", hem: 2.6 },
    chest: mats.leather(0x6a4a30),
    sleeves: { mat: mats.cloth(0x6a5a44, "wool") },
    legs: { mat: mats.cloth(0x3e3a30, "wool"), wraps: 0x8a7a5a },
    boots: mats.leather(0x3a2618),
  });
  hood(h.head, h.spine, cloth(t), 9);
  h.spine.add(axe("main", 1, true));
  return finish(h.root, "raider", [{ P: "", style: "chop" }]);
}

function soldier(t: Team) {
  const h = human({
    hair: HAIR.brown,
    beard: "moustache",
    coat: { color: cloth(t), hem: 2.4, flare: 1.02 },
    under: { mat: mats.mail([10, 2]), hem: 2.9 },
    chest: mats.cloth(cloth(t), "wool", [5, 3]),
    sleeves: { mat: mats.mail([3, 3]) },
    legs: { mat: mats.cloth(0x4a4238, "wool"), shin: mats.mail([3, 3]) },
    boots: mats.leather(0x3a2818),
    gloves: mats.leather(0x4a3020),
  });
  nasalHelm(h.head);
 h.spine.add(sword("main"), heater("off", cloth(t)));
  return finish(h.root, "soldier", [{ P: "", style: "sword" }]);
}

function brute(t: Team) {
  const h = human({
    hair: HAIR.dark,
    beard: "full",
    bulk: 1.18,
    coat: { color: 0x4a3a2a, tex: "quilt", hem: 2.6 },
    chest: mats.mail([8, 3]),
    sleeves: { mat: mats.cloth(0x4a3a2a, "quilt", [2, 3]), rolled: true },
    legs: { mat: mats.cloth(0x3a3028, "wool") },
    boots: mats.leather(0x2e2016),
    gloves: mats.leather(0x3a2618),
    belt: mats.leather(0x2a1a10),
  });
  nasalHelm(h.head);
  for (const x of [-1, 1]) put(h.head, box(0.12, 0.9, 0.7), mats.steel(), [x * 0.82, 0.85, 0.25], [0, 0, x * 0.12]);
  cloak(h.spine, cloth(t));
  h.spine.add(axe("main", 1.25, true));
  return finish(h.root, "brute", [{ P: "", style: "cleave" }], 1.18);
}

function archer(t: Team) {
  const h = human({
    hair: HAIR.blond,
    beard: "short",
    coat: { color: 0x6a6a64, tex: "wool", hem: 2.2 },
    sleeves: { mat: mats.cloth(0x5e5e58, "wool") },
    legs: { mat: mats.cloth(0xb89a58, "wool") },
    boots: mats.leather(0x4a3020),
    feet: mats.leather(0x4a3020),
  });
  hood(h.head, h.spine, cloth(t), 11);
  quiver(h.hips, cloth(t), [-1.35, 0.1, -0.55], [0.25, 0, -0.35]);
  put(h.hips, rodZ(0.09, 1.7, 6), mats.leather(0x3a2416), [1.4, 0.2, 0.3], [2.3, 0, 0]);
  const bow = longbow("off");
  h.spine.add(bow, arrow("main", cloth(t)));
  return finish(h.root, "archer", [{ P: "", style: "bow" }]);
}

function ward(t: Team) {
  const h = human({
    hair: HAIR.brown,
    hairStyle: "none",
    coat: { color: cloth(t), hem: 2.3, flare: 1.05 },
    under: { mat: mats.mail([10, 2]), hem: 2.8 },
    chest: mats.steel(),
    sleeves: { mat: mats.mail([3, 3]), fore: mats.steel() },
    legs: { mat: mats.mail([3, 3]), shin: mats.steel() },
    boots: mats.steel(),
    feet: mats.steel(),
    gloves: mats.steel(),
    belt: mats.leather(0x2a1a10),
  });
  bascinet(h.head, cloth(t));
  pauldrons(h.spine);
  for (const x of [-1, 1]) put(h.hips, box(1.0, 1.3, 0.12), mats.steel(), [x * 0.75, -0.1, 1.15], [0.18, 0, 0]);
  put(h.spine, G("plackart", () => lathe([[1.42, -0.2], [1.52, 0.7], [1.5, 1.2]], 24, -1.1, 2.2)), mats.steel(), [0, 0.05, 0.04], undefined, [1.02, 1, 0.82]);
  put(h.spine, torus(0.65, 0.05, 16), mats.brass(), [0, 2.0, 1.32], [0, 0, 0]);
  put(h.spine, box(0.08, 1.2, 0.08), mats.brass(), [0, 2.0, 1.32]);
  h.spine.add(halberd("main", cloth(t)));
  return finish(h.root, "ward", [{ P: "", style: "poleaxe" }], 1.04);
}

function peon(t: Team) {
  const h = human({
    hair: HAIR.grey,
    beard: "moustache",
    coat: { color: 0x5e5a3e, tex: "wool", hem: 1.9 },
    sleeves: { mat: mats.cloth(0x4e5a40, "wool"), rolled: true },
    legs: { mat: mats.cloth(0x5a4a36, "wool"), wraps: 0x8a7a5a },
    boots: mats.leather(0x4a3020),
  });
  hood(h.head, h.spine, cloth(t), 10);
  kettleHat(h.head, 1.42);
  put(h.spine, G("apron", () => folds(lathe([[1.62, -2.2], [1.5, -0.6], [1.45, 0.4]], 16, -0.8, 1.6), 5, 0.06, 0)), mats.leather(0x6a4a2e), [0, 0, 0.04], undefined, [1, 1, 0.84]);
  const sack = new THREE.Group();
  sack.name = "sack";
  put(sack, sphere(16), M(0xb09a6a, "linen", { rep: [2, 2], bump: 1.5 }), [0, 0, 0], undefined, [1.1, 1.3, 0.8]);
  put(sack, torus(0.35, 0.1, 12), mats.leather(), [0, 1.2, 0], [Math.PI / 2, 0, 0]);
  put(sack, sphere(10), M(0xf0c040, "steel", { metal: 0.45, rough: 0.3 }), [0, 1.35, 0], undefined, [0.3, 0.2, 0.3]);
  sack.position.set(0, 1.8, -1.6);
  sack.visible = false;
  const logs = new THREE.Group();
  logs.name = "logs";
  for (let i = 0; i < 3; i++) {
    put(logs, cyl(0.42, 0.42, 4.2, 12), mats.darkWood(), [(i - 1) * 0.75, i === 1 ? 0.6 : 0, 0], [0, 0, Math.PI / 2 + 0.1 * (i - 1)]);
    for (const s of [-1, 1]) put(logs, cyl(0.38, 0.38, 0.02, 12), M(0xd8b07a, "grain"), [(i - 1) * 0.75 + s * 2.1 * Math.cos(0.1 * (i - 1)), i === 1 ? 0.6 : 0, 0], [0, 0, Math.PI / 2]);
  }
  logs.position.set(0, 2.8, -1.4);
  logs.rotation.y = Math.PI / 2;
  logs.visible = false;
  h.spine.add(sack, logs, peonTool("main"));
  return finish(h.root, "peon", [{ P: "", style: "chop" }], 1.02);
}

function horse(root: THREE.Object3D, team: number) {
  const coat = M(0xa8703a, "hide", { rep: [3, 3], bump: 0.6, rough: 0.6 });
  const points = M(0x2e2118, "hide", { rep: [1, 2], rough: 0.6 });
  const mane = M(0x1e1612, "fur", { rep: [2, 4], bump: 2, rough: 0.9 });
  const body = joint(root, "hBody");
  put(body, sphere(26), coat, [0, 8.5, -0.2], undefined, [1.75, 1.95, 3.7]);
  put(body, sphere(22), coat, [0, 8.7, 2.7], undefined, [1.58, 1.95, 1.75]);
  put(body, sphere(22), coat, [0, 9.0, -3.0], undefined, [1.8, 1.95, 2.0]);
  put(body, sphere(16), coat, [0, 10.25, 2.1], undefined, [0.85, 0.6, 1.5]);
  for (const x of [-1, 1]) {
    put(body, sphere(18), coat, [x * 1.0, 8.6, -3.4], undefined, [0.95, 1.7, 1.45]);
    put(body, sphere(16), coat, [x * 1.0, 8.4, 3.0], undefined, [0.75, 1.4, 1.0]);
  }

  const neck = joint(body, "hNeck", [0, 9.9, 3.4]);
  neck.rotation.x = 0.62;
  put(neck, G("hNeckGeo", () => lathe([[1.35, -0.8], [1.22, 0.6], [1.0, 2.0], [0.82, 3.2], [0.76, 3.8]], 22)), coat, [0, 0, 0], undefined, [0.68, 1, 1]);
  for (let i = 0; i < 11; i++) {
    const y = -0.2 + i * 0.37, r = 1.25 - (y / 3.8) * 0.45;
    put(neck, box(0.26, 0.62, 0.5), mane, [((i % 2) - 0.5) * 0.12, y, -r * 0.96], [-0.35, 0, ((i % 3) - 1) * 0.12]);
  }
  const head = joint(neck, "hHead", [0, 3.6, 0]);
  head.rotation.x = 1.6;
  put(head, sphere(20), coat, [0, 0.4, -0.05], undefined, [0.8, 0.95, 0.8]);
  put(head, G("hFace", () => lathe([[0.86, 0.2], [0.72, 1.4], [0.58, 2.4], [0.52, 2.8]], 20)), coat, [0, 0, 0.05], undefined, [0.72, 1, 1]);
  put(head, sphere(16), coat, [0, 2.85, 0.1], undefined, [0.44, 0.55, 0.58]);
  put(head, sphere(14), points, [0, 3.2, 0.15], undefined, [0.4, 0.3, 0.5]);
  for (const x of [-1, 1]) {
    put(head, sphere(8), mats.eye(), [x * 0.36, 3.25, -0.12], undefined, 0.1);
    put(head, sphere(10), M(0x120c08, null, { rough: 0.15 }), [x * 0.6, 0.95, -0.35], undefined, [0.08, 0.17, 0.15]);
    put(head, G("hEar", () => new THREE.ConeGeometry(0.2, 0.75, 10)), coat, [x * 0.38, 0.05, -0.78], [-2.21, 0, x * -0.25], [1, 1, 0.6]);
    put(head, box(0.06, 2.2, 0.14), mats.leather(0x3a2416), [x * 0.6, 1.4, 0.0], [0, 0, x * -0.05]);
    put(head, torus(0.12, 0.04, 10), mats.iron(), [x * 0.5, 2.75, 0.45], [0, Math.PI / 2, 0]);
  }
  put(head, torus(0.6, 0.06, 18), mats.leather(0x3a2416), [0, 2.35, 0.05], [Math.PI / 2, 0, 0], [0.82, 1, 1]);
  put(head, torus(0.66, 0.06, 18, Math.PI), mats.leather(0x3a2416), [0, 0.3, -0.25], [Math.PI / 2 + 0.3, 0, Math.PI], [0.95, 1, 1]);
  put(head, box(0.5, 0.9, 0.2), mane, [0, 0.0, -0.85], [0.4, 0, 0]);
  put(head, sphere(8), M(0xf0ece4, null), [0, 1.3, -0.62], undefined, [0.16, 0.5, 0.05]);

  const tail = joint(body, "hTail", [0, 9.9, -4.85]);
  tail.rotation.x = 0.35;
  put(tail, G("hTailGeo", () => folds(lathe([[0.06, -5.4], [0.5, -4.4], [0.62, -2.6], [0.48, -1.0], [0.32, 0]], 14), 7, 0.3, -0.5)), mane);

  const leg = (n: string, x: number, z: number, top: number, upper: number, hind: boolean) => {
    const up = joint(body, n, [x, top, z]);
    put(up, G(`hUp${hind}`, () => lathe(hind ? [[0.42, -upper], [0.58, -upper * 0.65], [0.86, -0.8], [0.95, 0.6]] : [[0.36, -upper], [0.5, -upper * 0.65], [0.72, -0.6], [0.8, 0.5]], 14)), coat);
    const kn = joint(up, n + "k", [0, -upper, 0]);
    put(kn, sphere(12), coat, [0, 0, hind ? -0.1 : 0.05], undefined, [0.42, 0.45, 0.5]);
    put(kn, G("hCannon", () => lathe([[0.27, -2.9], [0.3, -1.5], [0.36, 0]], 12)), points);
    const fet = joint(kn, n + "f", [0, -2.9, 0]);
    put(fet, sphere(12), points, [0, 0, 0], undefined, [0.36, 0.38, 0.4]);
    put(fet, G("hFeather", () => folds(lathe([[0.55, -0.9], [0.45, -0.4], [0.3, 0.1]], 12), 7, 0.3, 0)), mane, [0, -0.3, 0]);
    put(fet, G("hHoof", () => lathe([[0.55, -1.62], [0.5, -1.2], [0.36, -0.8]], 14)), M(0x2a2420, "grain", { rough: 0.5 }), [0, 0, 0.08]);
    return up;
  };
  leg("hFL", 0.85, 3.0, 7.6, 3.1, false);
  leg("hFR", -0.85, 3.0, 7.6, 3.1, false);
  leg("hHL", 0.85, -3.25, 8.2, 3.3, true);
  leg("hHR", -0.85, -3.25, 8.2, 3.3, true);

  const blanket = mats.cloth(team, "wool", [4, 2], THREE.DoubleSide);
  put(body, G("blanket", () => new THREE.CylinderGeometry(1, 1, 3.8, 28, 4, true, -1.75, 3.5).rotateX(-Math.PI / 2)), blanket, [0, 8.5, -0.3], undefined, [1.84, 2.04, 1]);
  for (const x of [-1, 1]) put(body, box(0.08, 0.28, 3.85), M(TRIM, "linen"), [x * 1.82, 8.22, -0.3]);
  const leather = mats.leather(0x5a3a20);
  put(body, sphere(18), leather, [0, 10.55, -0.4], undefined, [1.3, 0.38, 1.7]);
  put(body, sphere(14), leather, [0, 10.9, 1.2], undefined, [0.55, 0.55, 0.42]);
  put(body, torus(0.75, 0.2, 16, Math.PI), leather, [0, 10.7, -1.85], undefined, [1, 0.7, 1]);
  for (const x of [-1, 1]) {
    put(body, box(0.12, 1.8, 2.3), leather, [x * 1.75, 9.6, -0.2], [0, 0, x * 0.22]);
    put(body, box(0.1, 3.0, 0.22), leather, [x * 1.98, 8.2, 0.2]);
    put(body, torus(0.35, 0.07, 12), mats.iron(), [x * 2.0, 6.6, 0.2], [0, Math.PI / 2, 0]);
  }
  put(body, torus(1, 0.09, 30), leather, [0, 8.5, 0.9], undefined, [1.82, 2.02, 1]);
  put(body, torus(1, 0.1, 30, Math.PI), leather, [0, 9.0, 3.9], [0.35, 0, Math.PI], [1.45, 1.5, 1]);
  const reins = joint(body, "reins", [0, 11.0, 1.7]);

  root.updateMatrixWorld(true);
  const toBody = (o: THREE.Object3D, p: V3) => body.worldToLocal(o.localToWorld(new THREE.Vector3(...p)));
  for (const x of [-1, 1]) {
    const a = toBody(head, [x * 0.5, 2.75, 0.45]);
    const c = toBody(reins, [x * 0.35, 0, 0]);
    const mid = a.clone().lerp(c, 0.5).add(new THREE.Vector3(0, -0.6, 0));
    put(body, new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, c), 12, 0.05, 4), mats.leather(0x3a2416));
  }
}

function runner(t: Team) {
  const root = new THREE.Group();
  horse(root, cloth(t));
  const h = human({
    hair: HAIR.dark,
    beard: "moustache",
    coat: { color: cloth(t), hem: 1.7, flare: 1.15 },
    sleeves: { mat: mats.cloth(cloth(t), "wool") },
    legs: { mat: mats.cloth(0x3a3028, "wool") },
    boots: mats.leather(0x2e2016),
    gloves: mats.leather(0x4a3020),
  });
  furCap(h.head, cloth(t));
  for (const y of [0.0, 1.2]) put(h.spine, cyl(1, 1, 0.14, 28, true), M(TRIM, "linen"), [0, y + 1.4, 0], undefined, [1.66, 1, 1.24]);
  put(h.spine, box(0.2, 3.0, 0.08), M(TRIM, "linen"), [-0.35, 1.5, 1.28], [0, 0, 0.12]);
  put(h.hips, cyl(1, 1, 0.2, 28, true), M(TRIM, "linen"), [0, SPINE_Y - 1.6, 0], undefined, [1.98, 1, 1.6]);
  h.spine.add(lance("main", cloth(t)));
  const thR = h.root.getObjectByName("thR")!, thL = h.root.getObjectByName("thL")!;
  thR.rotation.set(-1.15, 0, -0.5);
  thL.rotation.set(-1.15, 0, 0.5);
  h.root.getObjectByName("knR")!.rotation.x = 1.55;
  h.root.getObjectByName("knL")!.rotation.x = 1.55;
  h.root.position.set(0, 10.6 - HIP_Y, -0.6);
  root.getObjectByName("hBody")!.add(h.root);
  return finish(root, "runner", [{ P: "", style: "lance" }], 0.82);
}

/** Covered battering ram pushed by two crewmen; the inner body keeps the renderer's bob flag. */
export function buildRamModel(t: Team) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.userData.movingRamBody = true;
  root.add(body);
  const wood = M(0x9a7448, "grain", { rep: [1, 3], bump: 1 });
  const dark = M(0x5a4028, "grain", { rep: [1, 3], bump: 1 });
  const iron = mats.iron();
  for (const s of [-1, 1]) {
    put(body, box(0.9, 0.9, 15), wood, [s * 3.1, 2.6, 0]);
    put(body, box(0.6, 0.6, 15.4), dark, [s * 3.1, 9.0, 0]);
    for (const z of [-6.2, 0, 6.2]) {
      put(body, box(0.85, 7.0, 0.85), wood, [s * 3.1, 6.0, z]);
      for (const y of [3.3, 8.6]) put(body, box(1.0, 0.25, 1.0), iron, [s * 3.1, y, z]);
      const w = new THREE.Group();
      w.position.set(s * 3.95, 1.85, z * 0.82);
      put(w, cyl(1.85, 1.85, 0.6, 24), M(0x8a6a44, "plank", { rep: [1, 1], bump: 1.5 }), [0, 0, 0], [0, 0, Math.PI / 2]);
      put(w, torus(1.85, 0.12, 28), iron, [0, 0, 0], [0, Math.PI / 2, 0]);
      put(w, cyl(0.5, 0.5, 0.9, 12), iron, [0, 0, 0], [0, 0, Math.PI / 2]);
      for (let i = 0; i < 6; i++) put(w, sphere(6), iron, [s * 0.32, Math.cos(i) * 1.3, Math.sin(i) * 1.3], undefined, 0.11);
      body.add(w);
    }
    for (const z of [-3.1, 3.1]) put(body, box(0.4, 0.4, 7.6), dark, [s * 3.15, 5.8, z], [z > 0 ? 0.72 : -0.72, 0, 0]);
  }
  for (const z of [-7.2, 7.2]) {
    put(body, box(6.8, 0.6, 0.6), dark, [0, 2.6, z]);
    put(body, box(6.8, 0.5, 0.5), dark, [0, 9.0, z]);
  }
  put(body, box(5.4, 0.55, 0.55), dark, [0, 6.0, -7.4]);
  const roofM = M(0x8a6a44, "plank", { rep: [3, 1], bump: 2 });
  for (const s of [-1, 1]) {
    put(body, box(4.6, 0.35, 16.4), roofM, [s * 2.05, 10.5, 0], [0, 0, -s * 0.62]);
    for (const z of [-5, 0, 5]) put(body, box(4.7, 0.12, 0.4), iron, [s * 2.05, 10.72, z], [0, 0, -s * 0.62]);
  }
  put(body, box(0.6, 0.6, 16.6), iron, [0, 11.9, 0]);
  for (let i = 0; i < 9; i++) put(body, G("ramSpike", () => new THREE.ConeGeometry(0.18, 0.9, 8)), mats.steel(), [0, 12.55, -7.2 + i * 1.8]);
  for (let i = 0; i < 16; i++) put(body, torus(0.32, 0.08, 10), iron, [1.5 - Math.abs(Math.sin(i * 0.4)) * 0.4, 11.0 - i * 0.02, -6.5 + i * 0.85], [0, 0, (i % 2) * Math.PI / 2 + 0.6]);

  const swing = joint(body, "ramSwing", [0, 9.0, 0]);
  put(swing, cyl(1.0, 1.1, 15, 16), M(0x6a4a2a, "grain", { rep: [2, 4], bump: 2 }), [0, -4.0, 0.8], [Math.PI / 2, 0, 0]);
  for (const z of [-5, -1, 3, 6.5]) put(swing, torus(1.08, 0.12, 20), iron, [0, -4.0, z]);
  put(swing, G("ramHead", () => lathe([[1.25, 0], [1.3, 0.6], [0.9, 1.6], [0.02, 3.2]], 8).rotateX(Math.PI / 2)), mats.steel(), [0, -4.0, 8.2]);
  for (let i = 0; i < 4; i++) put(swing, box(0.12, 1.1, 1.6), iron, [Math.cos(i * 1.57) * 1.15, -4.0 + Math.sin(i * 1.57) * 1.15, 8.6], [0, 0, i * 1.57]);
  for (const z of [-4, 5]) for (const x of [-0.6, 0.6]) put(swing, cyl(0.07, 0.07, 4.0, 5), M(0xc8b088, "linen"), [x, -2.0, z], [0, 0, x * 0.25]);
  put(body, G("ramBanner", () => new THREE.PlaneGeometry(3.4, 2.4, 6, 1)), mats.cloth(cloth(t), "linen", [2, 1], THREE.DoubleSide), [0, 8.6, 7.65]);
 joint(body, "barR", [-1.4, 6.0, -7.75]);
  joint(body, "barL", [1.4, 6.0, -7.75]);

  const figures: FigureDef[] = [];
  for (const [i, x] of [-1.9, 1.9].entries()) {
    const P = `c${i}.`;
    const h = human({
      prefix: P,
      hair: HAIR.brown,
      beard: i ? "full" : "moustache",
      coat: { color: cloth(t), hem: 2.2 },
      chest: mats.cloth(cloth(t), "wool", [5, 3]),
      under: { mat: mats.cloth(0xd8d0b8, "quilt", [8, 2]), hem: 2.7 },
      sleeves: { mat: mats.cloth(0xd8d0b8, "quilt", [2, 3]) },
      legs: { mat: mats.cloth(0x4a4238, "wool") },
      boots: mats.leather(0x3a2818),
    });
    nasalHelm(h.head, false);
    const sh = roundShield(cloth(t));
    sh.position.set(0, 1.9, -1.3);
    sh.rotation.y = Math.PI;
    h.spine.add(sh);
    h.root.position.set(x, 0, -10.0);
    root.add(h.root);
    figures.push({ P, style: "push" });
  }
  return finish(root, "rammer", figures);
}

/* ------------------------------------------------------------------ public API */

const BUILDERS: Record<string, (t: Team) => THREE.Group> = {
  levy,
  raider,
  soldier,
  brute,
  archer,
  ward,
  runner,
  rammer: buildRamModel,
  peon,
};

const protos = new Map<string, THREE.Group>();
function instance(kind: string, t: Team) {
  const key = `${kind}|${t}`;
  let p = protos.get(key);
  if (!p) protos.set(key, (p = BUILDERS[kind](t)));
  return p.clone(true);
}

export function buildUnitModel(kind: UnitKind, t: Team): THREE.Group {
  return instance(BUILDERS[kind] ? kind : "soldier", t);
}

export function buildPeonModel(t: Team): THREE.Group {
  return instance("peon", t);
}

/** Peon gear: which tool is in hand and what is being hauled home. */
export function setPeonGear(root: THREE.Object3D, tool: "axe" | "pick", load: "none" | "gold" | "wood") {
  const ctl = controller(root);
  if (!ctl.gear) return;
  ctl.gear.axe.visible = tool === "axe";
  ctl.gear.pick.visible = tool === "pick";
  ctl.gear.sack.visible = load === "gold";
  ctl.gear.logs.visible = load === "wood";
}

/* ------------------------------------------------------------------ animation */

interface FigureCtl {
  rig: Rig;
  style: Style;
  armR: ArmChain;
  armL: ArmChain;
  main?: THREE.Object3D;
  off?: THREE.Object3D;
  markR?: THREE.Object3D;
  markL?: THREE.Object3D;
  strTop?: THREE.Object3D;
  strBot?: THREE.Object3D;
}

interface Ctl {
  figs: FigureCtl[];
  cur: Pose;
  target: Pose;
  lastTimer: number;
  hitAt: number;
  cd: number;
  lx: number;
  ly: number;
  movedAt: number;
  started: boolean;
  horse?: { body: THREE.Object3D; neck: THREE.Object3D; head: THREE.Object3D; tail: THREE.Object3D; legs: [THREE.Object3D, THREE.Object3D, THREE.Object3D, boolean, number][] };
  swing?: THREE.Object3D;
  gear?: { axe: THREE.Object3D; pick: THREE.Object3D; sack: THREE.Object3D; logs: THREE.Object3D };
}

const ctls = new WeakMap<THREE.Object3D, Ctl>();
const POLE_R = new THREE.Vector3(-1, -1.2, -0.6);
const POLE_L = new THREE.Vector3(1, -1.2, -0.6);

function controller(root: THREE.Object3D): Ctl {
  let c = ctls.get(root);
  if (c) return c;
  const info = root.userData.unit as { kind: string; figures: FigureDef[] };
  const find = (n: string) => root.getObjectByName(n);
  const figs = info.figures.map((f): FigureCtl => {
    const rig = Object.fromEntries(JOINTS.map((j) => [j, find(f.P + j)!])) as Rig;
    rig.spine.rotation.order = "YXZ";
    rig.hips.rotation.order = "YXZ";
    const st = STYLES[f.style];
    const chain = (s: "R" | "L"): ArmChain => ({ shoulder: rig[`sh${s}`], elbow: rig[`el${s}`], wrist: rig[`wr${s}`], upper: UA, fore: FA, hand: HAND });
    const main = rig.spine.getObjectByName("main");
    const off = rig.spine.getObjectByName("off");
    return {
      rig,
      style: st,
      armR: chain("R"),
      armL: chain("L"),
      main,
      off,
      markR: st.right !== "item" ? find(st.right) : undefined,
      markL: st.left !== "item" && st.left !== "g2" ? find(st.left) : undefined,
      strTop: off?.getObjectByName("strTop"),
      strBot: off?.getObjectByName("strBot"),
    };
  });
  const st = figs[0].style;
  c = { figs, cur: st.carry.slice(), target: st.carry.slice(), lastTimer: -1, hitAt: -99, cd: 1.2, lx: 0, ly: 0, movedAt: -99, started: false };
  const hb = find("hBody");
  if (hb) {
    c.horse = {
      body: hb,
      neck: find("hNeck")!,
      head: find("hHead")!,
      tail: find("hTail")!,
      legs: (
        [
          ["hFL", false, 0.5],
          ["hFR", false, 0.62],
          ["hHL", true, 0],
          ["hHR", true, 0.12],
        ] as const
      ).map(([n, hind, ph]): [THREE.Object3D, THREE.Object3D, THREE.Object3D, boolean, number] => [find(n)!, find(n + "k")!, find(n + "f")!, hind, ph]),
    };
  }
  c.swing = find("ramSwing");
  const axeHead = find("axeHead");
  if (axeHead) c.gear = { axe: axeHead, pick: find("pickHead")!, sack: find("sack")!, logs: find("logs")! };
  ctls.set(root, c);
  return c;
}

const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
function blend(out: Pose, a: Pose, b: Pose, k: number) {
  for (let i = 0; i < POSE_LEN; i++) out[i] = a[i] + (b[i] - a[i]) * k;
}

export interface UnitAnimInput {
  /** Sim position, used to detect whether the unit is walking. */
  x: number;
  y: number;
  /** Attack cooldown timer from the sim: resets upward on each hit. */
  timer: number;
  /** Override the "is fighting" guess (peons use their defend state). */
  fighting?: boolean;
  /** Continuous tool swings (gathering / building). */
  work?: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Drives one unit for this frame. `now` should be sim time (seconds). */
export function animateUnit(root: THREE.Object3D, now: number, input: UnitAnimInput) {
  if (!root.userData.unit) return;
  const c = controller(root);
  const st = c.figs[0].style;
  if (!c.started || Math.abs(input.x - c.lx) + Math.abs(input.y - c.ly) > 0.02) {
    if (c.started) c.movedAt = now;
    c.lx = input.x;
    c.ly = input.y;
  }
  const moving = now - c.movedAt < 0.25;
  let timer = input.timer;
  let fighting = input.fighting ?? timer > -0.35;
  if (input.work) {
    const cycle = 1.15;
    timer = cycle - (now % cycle);
    fighting = true;
  }
  if (timer > c.lastTimer + 0.05) {
    c.hitAt = now;
    c.cd = Math.max(0.4, timer);
  }
  c.lastTimer = timer;

  const W = Math.min(st.windup, c.cd * 0.5), R = Math.min(st.recover, c.cd * 0.4), S = Math.min(0.12, W * 0.4);
  const since = now - c.hitAt;
  const tgt = c.target;
  if (!fighting || (moving && since > R)) tgt.set(st.carry);
  else if (since < R) blend(tgt, st.impact, st.guard, smooth(since / R));
  else if (timer <= -0.05) tgt.set(st.guard);
  else if (timer < S) blend(tgt, st.cocked, st.impact, clamp01(1 - timer / S) ** 2);
  else if (timer < W) blend(tgt, st.guard, st.cocked, smooth((W - timer) / (W - S)));
  else tgt.set(st.guard);

  const k = c.started ? (fighting ? 0.5 : 0.2) : 1;
  for (let i = 0; i < POSE_LEN; i++) c.cur[i] += (tgt[i] - c.cur[i]) * k;
  c.started = true;
  const p = c.cur;

  const gait = now * Math.PI * 2 * 1.5;
  root.updateMatrixWorld(true);
  if (c.horse) animateHorse(c, now, moving, p[I.act]);
  if (c.swing) c.swing.rotation.x = p[I.act] < 0 ? -p[I.act] * 0.55 : -p[I.act] * 0.3;

  for (const [fi, f] of c.figs.entries()) {
    const { rig, style: s } = f;
    rig.spine.rotation.set(p[I.sp] + (moving ? 0.04 : Math.sin(now * 1.7) * 0.015), p[I.sp + 1] + (moving ? Math.sin(gait + fi) * 0.06 : 0), p[I.sp + 2]);
    if (!s.seated) {
      let a0 = p[I.lg], k0 = p[I.lg + 1], a1 = p[I.lg + 2], k1 = p[I.lg + 3];
      rig.hips.rotation.set(p[I.hp], p[I.hp + 1], p[I.hp + 2]);
      if (moving) {
        const ph = gait + fi * 2.1;
        a0 = -0.48 * Math.sin(ph);
        a1 = 0.48 * Math.sin(ph);
        k0 = 0.12 + 0.95 * Math.max(0, Math.cos(ph)) ** 1.5;
        k1 = 0.12 + 0.95 * Math.max(0, -Math.cos(ph)) ** 1.5;
      }
      rig.thL.rotation.set(a0, 0, 0.04);
      rig.knL.rotation.x = k0;
      rig.thR.rotation.set(a1, 0, -0.04);
      rig.knR.rotation.x = k1;
      const reach = Math.max(THIGH * Math.cos(a0) + SHIN * Math.cos(a0 + k0), THIGH * Math.cos(a1) + SHIN * Math.cos(a1 + k1));
      rig.hips.position.y = HIP_Y - (THIGH + SHIN - reach);
    }
    if (f.main) {
      aim(f.main, p, I.m);
      f.main.visible = f.style.left !== "item" || f.style.leftAxis !== "y" || p[I.arrow] > 0.5;
    }
    if (f.off) aim(f.off, p, I.o);
    rig.spine.updateWorldMatrix(true, true);

    const axis = (o: THREE.Object3D, ax: "y" | "z" | "x" | undefined, out: THREE.Vector3) =>
      out.set(ax === "y" ? 0 : ax === "x" ? 1 : 0, ax === "y" ? 1 : 0, ax === "y" || ax === "x" ? 0 : 1).transformDirection(o.matrixWorld);

    if (f.main && s.right === "item") {
      f.main.getWorldPosition(_a);
      solveArm(f.armR, _a, axis(f.main, s.rightAxis, _b), s.poleR ? _c.set(...s.poleR) : POLE_R);
    } else if (f.markR) {
      f.markR.getWorldPosition(_a);
      solveArm(f.armR, _a, axis(f.markR, "x", _b), POLE_R);
    }
    if (s.left === "item" && f.off) {
      f.off.getWorldPosition(_a);
      solveArm(f.armL, _a, axis(f.off, s.leftAxis, _b), POLE_L);
    } else if (s.left === "g2" && f.main) {
      f.main.localToWorld(_a.set(0, 0, p[I.g2]));
      solveArm(f.armL, _a, axis(f.main, "z", _b), POLE_L);
    } else if (f.markL) {
      f.markL.getWorldPosition(_a);
      solveArm(f.armL, _a, axis(f.markL, "x", _b), POLE_L);
    }
    if (f.strTop && f.strBot && f.off && f.main) {
      const pull = Math.max(0, p[I.pull]) ** 2;
      _a.set(0, 0, BOW_BACK);
      f.main.getWorldPosition(_b);
      f.off.worldToLocal(_b);
      _a.lerp(_b, pull);
      for (const [seg, y] of [[f.strTop, BOW_TIP], [f.strBot, -BOW_TIP]] as const) {
        seg.position.set(0, y, BOW_BACK);
        _c.subVectors(_a, seg.position);
        seg.scale.set(1, _c.length(), 1);
        seg.quaternion.setFromUnitVectors(UP, _c.normalize());
      }
    }
  }
}

function animateHorse(c: Ctl, now: number, moving: boolean, act: number) {
  const h = c.horse!;
  const rear = Math.max(0, -act), lunge = Math.max(0, act);
  const ph = now * Math.PI * 2 * 2.1;
  const pitch = -rear * 0.42 + lunge * 0.08 + (moving ? Math.sin(ph * 2) * 0.035 : 0);
  h.body.rotation.x = pitch;
  h.body.position.y = 3.3 * Math.sin(Math.max(0, -pitch)) + (moving ? Math.abs(Math.sin(ph)) * 0.45 : 0);
  h.body.position.z = -3.3 * (1 - Math.cos(pitch));
  h.neck.rotation.x = 0.62 + (moving ? Math.sin(ph * 2 + 0.6) * 0.08 : Math.sin(now * 0.9) * 0.04) - rear * 0.35;
  h.head.rotation.x = 1.6 + (moving ? Math.sin(ph * 2 + 1.2) * 0.06 : 0) - rear * 0.3;
  h.tail.rotation.x = 0.35 + (moving ? 0.45 + Math.sin(ph * 2) * 0.1 : 0) + rear * 0.3;
  h.tail.rotation.z = Math.sin(now * (moving ? 6 : 1.3)) * (moving ? 0.12 : 0.1);
  for (const [up, kn, fet, hind, off] of h.legs) {
    const q = ph + off * Math.PI * 2;
    let a = 0, k = 0, f = 0;
    if (moving) {
      a = -Math.sin(q) * (hind ? 0.5 : 0.62) + (hind ? 0.08 : 0);
      const flex = Math.max(0, Math.cos(q));
      k = hind ? -flex * 0.9 : flex * 1.35;
      f = flex * (hind ? 0.7 : 0.5);
    }
    if (!hind && rear > 0) {
      a = a * (1 - rear) - 0.95 * rear;
      k = k * (1 - rear) + 1.7 * rear;
      f = f * (1 - rear) + 0.6 * rear;
    }
    if (hind) a -= pitch;
    up.rotation.x = a;
    kn.rotation.x = k;
    fet.rotation.x = f;
  }
}
