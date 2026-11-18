import {
  Engine, Scene, Vector3, Color3, Color4, HemisphericLight, DirectionalLight,
  ArcRotateCamera, MeshBuilder, StandardMaterial, DynamicTexture, Texture, TransformNode, Mesh,
} from '@babylonjs/core';
import { MISSIONS, QUESTIONS } from './lessons.js';

// --- Charte eUniversité Study (d'après le Pitch Board) ------------------------
const ORANGE = '#FFA000';
const CREAM = '#FFF0D5';
const INK = '#19150E';

// --- Réglages -----------------------------------------------------------------
const LIVES = 3;
const LANES = [-3, 0, 3];
const LANE_NAMES = ['voie gauche', 'voie centrale', 'voie droite'];
const LANE_LETTERS = ['A', 'B', 'C'];

const BASE_SPEED = 7;
const MAX_SPEED = 10;
const ZONE_SPEED = 0.7;                // ralentissement doux en Zone Savoir, pour laisser lire
const JUMP_V = 8.5;
const GRAVITY = 24;
const CAM_LOOK_Y = 1.5;
const READY_TIME = 1.8;

const zoneStart = (i) => 140 + i * 150;
const ZONE_LEN = 50;
const gateZ = (i) => zoneStart(i) + ZONE_LEN;
const QUESTION_LEAD = 25;
const FINISH_Z = gateZ(QUESTIONS.length - 1) + 40;

const COIN_XP = 10;
const CRASH_XP = 20;

// --- État ---------------------------------------------------------------------
const state = {
  phase: 'loading',                    // loading · ready · run · over · finished
  lives: LIVES,
  xp: 0,
  coins: 0,
  streak: 0,
  bestStreak: 0,
  current: 0,
  lane: 1,
  speed: BASE_SPEED,
  zoneFactor: 1,
  elapsed: 0,
  readyUntil: 0,
  vy: 0,
  jumpY: 0,
  landUntil: 0,
  slideUntil: 0,
  boostUntil: 0,
  shakeUntil: 0,
  dizzyUntil: 0,
  slowUntil: 0,
  invulnUntil: 0,
  results: QUESTIONS.map(() => ({ status: 'pending', xp: 0 })),
  paused: false,
};

// --- DOM ----------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const hud = { title: $('mission-title'), lives: $('lives'), stats: $('stats') };
const panel = { root: $('question'), meta: $('q-meta'), text: $('q-text'), options: $('q-options') };
const progress = { fill: $('progress-fill'), root: $('progress'), ticks: [] };
const banner = $('banner');
const flashEl = $('flash');
const pauseEl = $('pause');
const bilan = { root: $('bilan'), title: $('bilan-title'), score: $('bilan-score'), list: $('bilan-list'), restart: $('bilan-restart') };
let bannerTimer = 0;
let shownQuestion = -1;

// --- Moteur et scène ----------------------------------------------------------
const canvas = $('scene');
const mobile = matchMedia('(pointer: coarse)').matches;
const engine = new Engine(canvas, !mobile, { adaptToDeviceRatio: false });
if (mobile) engine.setHardwareScalingLevel(1.5);   // plus léger sur les smartphones modestes
const scene = new Scene(engine);
const NIGHT = Color3.FromHexString(INK);
scene.clearColor = new Color4(NIGHT.r, NIGHT.g, NIGHT.b, 1);
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogStart = 70;
scene.fogEnd = 240;
scene.fogColor = NIGHT;

const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0.3), scene);
hemi.intensity = 0.6;
hemi.groundColor = new Color3(0.3, 0.24, 0.16);
const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.6), scene);
sun.diffuse = new Color3(1, 0.9, 0.75);
sun.intensity = 0.3;

let uid = 0;
// Matériau uni « à plat » : une couleur, un peu d'auto-éclairage, pas de reflet
function flat(hex, { emissive = 0.2, alpha = 1 } = {}) {
  const m = new StandardMaterial('flat-' + ++uid, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c;
  m.emissiveColor = c.scale(emissive);
  m.specularColor = Color3.Black();
  m.alpha = alpha;
  return m;
}

function outline(mesh, width = 0.04) {
  mesh.renderOutline = true;
  mesh.outlineWidth = width;
  mesh.outlineColor = Color3.Black();
}

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? line + ' ' + word : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function textMaterial(draw, width, height, { alpha = false } = {}) {
  const tex = new DynamicTexture('tex-' + ++uid, { width, height }, scene, true);
  const ctx = tex.getContext();
  draw(ctx, width, height);
  tex.update();
  if (alpha) tex.hasAlpha = true;
  const m = new StandardMaterial('tex-mat-' + uid, scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.specularColor = Color3.Black();
  m.backFaceCulling = false;
  if (alpha) m.useAlphaFromDiffuseTexture = true;
  return m;
}

// Face d'une porte : fond orange, grande lettre, réponse
function doorFaceMaterial(letter, text) {
  return textMaterial((ctx, w, h) => {
    ctx.fillStyle = ORANGE;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 230px system-ui, sans-serif';
    ctx.fillText(letter, w / 2, h * 0.22);
    ctx.font = '700 58px system-ui, sans-serif';
    const lines = wrapLines(ctx, text, w - 70);
    const lineH = 70;
    const top = h * 0.55 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, n) => ctx.fillText(l, w / 2, top + n * lineH));
  }, 512, 760);
}

function bannerMaterial(text) {
  return textMaterial((ctx, w, h) => {
    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 84px system-ui, sans-serif';
    ctx.fillText(text, w / 2, h / 2 + 4);
  }, 1024, 140);
}

// --- Piste : sol sombre, lignes de voies en tirets orange ---------------------
const TRACK_LEN = FINISH_Z + 160;
const TRACK_MID = TRACK_LEN / 2 - 40;
const TRACK_W = 10.5;

function trackMaterial() {
  const w = 512;
  const h = 256;
  const tex = new DynamicTexture('track', { width: w, height: h }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = '#241c12';
  ctx.fillRect(0, 0, w, h);
  // 4 lignes en tirets : bords et séparateurs de voies (x = -4.5, -1.5, 1.5, 4.5 sur 10,5 m)
  ctx.fillStyle = ORANGE;
  for (const x of [-4.5, -1.5, 1.5, 4.5]) {
    const px = ((x + TRACK_W / 2) / TRACK_W) * w;
    for (let y = 0; y < h; y += 64) ctx.fillRect(px - 5, y, 10, 36);
  }
  tex.update(true);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.vScale = TRACK_LEN / 4;           // un motif de tirets tous les 4 m
  const m = new StandardMaterial('track-mat', scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.emissiveColor = new Color3(0.25, 0.25, 0.25);
  m.specularColor = Color3.Black();
  return m;
}

const road = MeshBuilder.CreateGround('road', { width: TRACK_W, height: TRACK_LEN }, scene);
road.position.set(0, 0.02, TRACK_MID);
road.material = trackMaterial();

const verge = MeshBuilder.CreateGround('verge', { width: 260, height: TRACK_LEN }, scene);
verge.position.set(0, 0, TRACK_MID);
verge.material = flat('#1f1810', { emissive: 0.3 });

// --- Décor : soleil, collines, feuilles de cours flottantes ------------------
const space = new TransformNode('space', scene);   // suit le joueur : l'horizon reste à distance

// Soleil orange avec halo doux
const sunTex = textMaterial((ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  const halo = ctx.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w / 2);
  halo.addColorStop(0, 'rgba(255,160,0,0.45)');
  halo.addColorStop(1, 'rgba(255,160,0,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = ORANGE;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.17, 0, Math.PI * 2);
  ctx.fill();
}, 512, 512, { alpha: true });
sunTex.disableLighting = true;
sunTex.fogEnabled = false;
const sunPlane = MeshBuilder.CreatePlane('sun', { size: 70 }, scene);
sunPlane.parent = space;
sunPlane.position.set(22, 4, 200);
sunPlane.material = sunTex;

// Collines arrondies en silhouette, comme dans l'illustration 2D
const hillMats = ['#2d2417', '#3a2e1c', '#261e13'].map((c) => flat(c, { emissive: 0.5 }));
[[-70, 190, 130, 40], [10, 215, 160, 52], [80, 185, 120, 36], [-20, 170, 90, 24]].forEach(([x, z, w, h], n) => {
  const hill = MeshBuilder.CreateSphere('hill-' + n, { diameter: 1, segments: 12 }, scene);
  hill.parent = space;
  hill.scaling.set(w, h, 36);
  hill.position.set(x, -h * 0.3, z);
  hill.material = hillMats[n % hillMats.length];
  hill.material.fogEnabled = false;
});

// Feuilles de cours qui flottent de chaque côté (écho à la diapo « Le problème »)
function pageMaterial(tag) {
  return textMaterial((ctx, w, h) => {
    ctx.fillStyle = '#f4eee0';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#d7cdb8';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = '#c9bfa8';
    for (let y = 60; y < h - 90; y += 34) ctx.fillRect(34, y, w - 68 - ((y / 34) % 3) * 40, 12);
    ctx.fillStyle = tag;
    ctx.beginPath();
    ctx.roundRect(w - 120, h - 70, 90, 38, 10);
    ctx.fill();
  }, 256, 340);
}
const pageMats = ['#d9534f', '#3b82c4', ORANGE].map(pageMaterial);
const pages = [];
for (let n = 0; n < 34; n++) {
  const page = MeshBuilder.CreatePlane('page-' + n, { width: 1.6, height: 2.1 }, scene);
  page.material = pageMats[n % pageMats.length];
  const side = n % 2 === 0 ? -1 : 1;
  page.position.set(side * (7 + Math.random() * 14), 1.5 + Math.random() * 8, -10 + Math.random() * 170);
  page.rotation.set(Math.random() * 0.8 - 0.4, Math.random() * 6, Math.random() * 0.8 - 0.4);
  page.metadata = { baseY: page.position.y, phase: Math.random() * 6, spin: 0.2 + Math.random() * 0.4 };
  pages.push(page);
}

// Petits points orange en suspension
const dotMat = flat(ORANGE, { emissive: 1 });
const dots = [];
for (let n = 0; n < 40; n++) {
  const dot = MeshBuilder.CreateSphere('dot-' + n, { diameter: 0.18 + Math.random() * 0.2, segments: 6 }, scene);
  dot.material = dotMat;
  dot.position.set((Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 20), 0.5 + Math.random() * 9, -10 + Math.random() * 170);
  dots.push(dot);
}

// --- Éléments de gameplay (formes simples, style à plat) ----------------------
const baseOffscreen = (mesh) => { mesh.position.y = -100; return mesh; };
const creamMat = flat(CREAM, { emissive: 0.3 });
const orangeMat = flat(ORANGE, { emissive: 0.25 });
const inkMat = flat('#4a3a24', { emissive: 0.3 });

const bases = {
  slab: baseOffscreen(MeshBuilder.CreateBox('b-slab', { width: 2.2, height: 2.4, depth: 0.9 }, scene)),
  stripe: baseOffscreen(MeshBuilder.CreateBox('b-stripe', { width: 2.24, height: 0.34, depth: 0.94 }, scene)),
  stub: baseOffscreen(MeshBuilder.CreateBox('b-stub', { width: 2.2, height: 0.8, depth: 0.8 }, scene)),
  bar: baseOffscreen(MeshBuilder.CreateBox('b-bar', { width: 2.8, height: 0.32, depth: 0.45 }, scene)),
  post: baseOffscreen(MeshBuilder.CreateBox('b-post', { width: 0.22, height: 1.9, depth: 0.3 }, scene)),
  coin: baseOffscreen(MeshBuilder.CreateCylinder('b-coin', { diameter: 0.62, height: 0.1, tessellation: 20 }, scene)),
  doorPost: baseOffscreen(MeshBuilder.CreateBox('b-door-post', { width: 0.26, height: 3.7, depth: 0.4 }, scene)),
  doorBeam: baseOffscreen(MeshBuilder.CreateBox('b-door-beam', { width: 2.9, height: 0.28, depth: 0.4 }, scene)),
  doorSlab: baseOffscreen(MeshBuilder.CreateBox('b-door-slab', { width: 2.3, height: 3.4, depth: 0.28 }, scene)),
};
bases.slab.material = creamMat;
bases.stripe.material = orangeMat;
bases.stub.material = orangeMat;
bases.bar.material = creamMat;
bases.post.material = inkMat;
bases.coin.material = orangeMat;
bases.doorPost.material = creamMat;
bases.doorBeam.material = creamMat;
bases.doorSlab.material = orangeMat;
for (const key of ['slab', 'stub', 'bar', 'coin']) outline(bases[key], 0.03);

function inst(parent, key, x, y, z, rot = {}) {
  const m = bases[key].createInstance(`${key}-${++uid}`);
  m.parent = parent;
  m.position.set(x, y, z);
  if (rot.x) m.rotation.x = rot.x;
  return m;
}

// --- Zones Savoir : arche d'entrée, puis trois portes (une par voie) ----------
function pickOptions(q) {
  const wrong = q.choices.map((_, k) => k).filter((k) => k !== q.answer)
    .sort(() => Math.random() - 0.5).slice(0, 2);
  return [q.answer, ...wrong].sort(() => Math.random() - 0.5);   // picks[voie] = index de la réponse
}

const gates = [];
function buildGates() {
  QUESTIONS.forEach((q, i) => {
    const start = zoneStart(i);
    const z = gateZ(i);
    const picks = pickOptions(q);
    const root = new TransformNode('gate-' + i, scene);

    const zoneFloor = MeshBuilder.CreateGround('zone-floor-' + i, { width: TRACK_W, height: ZONE_LEN }, scene);
    zoneFloor.position.set(0, 0.04, (start + z) / 2);
    zoneFloor.material = flat(ORANGE, { emissive: 0.8, alpha: 0.14 });

    // Arche d'entrée de zone
    for (const x of [-5.2, 5.2]) inst(root, 'doorPost', x, 1.85, start);
    inst(root, 'doorBeam', 0, 3.7, start).scaling.x = 3.6;
    const sign = MeshBuilder.CreatePlane('arch-' + i, { width: 9, height: 1.2 }, scene);
    sign.parent = root;
    sign.position.set(0, 4.5, start);
    sign.material = bannerMaterial(`ZONE SAVOIR · ${i + 1}/${QUESTIONS.length}`);

    // Trois portes : cadre crème, panneau orange coulissant
    const doors = LANES.map((x, lane) => {
      inst(root, 'doorPost', x - 1.28, 1.85, z);
      inst(root, 'doorPost', x + 1.28, 1.85, z);
      inst(root, 'doorBeam', x, 3.7, z);
      const slab = inst(root, 'doorSlab', x, 1.72, z);
      const face = MeshBuilder.CreatePlane(`face-${i}-${lane}`, { width: 2.3, height: 3.4 }, scene);
      face.parent = slab;
      face.position.set(0, 0, -0.15);
      face.material = doorFaceMaterial(LANE_LETTERS[lane], q.choices[picks[lane]]);
      return { slab, baseY: 1.72, status: 'closed' };
    });

    gates.push({ start, z, picks, correctLane: picks.indexOf(q.answer), doors });
  });
}

// --- Obstacles et pièces ------------------------------------------------------
// Bloc blanc = changer de voie · plot orange = sauter · barre = glisser dessous.
const hazards = [];
const coins = [];
const shuffled = () => [0, 1, 2].sort(() => Math.random() - 0.5);

function addHazard(type, lane, z) {
  const holder = new TransformNode(`hazard-${type}-${++uid}`, scene);
  holder.position.set(LANES[lane], 0, z);
  if (type === 'block') {
    inst(holder, 'slab', 0, 1.2, 0);
    inst(holder, 'stripe', 0, 1.2, 0);
  } else if (type === 'low') {
    inst(holder, 'stub', 0, 0.4, 0);
  } else {
    inst(holder, 'post', -1.2, 0.95, 0);
    inst(holder, 'post', 1.2, 0.95, 0);
    inst(holder, 'bar', 0, 1.5, 0);
  }
  hazards.push({ holder, type, x: LANES[lane], z, hit: false });
}

function addCoin(lane, z, y = 1) {
  const mesh = bases.coin.createInstance('coin-' + ++uid);
  mesh.position.set(LANES[lane], y, z);
  mesh.rotation.x = Math.PI / 2;
  coins.push({ mesh, x: LANES[lane], y, z, taken: false });
}

const coinLine = (lane, z) => { for (let n = 0; n < 4; n++) addCoin(lane, z + n * 2); };
const coinArc = (lane, z) => { for (let n = 0; n < 5; n++) addCoin(lane, z - 4 + n * 2, 1 + Math.sin((n / 4) * Math.PI) * 1.2); };

function addRow(z) {
  const [a, b, c] = shuffled();
  const roll = Math.random();
  if (roll < 0.35) {
    addHazard('block', a, z);
    coinLine(b, z - 3);
  } else if (roll < 0.6) {
    addHazard('low', a, z);
    if (Math.random() < 0.5) addHazard('low', b, z);
    coinArc(a, z);
    coinLine(c, z - 3);
  } else if (roll < 0.8) {
    addHazard('high', a, z);
    if (Math.random() < 0.5) addHazard('high', b, z);
    coinLine(c, z - 3);
  } else {
    addHazard('block', a, z);
    addHazard('block', b, z);
    coinLine(c, z - 3);
  }
}

function buildCourse() {
  QUESTIONS.forEach((_, i) => {
    const from = i === 0 ? 40 : gateZ(i - 1) + 25;
    const to = zoneStart(i) - QUESTION_LEAD - 12;
    for (let z = from; z <= to; z += 13 + Math.random() * 4) addRow(z);
  });
}

// --- La mascotte eUniversité en 3D --------------------------------------------
// Tête ronde blanche à contour noir, calotte noire, corps orange en œuf, sac à dos, jambes fines.
const player = new TransformNode('player', scene);
const visual = new TransformNode('visual', scene);
visual.parent = player;

function buildMascot() {
  const root = new TransformNode('mascot', scene);
  root.parent = visual;

  const skin = flat('#F7F2E8', { emissive: 0.3 });
  const orange = flat(ORANGE, { emissive: 0.22 });
  const pack = flat('#8a5200', { emissive: 0.25 });
  const dark = flat(INK, { emissive: 0.5 });
  const brown = flat('#7a4b00', { emissive: 0.3 });
  const arm = flat('#D98800', { emissive: 0.25 });

  const torso = MeshBuilder.CreateSphere('torso', { diameter: 1, segments: 14 }, scene);
  torso.parent = root;
  torso.scaling.set(0.62, 0.74, 0.56);
  torso.position.y = 0.98;
  torso.material = orange;
  outline(torso, 0.035);

  const backpack = MeshBuilder.CreateSphere('backpack', { diameter: 1, segments: 12 }, scene);
  backpack.parent = root;
  backpack.scaling.set(0.52, 0.58, 0.3);
  backpack.position.set(0, 1.02, -0.36);
  backpack.material = pack;
  outline(backpack, 0.03);

  const head = MeshBuilder.CreateSphere('head', { diameter: 0.74, segments: 16 }, scene);
  head.parent = root;
  head.position.y = 1.6;
  head.material = skin;
  outline(head, 0.04);

  const hair = MeshBuilder.CreateSphere('hair', { diameter: 0.78, segments: 16, slice: 0.42 }, scene);
  hair.parent = root;
  hair.position.y = 1.62;
  hair.scaling.setAll(1.12);             // dépasse un peu de la tête pour la recouvrir
  hair.material = flat(INK, { emissive: 0.5 });
  hair.material.backFaceCulling = false;   // la calotte est une demi-sphère ouverte
  hair.sideOrientation = Mesh.DOUBLESIDE;

  const eye = MeshBuilder.CreateSphere('eye', { diameter: 0.1, segments: 8 }, scene);
  eye.parent = root;
  eye.position.set(0.15, 1.63, 0.33);
  eye.material = dark;

  const limb = (name, x, y, len, rad, material) => {
    const pivot = new TransformNode(name + '-pivot', scene);
    pivot.parent = root;
    pivot.position.set(x, y, 0);
    const mesh = MeshBuilder.CreateCapsule(name, { height: len, radius: rad }, scene);
    mesh.parent = pivot;
    mesh.position.y = -len / 2 + rad;
    mesh.material = material;
    return pivot;
  };
  const legL = limb('leg-l', -0.13, 0.66, 0.68, 0.075, brown);
  const legR = limb('leg-r', 0.13, 0.66, 0.68, 0.075, dark);
  const armL = limb('arm-l', -0.37, 1.2, 0.52, 0.065, arm);
  const armR = limb('arm-r', 0.37, 1.2, 0.52, 0.065, arm);

  // Ombre ronde sous les pieds
  const shadow = MeshBuilder.CreateDisc('shadow', { radius: 0.55, tessellation: 20 }, scene);
  shadow.parent = player;
  shadow.rotation.x = Math.PI / 2;
  shadow.position.y = 0.05;
  shadow.material = flat('#000000', { emissive: 0, alpha: 0.5 });

  return { root, torso, backpack, head, hair, eye, legL, legR, armL, armR, shadow };
}

const mascot = buildMascot();
const mascotParts = [mascot.torso, mascot.backpack, mascot.head, mascot.hair, mascot.eye];
const rest = new Map(mascotParts.map((m) => [m, m.position.y]));

const ease = (cur, target, k) => cur + (target - cur) * k;

// Animation procédurale « jouet » : balancement, rebonds, écrasement-étirement
function animateMascot(dt, mode, side) {
  const k = Math.min(1, dt * 14);
  const t = state.elapsed;
  let swing = 0;
  let lift = 0;
  let armsUp = 0;
  let legsTuck = 0;
  let sx = 1;
  let sy = 1;

  if (mode === 'run') {
    const f = 8 + state.speed * 0.7;
    swing = Math.sin(t * f) * 0.95;
    lift = Math.abs(Math.sin(t * f)) * 0.08;
    sy = 1 + Math.sin(t * f * 2) * 0.03;
    sx = 2 - sy;
  } else if (mode === 'idle') {
    lift = Math.sin(t * 3) * 0.03;
  } else if (mode === 'jump') {
    legsTuck = 1;
    armsUp = 0.7;
    sy = 1.12;
    sx = 0.92;
  } else if (mode === 'slide') {
    legsTuck = 1;                      // jambes repliées
    sy = 0.78;
    sx = 1.08;
  } else if (mode === 'cheer') {
    lift = Math.abs(Math.sin(t * 7)) * 0.3;
    armsUp = 1;
  } else if (mode === 'dizzy') {
    swing = Math.sin(t * 30) * 0.5;
  }
  if (t < state.landUntil) { sy = 0.82; sx = 1.14; }

  const m = mascot;
  m.legL.rotation.x = ease(m.legL.rotation.x, legsTuck ? -1.1 : swing, k);
  m.legR.rotation.x = ease(m.legR.rotation.x, legsTuck ? 0.5 : -swing, k);
  m.armL.rotation.x = ease(m.armL.rotation.x, armsUp ? -2.4 + Math.sin(t * 9) * 0.3 * (mode === 'cheer') : -swing * 0.9, k);
  m.armR.rotation.x = ease(m.armR.rotation.x, armsUp ? -2.4 - Math.sin(t * 9) * 0.3 * (mode === 'cheer') : swing * 0.9, k);
  m.armL.rotation.z = ease(m.armL.rotation.z, armsUp ? -0.35 : 0, k);
  m.armR.rotation.z = ease(m.armR.rotation.z, armsUp ? 0.35 : 0, k);
  for (const part of mascotParts) part.position.y = rest.get(part) + lift;
  m.root.scaling.set(ease(m.root.scaling.x, sx, k), ease(m.root.scaling.y, sy, k), ease(m.root.scaling.z, sx, k));
  m.shadow.scaling.setAll(Math.max(0.45, 1 - player.position.y * 0.35));
  m.shadow.position.y = 0.05 - player.position.y;
}

// --- Caméra -------------------------------------------------------------------
const camTarget = new TransformNode('cam-target', scene);
const camera = new ArcRotateCamera('cam', -Math.PI / 2, 1.2, 9.5, new Vector3(0, 1.2, 0), scene);
camera.lockedTarget = camTarget;
camera.lowerRadiusLimit = 9.5;
camera.upperRadiusLimit = 9.5;
camera.fov = 0.9;
camera.inputs.clear();

// --- Commandes ----------------------------------------------------------------
function act(action) {
  if (state.phase !== 'run' || state.paused) return;
  const grounded = state.jumpY <= 0.001;
  if (action === 'left') state.lane = Math.max(0, state.lane - 1);
  else if (action === 'right') state.lane = Math.min(2, state.lane + 1);
  else if (action === 'jump' && grounded) {
    state.vy = JUMP_V;
    state.slideUntil = 0;
  } else if (action === 'slide') {
    if (grounded) state.slideUntil = state.elapsed + 0.8;
    else state.vy = -14;               // en l'air : plongeon
  }
}

const KEY_ACTIONS = {
  arrowleft: 'left', q: 'left', a: 'left',
  arrowright: 'right', d: 'right',
  arrowup: 'jump', z: 'jump', w: 'jump', ' ': 'jump',
  arrowdown: 'slide', s: 'slide',
};

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'p' || key === 'escape') {
    if (!e.repeat) togglePause();
    return;
  }
  const action = KEY_ACTIONS[key];
  if (!action) return;
  e.preventDefault();
  if (!e.repeat) act(action);
});

let swipe = null;
canvas.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;
  swipe = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) act('jump');
  else if (Math.abs(dx) > Math.abs(dy)) act(dx < 0 ? 'left' : 'right');
  else act(dy < 0 ? 'jump' : 'slide');
});
window.addEventListener('resize', () => engine.resize());

function togglePause() {
  if (state.phase !== 'run') return;
  state.paused = !state.paused;
  pauseEl.hidden = !state.paused;
}

// --- Questions : une Zone Savoir tous les 150 m -------------------------------
function showQuestion(i) {
  const q = QUESTIONS[i];
  const gate = gates[i];
  panel.meta.textContent = `Zone Savoir ${i + 1} / ${QUESTIONS.length} · ${q.source}`;
  panel.text.textContent = q.question;
  panel.options.replaceChildren(...gate.picks.map((choiceIndex, lane) => {
    const opt = document.createElement('div');
    opt.className = 'opt';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = LANE_LETTERS[lane];
    const label = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'lane-name';
    name.textContent = LANE_NAMES[lane];
    label.append(name, q.choices[choiceIndex]);
    opt.append(chip, label);
    return opt;
  }));
  panel.root.hidden = false;
  shownQuestion = i;
}

function hideQuestion() {
  panel.root.hidden = true;
  shownQuestion = -1;
}

// La mascotte fonce dans une porte : la bonne s'ouvre et laisse passer, l'erreur ouvre la correction.
function passGate(i) {
  const q = QUESTIONS[i];
  const gate = gates[i];
  const lane = LANES.reduce((best, x, l) => (Math.abs(player.position.x - x) < Math.abs(player.position.x - LANES[best]) ? l : best), 0);
  const result = state.results[i];
  result.chosen = gate.picks[lane];
  state.current = i + 1;
  hideQuestion();

  if (lane === gate.correctLane) {
    gate.doors[lane].status = 'open';
    result.status = 'ok';
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    result.xp = 100 + 25 * Math.min(state.streak - 1, 4);
    state.xp += result.xp;
    state.speed = Math.min(MAX_SPEED, state.speed + 0.3);
    state.boostUntil = state.elapsed + 1;
    showBanner('ok', `Porte ouverte ! +${result.xp} XP`, q);
  } else {
    gate.doors[lane].status = 'bad';
    gate.doors[gate.correctLane].status = 'open';
    result.status = 'ko';
    state.streak = 0;
    state.lives--;
    state.shakeUntil = state.elapsed + 0.5;
    state.dizzyUntil = state.elapsed + 0.9;
    state.slowUntil = state.elapsed + 1.2;
    flash();
    showBanner('ko', `Porte fermée, −1 protection ! Bonne réponse : ${LANE_LETTERS[gate.correctLane]} · ${q.choices[q.answer]}`, q, 8000);
    // La correction ouvre aussi le passage : la mascotte poursuit sa route
    setTimeout(() => { gate.doors[lane].status = 'open'; }, 700);
    if (state.lives <= 0) {
      state.phase = 'over';
      setTimeout(() => showBilan(false), 3500);
    }
  }
  progress.ticks[i].classList.add(result.status);
  updateHud();
}

// --- Obstacles et pièces : règles ---------------------------------------------
function hitsHazard(h, feetY, sliding) {
  if (h.type === 'block') return true;
  if (h.type === 'low') return feetY < 0.85;                 // on passe en sautant
  return feetY + (sliding ? 0.7 : 1.9) > 1.35;               // barre : on passe en glissant
}

function crash(hazard) {
  hazard.hit = true;
  hazard.holder.setEnabled(false);
  state.xp = Math.max(0, state.xp - CRASH_XP);
  state.invulnUntil = state.elapsed + 1;
  state.slowUntil = state.elapsed + 0.7;
  state.shakeUntil = state.elapsed + 0.4;
  state.dizzyUntil = state.elapsed + 0.7;
  flash();
  showBanner('ko', `Collision ! −${CRASH_XP} XP`, null, 1800);
  updateHud();
}

function collect(coin) {
  coin.taken = true;
  coin.mesh.setEnabled(false);
  state.coins++;
  state.xp += COIN_XP;
  updateHud();
}

function flash() {
  flashEl.classList.remove('on');
  void flashEl.offsetWidth;
  flashEl.classList.add('on');
}

function showBanner(kind, headline, q, duration = 5000) {
  banner.className = 'card ' + kind;
  banner.replaceChildren();
  const h = document.createElement('div');
  h.className = 'headline';
  h.textContent = headline;
  banner.append(h);
  if (q) {
    const exp = document.createElement('div');
    exp.textContent = q.explanation;
    const src = document.createElement('span');
    src.className = 'source';
    src.textContent = `Source : ${q.source}`;
    banner.append(exp, src);
  }
  banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { banner.hidden = true; }, duration);
}

// --- HUD et bilan -------------------------------------------------------------
function buildProgressTicks() {
  gates.forEach((gate) => {
    const tick = document.createElement('span');
    tick.className = 'tick';
    tick.style.left = `${(gate.z / FINISH_Z) * 100}%`;
    progress.root.append(tick);
    progress.ticks.push(tick);
  });
}

function updateHud() {
  hud.lives.replaceChildren(...Array.from({ length: LIVES }, (_, n) => {
    const life = document.createElement('span');
    life.className = 'life' + (n < state.lives ? '' : ' lost');
    life.textContent = '✓';
    return life;
  }));
  const streak = state.streak > 1 ? ` · 🔥 série ×${state.streak}` : '';
  hud.stats.textContent = `${state.xp} XP${streak} · ● ${state.coins}`;
  const q = QUESTIONS[Math.min(state.current, QUESTIONS.length - 1)];
  hud.title.textContent = MISSIONS.find((m) => m.id === q.missionId).title;
}

function showBilan(victory) {
  bilan.title.textContent = victory ? 'Mission accomplie ! 🎓' : 'Fin de la course';
  bilan.score.textContent = `${state.xp} XP · Protections ${state.lives}/${LIVES} · Pièces ${state.coins} · Meilleure série ×${state.bestStreak}`;
  bilan.list.replaceChildren(...QUESTIONS.map((q, i) => {
    const r = state.results[i];
    const li = document.createElement('li');
    if (r.status === 'ok') {
      li.className = 'ok';
      li.textContent = `✓ ${q.question}`;
    } else if (r.status === 'ko') {
      li.className = 'ko';
      li.textContent = `✗ ${q.question} → ${q.choices[q.answer]} (${q.source})`;
    } else {
      li.textContent = `· ${q.question} (non atteinte)`;
    }
    return li;
  }));
  bilan.root.hidden = false;
}

bilan.restart.addEventListener('click', () => location.reload());

// --- Boucle de jeu ------------------------------------------------------------
function update() {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  if (state.paused || state.phase === 'loading') return;
  state.elapsed += dt;

  if (state.phase === 'ready' && state.elapsed >= state.readyUntil) {
    state.phase = 'run';
    showBanner('ok', 'C’est parti ! Évitez les obstacles, ramassez les pièces.', null, 3500);
  }
  const running = state.phase === 'run';
  let mode = state.phase === 'ready' ? 'idle' : state.phase === 'finished' ? 'cheer' : state.phase === 'over' ? 'dizzy' : 'run';

  if (running) {
    const hasGate = state.current < QUESTIONS.length;
    const zs = hasGate ? zoneStart(state.current) : Infinity;
    const gz = hasGate ? gateZ(state.current) : Infinity;

    if (hasGate && player.position.z >= zs - QUESTION_LEAD && shownQuestion !== state.current) showQuestion(state.current);

    const inZone = hasGate && player.position.z >= zs - 5;
    state.zoneFactor += ((inZone ? ZONE_SPEED : 1) - state.zoneFactor) * Math.min(1, dt * 3);
    const slowed = state.elapsed < state.slowUntil ? 0.5 : 1;
    player.position.z += state.speed * state.zoneFactor * slowed * dt;
    player.position.x += (LANES[state.lane] - player.position.x) * Math.min(1, dt * 12);

    const wasAir = state.jumpY > 0;
    state.jumpY += state.vy * dt;
    state.vy -= GRAVITY * dt;
    if (state.jumpY <= 0) {
      state.jumpY = 0;
      state.vy = 0;
      if (wasAir) state.landUntil = state.elapsed + 0.14;
    }
    const sliding = state.elapsed < state.slideUntil && state.jumpY === 0;
    player.position.y = state.jumpY;

    for (const h of hazards) {
      if (!h.hit && state.elapsed >= state.invulnUntil
        && Math.abs(h.z - player.position.z) < 0.9 && Math.abs(h.x - player.position.x) < 1.3
        && hitsHazard(h, player.position.y, sliding)) crash(h);
    }
    for (const c of coins) {
      if (!c.taken && Math.abs(c.z - player.position.z) < 1 && Math.abs(c.x - player.position.x) < 1.2
        && Math.abs(c.y - (player.position.y + 0.9)) < 1) collect(c);
    }

    if (state.jumpY > 0) mode = 'jump';
    if (state.elapsed < state.dizzyUntil) mode = 'dizzy';

    if (hasGate && player.position.z >= gz) {
      passGate(state.current);
    } else if (!hasGate && player.position.z > FINISH_Z) {
      state.phase = 'finished';
      showBanner('ok', 'Bienvenue à la remise des diplômes !', null);
      setTimeout(() => showBilan(true), 2500);
    }
  }

  // Attitude : face caméra pendant « Prêt ? », glissade couchée, inclinaison dans les virages, tournis
  const sliding = running && state.elapsed < state.slideUntil && state.jumpY === 0;
  const readyTurn = state.phase === 'ready' ? Math.PI * 0.85 : 0;
  visual.rotation.y = ease(visual.rotation.y, readyTurn, Math.min(1, dt * 6));
  visual.rotation.x = ease(visual.rotation.x, sliding ? 0.95 : 0, Math.min(1, dt * 14));   // plongeon accroupi vers l'avant
  visual.position.y = ease(visual.position.y, sliding ? -0.1 : 0, Math.min(1, dt * 14));
  const dizzy = state.dizzyUntil - state.elapsed;
  const bank = dizzy > 0 ? Math.sin(dizzy * 22) * 0.3 : (running ? (player.position.x - LANES[state.lane]) * -0.12 : 0);
  visual.rotation.z = ease(visual.rotation.z, bank, Math.min(1, dt * 12));
  animateMascot(dt, sliding ? 'slide' : mode);

  // Caméra : champ de vision élargi en accélération, secousse après une erreur
  const boosting = state.elapsed < state.boostUntil;
  camera.fov = ease(camera.fov, boosting ? 1.0 : 0.9, Math.min(1, dt * 6));
  const shaking = state.elapsed < state.shakeUntil;
  camTarget.position.set(
    player.position.x * 0.5 + (shaking ? (Math.random() - 0.5) * 0.4 : 0),
    CAM_LOOK_Y + player.position.y * 0.5 + (shaking ? (Math.random() - 0.5) * 0.4 : 0),
    player.position.z,
  );

  progress.fill.style.width = `${Math.min(100, (player.position.z / FINISH_Z) * 100)}%`;

  // L'horizon suit la mascotte ; feuilles et points sont recyclés devant elle
  space.position.z = player.position.z;
  for (const p of pages) {
    p.position.y = p.metadata.baseY + Math.sin(state.elapsed * 0.8 + p.metadata.phase) * 0.5;
    p.rotation.y += dt * p.metadata.spin;
    if (p.position.z < player.position.z - 20) p.position.z += 180;
  }
  for (const d of dots) {
    if (d.position.z < player.position.z - 20) d.position.z += 180;
  }
  for (const c of coins) {
    if (!c.taken && Math.abs(c.z - player.position.z) < 60) c.mesh.rotation.y += dt * 3;
  }

  // Portes : la bonne coulisse vers le haut, la mauvaise tremble puis s'efface
  const k = Math.min(1, dt * 6);
  gates.forEach((gate) => gate.doors.forEach((door) => {
    const target = door.status === 'open' ? door.baseY + 3.8 : door.baseY;
    door.slab.position.y = ease(door.slab.position.y, target, k);
    door.slab.rotation.z = door.status === 'bad' ? Math.sin(state.elapsed * 35) * 0.04 : 0;
  }));
}

// --- Démarrage ----------------------------------------------------------------
buildGates();
buildCourse();
buildProgressTicks();
updateHud();
$('loading').hidden = true;
state.phase = 'ready';
state.readyUntil = READY_TIME;
showBanner('ok', 'Prêt ?', null, 1600);
window.__study = { state, player, visual, mascot };   // observation pour les tests automatiques
scene.onBeforeRenderObservable.add(update);
engine.runRenderLoop(() => scene.render());
