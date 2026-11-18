import {
  Engine, Scene, Vector3, Color3, Color4, HemisphericLight, DirectionalLight,
  ArcRotateCamera, MeshBuilder, StandardMaterial, TransformNode, Mesh,
} from '@babylonjs/core';

// Étudiant eUniversité en version « mini » : grosse tête, petit corps, toge noire,
// toque à gland orange, étole orange, baskets blanches. Formes rondes et contours épais.
const ORANGE = '#FFA000';
const CREAM = '#FFF0D5';
const INK = '#19150E';

const canvas = document.getElementById('c');
const engine = new Engine(canvas, true, { alpha: true, preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0, 0, 0, 0);

const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0.3), scene);
hemi.intensity = 0.72;
hemi.groundColor = new Color3(0.55, 0.4, 0.25);
const key = new DirectionalLight('key', new Vector3(-0.5, -0.9, 0.7), scene);
key.diffuse = new Color3(1, 0.95, 0.88);
key.intensity = 0.55;

let uid = 0;
function toon(hex, { emissive = 0.26, alpha = 1, specular = 0 } = {}) {
  const m = new StandardMaterial('toon-' + ++uid, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c;
  m.emissiveColor = c.scale(emissive);
  m.specularColor = new Color3(specular, specular, specular);
  m.specularPower = 40;
  m.alpha = alpha;
  return m;
}

function outline(mesh, width = 0.03, color = Color3.Black()) {
  mesh.renderOutline = true;
  mesh.outlineWidth = width;
  mesh.outlineColor = color;
}

const M = {
  skin: toon('#9a5b2e', { emissive: 0.3, specular: 0.15 }),
  skinDark: toon('#7d4620', { emissive: 0.28 }),
  hair: toon('#17110b', { emissive: 0.4 }),
  gown: toon('#1d2036', { emissive: 0.3 }),
  gownLight: toon('#2a2f4d', { emissive: 0.3 }),
  cap: toon('#1b1d33', { emissive: 0.3 }),
  orange: toon(ORANGE, { emissive: 0.3 }),
  white: toon('#fbf7ee', { emissive: 0.4 }),
  cream: toon(CREAM, { emissive: 0.4 }),
  eye: toon('#2b1608', { emissive: 0.5 }),
  mouth: toon('#4a1a12', { emissive: 0.4 }),
  blush: toon('#e0773a', { emissive: 0.5, alpha: 0.4 }),
  sole: toon('#e6dcc6', { emissive: 0.3 }),
  star: toon(ORANGE, { emissive: 1 }),
};

// --- Construction -------------------------------------------------------------
const root = new TransformNode('student', scene);
const body = new TransformNode('body', scene);      // tronc et toge, pivote à la taille
body.parent = root;
body.position.y = 0.2;
const headPivot = new TransformNode('head-pivot', scene);   // pivote au cou
headPivot.parent = body;
headPivot.position.y = 0.95;
headPivot.scaling.setAll(1.12);

function sphere(name, parent, d, pos, scale, material, line = 0) {
  const m = MeshBuilder.CreateSphere(name, { diameter: d, segments: 20 }, scene);
  m.parent = parent;
  m.position.set(...pos);
  m.scaling.set(...scale);
  m.material = material;
  if (line) outline(m, line);
  return m;
}

// Toge : cloche évasée + épaules arrondies
const gown = MeshBuilder.CreateCylinder('gown', { height: 0.78, diameterTop: 0.74, diameterBottom: 1.08, tessellation: 32 }, scene);
gown.parent = body;
gown.position.y = 0.61;
gown.material = M.gown;
outline(gown, 0.03);
sphere('shoulders', body, 1, [0, 0.93, 0], [0.88, 0.44, 0.64], M.gown, 0.03);

// Cou, col blanc, étole orange en V
const neck = MeshBuilder.CreateCylinder('neck', { height: 0.2, diameter: 0.26, tessellation: 16 }, scene);
neck.parent = body;
neck.position.y = 1.02;
neck.material = M.skinDark;
const collar = MeshBuilder.CreateTorus('collar', { diameter: 0.4, thickness: 0.08, tessellation: 24 }, scene);
collar.parent = body;
collar.position.y = 0.99;
collar.material = M.white;
outline(collar, 0.015);

for (const side of [-1, 1]) {
  const strip = MeshBuilder.CreateBox('stole-' + side, { width: 0.13, height: 0.66, depth: 0.04 }, scene);
  strip.parent = body;
  strip.position.set(side * 0.12, 0.6, 0.43);
  strip.rotation.z = side * 0.12;
  strip.rotation.x = -0.17;
  strip.material = M.orange;
  outline(strip, 0.012);
}

// Manches larges, mains, diplôme
function buildArm(side) {
  const pivot = new TransformNode('arm-' + side, scene);
  pivot.parent = body;
  pivot.position.set(side * 0.47, 0.96, 0);
  const sleeve = MeshBuilder.CreateCylinder('sleeve-' + side, { height: 0.62, diameterTop: 0.3, diameterBottom: 0.56, tessellation: 20 }, scene);
  sleeve.parent = pivot;
  sleeve.position.y = -0.3;
  sleeve.material = M.gownLight;
  outline(sleeve, 0.025);
  const hand = sphere('hand-' + side, pivot, 0.22, [0, -0.62, 0], [1, 1, 1], M.skin, 0.02);
  return { pivot, hand };
}
const armL = buildArm(-1);
const armR = buildArm(1);

// Parchemin dans la main droite
const diploma = new TransformNode('diploma', scene);
diploma.parent = armR.pivot;
diploma.position.set(0, -0.66, 0.1);
diploma.rotation.x = Math.PI / 2.4;
const scroll = MeshBuilder.CreateCylinder('scroll', { height: 0.5, diameter: 0.1, tessellation: 14 }, scene);
scroll.parent = diploma;
scroll.material = M.cream;
outline(scroll, 0.012);
const ribbon = MeshBuilder.CreateTorus('ribbon', { diameter: 0.115, thickness: 0.03, tessellation: 14 }, scene);
ribbon.parent = diploma;
ribbon.material = M.orange;

// Jambes courtes (pantalon sombre) et baskets blanches à semelle crème, liseré orange
function buildLeg(side) {
  const pivot = new TransformNode('leg-' + side, scene);
  pivot.parent = root;
  pivot.position.set(side * 0.22, 0.46, 0);
  const leg = MeshBuilder.CreateCapsule('leg-mesh-' + side, { height: 0.42, radius: 0.085 }, scene);
  leg.parent = pivot;
  leg.position.y = -0.2;
  leg.material = M.cap;
  outline(leg, 0.02);
  const shoe = new TransformNode('shoe-' + side, scene);
  shoe.parent = pivot;
  shoe.position.set(0, -0.36, 0.05);
  sphere('shoe-top-' + side, shoe, 0.3, [0, 0.03, 0.05], [0.95, 0.62, 1.4], M.white, 0.022);
  const sole = MeshBuilder.CreateBox('sole-' + side, { width: 0.3, height: 0.055, depth: 0.5 }, scene);
  sole.parent = shoe;
  sole.position.set(0, -0.05, 0.06);
  sole.material = M.sole;
  outline(sole, 0.014);
  const stripe = MeshBuilder.CreateBox('stripe-' + side, { width: 0.315, height: 0.045, depth: 0.16 }, scene);
  stripe.parent = shoe;
  stripe.position.set(0, 0.03, 0.0);
  stripe.material = M.orange;
  return pivot;
}
const legL = buildLeg(-1);
const legR = buildLeg(1);

// --- Tête ---------------------------------------------------------------------
const HEAD_R = 0.5;
const head = sphere('head', headPivot, 1, [0, 0.58, 0], [1.04, 0.95, 0.98], M.skin, 0.035);
const headC = new TransformNode('head-center', scene);
headC.parent = headPivot;
headC.position.y = 0.58;

// Position sur la face avant de la tête (x, y relatifs au centre), légèrement en avant
function face(x, y, off = 0) {
  const nx = x / (HEAD_R * 1.04);
  const ny = y / (HEAD_R * 0.95);
  const z = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * HEAD_R * 0.98;
  return [x, y, z + off];
}
function onFace(name, d, x, y, scale, material, off = 0, line = 0) {
  return sphere(name, headC, d, face(x, y, off), scale, material, line);
}

// Oreilles
for (const side of [-1, 1]) onFace('ear-' + side, 0.2, side * 0.51, -0.02, [0.55, 1, 0.8], M.skin, -0.2, 0.015);

// Yeux : grand blanc, iris brun, deux reflets
for (const side of [-1, 1]) {
  onFace('sclera-' + side, 0.23, side * 0.18, 0.04, [1, 1.22, 0.5], M.white, -0.01, 0.015);
  onFace('iris-' + side, 0.14, side * 0.18, 0.03, [1, 1.2, 0.5], M.eye, 0.035);
  onFace('shine-' + side, 0.05, side * 0.18 + 0.03, 0.09, [1, 1, 0.5], M.white, 0.07);
  onFace('shine2-' + side, 0.025, side * 0.18 - 0.03, -0.01, [1, 1, 0.5], M.white, 0.07);
}

// Sourcils joyeux
for (const side of [-1, 1]) {
  const brow = MeshBuilder.CreateCapsule('brow-' + side, { height: 0.22, radius: 0.028 }, scene);
  brow.parent = headC;
  const p = face(side * 0.19, 0.2, 0.045);
  brow.position.set(...p);
  brow.rotation.z = Math.PI / 2 - side * 0.2;
  brow.rotation.y = -side * 0.35;
  brow.material = M.hair;
}

// Nez, joues
onFace('nose', 0.12, 0, -0.07, [1.1, 0.8, 0.8], M.skinDark, 0.0);
for (const side of [-1, 1]) onFace('blush-' + side, 0.15, side * 0.3, -0.12, [1, 0.62, 0.3], M.blush, 0.0);

// Grand sourire en « D » : bouche sombre, rangée de dents, langue
function halfDisc(name, radius, x, y, material, off, scaleY = 1) {
  const d = MeshBuilder.CreateDisc(name, { radius, arc: 0.5, tessellation: 40 }, scene);
  d.parent = headC;
  const p = face(x, y, off);
  d.position.set(...p);
  d.rotation.z = Math.PI;             // moitié basse du disque : le bord plat en haut
  d.rotation.y = Math.PI;             // face tournée vers l'avant
  d.rotation.x = -0.12;
  d.scaling.y = scaleY;
  d.material = material;
  d.material.backFaceCulling = false;
  return d;
}
const mouthMat = toon('#4a1a12', { emissive: 0.4 });
const tongueMat = toon('#e0644f', { emissive: 0.4 });
halfDisc('mouth', 0.215, 0, -0.14, mouthMat, 0.005, 1.0);
halfDisc('tongue', 0.12, 0, -0.245, tongueMat, 0.02, 0.5);
halfDisc('teeth', 0.19, 0, -0.145, M.white, 0.03, 0.42);

// Cheveux courts, sous la toque
const hair = MeshBuilder.CreateSphere('hair', { diameter: 1.1, segments: 20, slice: 0.5 }, scene);
hair.parent = headC;
hair.position.set(0, 0.13, -0.1);
hair.rotation.x = -0.5;                // inclinée vers l'arrière : le front reste dégagé
hair.scaling.set(1.02, 0.84, 1);
hair.material = M.hair;
hair.material.backFaceCulling = false;

// Toque : calotte, planche carrée, bouton, gland orange
const capBase = MeshBuilder.CreateCylinder('cap-base', { height: 0.22, diameterTop: 0.9, diameterBottom: 0.98, tessellation: 24 }, scene);
capBase.parent = headC;
capBase.position.y = 0.45;
capBase.material = M.cap;
outline(capBase, 0.025);

const board = MeshBuilder.CreateBox('board', { width: 1.34, height: 0.08, depth: 1.34 }, scene);
board.parent = headC;
board.position.y = 0.6;
board.rotation.y = Math.PI / 4;
board.material = M.cap;
outline(board, 0.03);

const button = sphere('button', headC, 0.12, [0, 0.67, 0], [1, 0.8, 1], M.orange, 0.015);

const tassel = new TransformNode('tassel', scene);
tassel.parent = headC;
tassel.position.set(0, 0.64, 0);
const cord = MeshBuilder.CreateTube('cord', {
  path: [new Vector3(0, 0.03, 0), new Vector3(0.28, 0.035, 0.06), new Vector3(0.58, 0.02, 0.1), new Vector3(0.66, -0.04, 0.1)],
  radius: 0.022, tessellation: 8,
}, scene);
cord.parent = tassel;
cord.material = M.orange;
const tasselEnd = new TransformNode('tassel-end', scene);
tasselEnd.parent = tassel;
tasselEnd.position.set(0.66, -0.04, 0.1);
const knob = sphere('tassel-knob', tasselEnd, 0.1, [0, -0.04, 0], [1, 1, 1], M.orange, 0.012);
const fringe = MeshBuilder.CreateCylinder('fringe', { height: 0.3, diameterTop: 0.07, diameterBottom: 0.15, tessellation: 12 }, scene);
fringe.parent = tasselEnd;
fringe.position.y = -0.22;
fringe.material = M.orange;
outline(fringe, 0.012);

// Étoiles qui tournent au-dessus de la tête (pose « échec »)
const stars = new TransformNode('stars', scene);
stars.parent = headC;
stars.position.y = 0.95;
const starMeshes = [0, 1, 2].map((n) => {
  const s = MeshBuilder.CreatePolyhedron('star-' + n, { type: 1, size: 0.09 }, scene);
  s.parent = stars;
  s.material = M.star;
  return s;
});

// Socle et ombre
const pedestal = MeshBuilder.CreateCylinder('pedestal', { height: 0.14, diameter: 3.2, tessellation: 40 }, scene);
pedestal.position.y = -0.07;
pedestal.material = toon('#f3dcae', { emissive: 0.3 });
outline(pedestal, 0.03);
const ring = MeshBuilder.CreateTorus('ring', { diameter: 2.9, thickness: 0.07, tessellation: 48 }, scene);
ring.position.y = 0.005;
ring.material = M.orange;
const shadow = MeshBuilder.CreateDisc('shadow', { radius: 0.8, tessellation: 32 }, scene);
shadow.rotation.x = Math.PI / 2;
shadow.position.y = 0.012;
shadow.material = toon('#000000', { emissive: 0, alpha: 0.28 });

// --- Poses animées ------------------------------------------------------------
// Chaque pose donne des cibles ; les valeurs sont lissées à chaque image.
// Bras : x négatif = vers l'avant, z = écart sur le côté (0 = le long du corps, ~2,8 = bras levé).
// Jambes : x positif = pied vers l'arrière.
const S = {
  y: 0, lean: 0, roll: 0, headRoll: 0, headNod: 0, sy: 1,
  armLx: 0, armLz: 0, armRx: 0, armRz: 0, legL: 0, legR: 0, sway: 0, stars: 0,
};

function target(pose, t) {
  const T = {
    y: 0, lean: 0, roll: 0, headRoll: Math.sin(t * 1.4) * 0.05, headNod: 0, sy: 1,
    armLx: 0, armLz: 0.25, armRx: 0, armRz: 0.25, legL: 0, legR: 0, sway: 0, stars: 0,
  };
  switch (pose) {
    case 'idle':
      T.y = Math.sin(t * 2) * 0.025;
      T.sy = 1 + Math.sin(t * 2) * 0.012;
      T.armRx = -0.65;                                  // tient le diplôme devant lui
      T.armRz = 0.12;
      break;
    case 'run': {
      const f = 11;
      const s = Math.sin(t * f);
      T.y = Math.abs(s) * 0.12;
      T.lean = 0.2;
      T.roll = Math.cos(t * f) * 0.05;
      T.headRoll = Math.cos(t * f) * 0.06;
      T.armLx = -s * 1.0;
      T.armRx = s * 1.0 - 0.25;
      T.armLz = 0.22;
      T.armRz = 0.22;
      T.legL = s * 0.9;
      T.legR = -s * 0.9;
      T.sway = s * 0.05;
      T.sy = 1 + Math.cos(t * f * 2) * 0.025;
      break;
    }
    case 'jump':
      T.y = 0.55;
      T.lean = 0.05;
      T.sy = 1.08;
      T.armLz = 2.55; T.armRz = 2.55;                   // les deux bras levés
      T.armLx = -0.15; T.armRx = -0.15;
      T.legL = -0.75; T.legR = 0.25;                    // genoux remontés
      T.headNod = -0.12;
      break;
    case 'slide':
      T.y = -0.1;
      T.lean = 0.7;
      T.sy = 0.88;
      T.armLx = -1.4; T.armRx = -1.4; T.armLz = 0.35; T.armRz = 0.35;   // plongeon, bras devant
      T.legL = 0.9; T.legR = 0.9;
      T.headNod = -0.35;
      break;
    case 'victory':
      T.y = Math.abs(Math.sin(t * 5)) * 0.3;
      T.sy = 1 + Math.sin(t * 10) * 0.03;
      T.armRz = 2.85; T.armRx = -0.25;                  // pouce en l'air
      T.armLz = 1.15 + Math.sin(t * 5) * 0.25; T.armLx = -0.1;
      T.headRoll = Math.sin(t * 3) * 0.1;
      T.legL = -0.15; T.legR = 0.15;
      break;
    case 'fail':
      T.y = -0.03;
      T.lean = -0.06;
      T.sy = 0.96;
      T.headRoll = Math.sin(t * 9) * 0.28;
      T.headNod = 0.22;
      T.armLz = 0.18; T.armRz = 0.18; T.armLx = 0.25; T.armRx = 0.25;
      T.roll = Math.sin(t * 9) * 0.06;
      T.stars = 1;
      break;
    default:
  }
  return T;
}

let pose = 'idle';
const lerp = (a, b, k) => a + (b - a) * k;

scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  const t = performance.now() / 1000;
  const T = target(pose, t);
  const k = Math.min(1, dt * 12);
  for (const name of Object.keys(T)) S[name] = lerp(S[name], T[name], name === 'stars' ? Math.min(1, dt * 8) : k);

  root.position.y = S.y;
  const wide = 1 + (1 - S.sy) * 0.5;      // écrasement-étirement : plus bas = plus large
  root.scaling.set(wide, S.sy, wide);
  body.rotation.x = S.lean;
  body.rotation.z = S.roll;
  headPivot.rotation.z = S.headRoll;
  headPivot.rotation.x = S.headNod;
  armL.pivot.rotation.x = S.armLx;
  armR.pivot.rotation.x = S.armRx;
  armL.pivot.rotation.z = -S.armLz;       // vers l'extérieur : gauche négatif, droite positif
  armR.pivot.rotation.z = S.armRz;
  legL.rotation.x = S.legL;
  legR.rotation.x = S.legR;
  gown.rotation.z = S.sway;
  tassel.rotation.z = Math.sin(t * 3) * 0.1 + S.sway;
  tasselEnd.rotation.z = Math.sin(t * 4 + 1) * 0.22;
  stars.setEnabled(S.stars > 0.05);
  stars.rotation.y = t * 4;
  starMeshes.forEach((st, n) => {
    const a2 = (n / 3) * Math.PI * 2;
    st.position.set(Math.cos(a2) * 0.5, Math.sin(t * 6 + a2) * 0.05, Math.sin(a2) * 0.5);
    st.rotation.y = t * 5;
  });
  shadow.scaling.setAll(Math.max(0.55, 1 - S.y * 0.5));
});

// --- Caméra et commandes ------------------------------------------------------
const camera = new ArcRotateCamera('cam', Math.PI / 2 - 0.5, 1.3, 5.6, new Vector3(0, 1.35, 0), scene);
camera.lowerRadiusLimit = 3.5;
camera.upperRadiusLimit = 12;
camera.attachControl(canvas, true);
camera.wheelPrecision = 60;

let spin = true;
const spinBtn = document.getElementById('spin');
spinBtn.addEventListener('click', () => {
  spin = !spin;
  spinBtn.textContent = `Tourner : ${spin ? 'oui' : 'non'}`;
});
scene.onBeforeRenderObservable.add(() => { if (spin) camera.alpha += 0.004; });

document.getElementById('back').addEventListener('click', () => {
  spin = false;
  spinBtn.textContent = 'Tourner : non';
  camera.alpha = -Math.PI / 2;
  camera.beta = 1.2;
  camera.radius = 9;
});

const buttons = [...document.querySelectorAll('button[data-pose]')];
for (const b of buttons) {
  b.addEventListener('click', () => {
    pose = b.dataset.pose;
    buttons.forEach((x) => x.classList.toggle('on', x === b));
  });
}

// Accès pour les captures automatiques
window.__lab = { setPose: (p) => { pose = p; }, camera, setSpin: (v) => { spin = v; } };

window.addEventListener('resize', () => engine.resize());
engine.runRenderLoop(() => scene.render());
