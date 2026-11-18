import {
  Engine, Scene, Vector3, Color3, Color4, HemisphericLight, DirectionalLight,
  ArcRotateCamera, MeshBuilder, StandardMaterial, DynamicTexture, Texture, TransformNode, LoadAssetContainerAsync,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF/2.0/index.js';
import { MISSIONS, QUESTIONS } from '../lessons.js';

// --- Charte eUniversité --------------------------------------------------------
const ORANGE = '#FFA000';
const CREAM = '#FFF0D5';
const INK = '#19150E';

// --- Réglages -----------------------------------------------------------------
const LIVES = 3;
const LANES = [-3, 0, 3];              // trois voies
const LANE_NAMES = ['voie gauche', 'voie centrale', 'voie droite'];
const LANE_LETTERS = ['A', 'B', 'C'];

const BASE_SPEED = 7;                  // m/s, vitesse de départ
const MAX_SPEED = 10;                  // +0,3 m/s par bonne réponse
const ZONE_SPEED = 0.7;                // ralentissement doux en Zone Savoir, pour laisser lire
const PLAYER_HEIGHT = 1.8;
const JUMP_V = 8.5;
const GRAVITY = 24;
const CAM_LOOK_Y = 2.4;                // point visé au-dessus du personnage : libère le bas de l'écran
const READY_TIME = 1.6;                // « À vos marques » avant le départ

// Parcours : une Zone Savoir tous les 150 m, question affichée à l'approche
const zoneStart = (i) => 140 + i * 150;
const ZONE_LEN = 50;
const gateZ = (i) => zoneStart(i) + ZONE_LEN;     // les panneaux de réponse sont au bout de la zone
const QUESTION_LEAD = 25;
const FINISH_Z = gateZ(QUESTIONS.length - 1) + 40;

const COIN_XP = 10;
const CRASH_XP = 20;

// Décor : le campus est découpé en tronçons recyclés devant le joueur
const CHUNK = 40;
const CHUNKS = 10;

// --- État ---------------------------------------------------------------------
const state = {
  phase: 'loading',                    // loading · ready · run · over · finished
  lives: LIVES,
  xp: 0,
  books: 0,
  streak: 0,
  bestStreak: 0,
  current: 0,                          // index de la prochaine Zone Savoir
  lane: 1,
  speed: BASE_SPEED,
  zoneFactor: 1,
  elapsed: 0,
  readyUntil: 0,
  vy: 0,
  jumpY: 0,
  slideUntil: 0,
  boostUntil: 0,
  shakeUntil: 0,
  stumbleUntil: 0,
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
const loading = { root: $('loading'), bar: $('loading-bar') };
const bilan = { root: $('bilan'), title: $('bilan-title'), score: $('bilan-score'), list: $('bilan-list'), restart: $('bilan-restart') };
let bannerTimer = 0;
let shownQuestion = -1;

// --- Moteur et scène ----------------------------------------------------------
const canvas = $('scene');
const mobile = matchMedia('(pointer: coarse)').matches;
const engine = new Engine(canvas, !mobile, { adaptToDeviceRatio: false });
if (mobile) engine.setHardwareScalingLevel(1.5);   // plus léger sur les smartphones modestes
const scene = new Scene(engine);
const SKY = Color3.FromHexString('#bfe0f0');
scene.clearColor = new Color4(SKY.r, SKY.g, SKY.b, 1);
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogStart = 90;
scene.fogEnd = 230;
scene.fogColor = SKY;

const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0.2), scene);
hemi.intensity = 0.62;
hemi.groundColor = new Color3(0.5, 0.47, 0.4);
const sun = new DirectionalLight('sun', new Vector3(-0.35, -1, 0.5), scene);
sun.diffuse = new Color3(1, 0.96, 0.88);
sun.intensity = 0.5;

let uid = 0;
function flatMat(hex, alpha = 1) {
  const m = new StandardMaterial('flat-' + ++uid, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = Color3.Black();
  m.alpha = alpha;
  return m;
}

// Carte à texte : panneaux de réponses et bannière de zone
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

function signMaterial({ letter, text, width, height, size }) {
  const tex = new DynamicTexture('sign-' + ++uid, { width, height }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = ORANGE;
  ctx.lineWidth = 18;
  ctx.strokeRect(9, 9, width - 18, height - 18);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  if (letter) {
    ctx.fillStyle = ORANGE;
    ctx.beginPath();
    ctx.arc(height * 0.5, height / 2, height * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.fillText(letter, height * 0.5, height / 2 + size * 0.04);
    ctx.textAlign = 'left';
    ctx.font = `700 ${size * 0.62}px system-ui, sans-serif`;
    const lines = wrapLines(ctx, text, width - height - 40);
    const lineH = size * 0.74;
    const top = height / 2 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, n) => ctx.fillText(l, height * 0.9, top + n * lineH));
  } else {
    ctx.textAlign = 'center';
    ctx.fillText(text, width / 2, height / 2 + size * 0.04);
  }
  tex.update();
  const m = new StandardMaterial('sign-mat-' + uid, scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.specularColor = Color3.Black();
  m.backFaceCulling = false;
  return m;
}

// Sol : dalles crème du campus, joints discrets
function pavingMaterial(tilesU, tilesV) {
  const size = 256;
  const tex = new DynamicTexture('paving', { width: size, height: size }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = '#f3e3c3';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#dcc79c';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  tex.update(true);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = tilesU;
  tex.vScale = tilesV;
  const m = new StandardMaterial('paving-mat', scene);
  m.diffuseTexture = tex;
  m.specularColor = Color3.Black();
  return m;
}

// --- Bibliothèque d'assets 3D (GLB existants, voir assets/) -------------------
const ASSET_FILES = {
  man: 'man_character', cap: 'cap_google_a',
  bldLarge1: 'bld_kenney_large_1', bldLarge2: 'bld_kenney_large_2', bldLarge3: 'bld_kenney_large_3',
  bldSmall: 'bld_kenney_small', bldTower: 'bld_kenney_skyscraper', bldBig: 'bld_quat_big', bldKay: 'bld_kay_building',
  pine: 'tree_pine', bush: 'bush_a', hedge: 'hedge', bench: 'bench_quat_a', lamp: 'light_quat_a',
  barrier: 'barrier_large', banner: 'banner_a', book: 'book_open_a', fountain: 'fountain',
};
const lib = {};

async function loadAssets() {
  const entries = Object.entries(ASSET_FILES);
  let done = 0;
  await Promise.all(entries.map(async ([key, file]) => {
    lib[key] = { container: await LoadAssetContainerAsync(`../assets/${file}.glb`, scene), unit: null };
    loading.bar.style.width = `${(++done / entries.length) * 100}%`;
  }));
}

// Pose une instance d'un asset : mise à l'échelle sur une hauteur ou une longueur, posé au sol, centré.
function spawn(key, parent, { x = 0, y = 0, z = 0, rotY = 0, height = 0, length = 0, scale = 0 } = {}) {
  const asset = lib[key];
  const inst = asset.container.instantiateModelsToScene((n) => `${key}-${++uid}-${n}`, false);
  const root = inst.rootNodes[0];
  if (!asset.unit) {
    root.computeWorldMatrix(true);
    const b = root.getHierarchyBoundingVectors(true);
    asset.unit = {
      h: b.max.y - b.min.y, long: Math.max(b.max.x - b.min.x, b.max.z - b.min.z), minY: b.min.y,
      cx: (b.min.x + b.max.x) / 2, cz: (b.min.z + b.max.z) / 2,
    };
  }
  const u = asset.unit;
  const s = scale || (height ? height / u.h : length / u.long);
  const holder = new TransformNode(`holder-${key}-${uid}`, scene);
  holder.parent = parent;
  holder.position.set(x, y, z);
  holder.rotation.y = rotY;
  root.parent = holder;
  root.scaling.scaleInPlace(s);
  root.position.set(-u.cx * s, -u.minY * s, -u.cz * s);
  return holder;
}

// Teinte les matériaux unis d'un asset vers la charte (les matériaux texturés restent intacts)
function tintAsset(key, hex, amount) {
  const target = Color3.FromHexString(hex);
  for (const m of lib[key].container.materials) {
    if (m.albedoTexture || !m.albedoColor) continue;
    m.albedoColor = Color3.Lerp(m.albedoColor, target, amount);
  }
}

// --- Piste et sol --------------------------------------------------------------
const TRACK_LEN = FINISH_Z + 120;
const trackMid = TRACK_LEN / 2 - 30;

const walkway = MeshBuilder.CreateGround('walkway', { width: 10, height: TRACK_LEN }, scene);
walkway.position.set(0, 0.02, trackMid);
walkway.material = pavingMaterial(5, TRACK_LEN / 2);

const grass = MeshBuilder.CreateGround('grass', { width: 240, height: TRACK_LEN }, scene);
grass.position.set(0, 0, trackMid);
grass.material = flatMat('#6f9c4e');

// Séparateurs de voies : fins filets orange, discrets
for (const x of [-1.5, 1.5]) {
  const line = MeshBuilder.CreateGround('lane-line-' + x, { width: 0.07, height: TRACK_LEN }, scene);
  line.position.set(x, 0.03, trackMid);
  line.material = flatMat('#e0b062', 0.7);
}

// --- Chunks de décor (recyclés) -----------------------------------------------
const world = new TransformNode('world', scene);
const chunks = [];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function populateChunk(node) {
  for (const side of [-1, 1]) {
    const facing = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    // Haies le long des allées
    for (let n = 0; n < 10; n++) {
      spawn('hedge', node, { x: side * 5.7, z: n * 4 + 2, rotY: Math.PI / 2, length: 4, scale: 0 });
    }
    // Lampadaires, arbres, buissons, banc
    spawn('lamp', node, { x: side * 6.4, z: 10 + (side > 0 ? 0 : 20), rotY: side > 0 ? Math.PI : 0, height: 4.8 });
    for (let n = 0; n < 2; n++) {
      spawn('pine', node, { x: side * (8 + Math.random() * 3), z: 6 + n * 20 + Math.random() * 6, rotY: Math.random() * 6, height: 6 + Math.random() * 2 });
    }
    spawn('bush', node, { x: side * (7.2 + Math.random() * 1.5), z: 15 + Math.random() * 10, rotY: Math.random() * 6, height: 1.3 });
    if (Math.random() < 0.5) spawn('bench', node, { x: side * 6.5, z: 30, rotY: facing, length: 2.2 });
    // Bâtiments : deux par côté et par tronçon, façade tournée vers l'allée
    for (let n = 0; n < 2; n++) {
      const key = pick(['bldLarge1', 'bldLarge2', 'bldLarge3', 'bldSmall', 'bldBig', 'bldKay']);
      spawn(key, node, { x: side * (19 + Math.random() * 4), z: 6 + n * 20, rotY: facing, height: 11 + Math.random() * 8 });
    }
    // Silhouette lointaine
    spawn('bldTower', node, { x: side * (45 + Math.random() * 10), z: 12 + Math.random() * 12, rotY: facing, height: 40 + Math.random() * 20 });
  }
  if (Math.random() < 0.3) spawn('fountain', node, { x: pick([-1, 1]) * 13, z: 20, length: 7 });
}

// --- Zones Savoir et panneaux de réponse --------------------------------------
// Dans chaque zone : une arche d'entrée, puis trois panneaux de réponse (un par voie).
// Le joueur choisit en passant sous un panneau, sans jamais s'arrêter.
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

    const zoneFloor = MeshBuilder.CreateGround('zone-floor-' + i, { width: 10, height: ZONE_LEN }, scene);
    zoneFloor.position.set(0, 0.04, (start + z) / 2);
    zoneFloor.material = flatMat(ORANGE, 0.16);

    // Arche d'entrée : deux lampadaires et une bannière
    for (const x of [-5.4, 5.4]) spawn('lamp', world, { x, z: start, rotY: x < 0 ? 0 : Math.PI, height: 5.6 });
    const arch = MeshBuilder.CreatePlane('arch-' + i, { width: 9.6, height: 1.3 }, scene);
    arch.position.set(0, 5.4, start);
    arch.material = signMaterial({ text: `ZONE SAVOIR · ${i + 1}/${QUESTIONS.length}`, width: 1024, height: 140, size: 84 });

    // Panneaux de réponse, suspendus entre des lampadaires
    for (const x of [-4.5, -1.5, 1.5, 4.5]) spawn('lamp', world, { x, z, rotY: x < 0 ? 0 : Math.PI, height: 4.6 });
    const signs = LANES.map((x, lane) => {
      const plane = MeshBuilder.CreatePlane(`sign-${i}-${lane}`, { width: 2.8, height: 1.15 }, scene);
      plane.position.set(x, 3.7, z);
      plane.material = signMaterial({ letter: LANE_LETTERS[lane], text: q.choices[picks[lane]], width: 1024, height: 420, size: 150 });
      return { plane, baseY: 3.7, status: 'idle' };
    });

    gates.push({ start, z, picks, correctLane: picks.indexOf(q.answer), signs });
  });
}

// --- Obstacles et livres ------------------------------------------------------
// Barrière = changer de voie · banc = sauter · banderole = glisser dessous.
const hazards = [];
const books = [];
const shuffled = () => [0, 1, 2].sort(() => Math.random() - 0.5);

function addHazard(type, lane, z) {
  let holder;
  if (type === 'block') holder = spawn('barrier', world, { x: LANES[lane], z, length: 2.6, rotY: 0 });
  else if (type === 'low') holder = spawn('bench', world, { x: LANES[lane], z, length: 2.3, rotY: Math.PI / 2 });
  else holder = spawn('banner', world, { x: LANES[lane] + 1.3, z, height: 3.2, rotY: Math.PI / 2 });
  hazards.push({ holder, type, x: LANES[lane], z, hit: false });
}

function addBook(lane, z, y = 0.9) {
  const holder = spawn('book', world, { x: LANES[lane], y, z, length: 0.9 });
  books.push({ holder, x: LANES[lane], y, z, taken: false });
}

const bookLine = (lane, z) => { for (let n = 0; n < 4; n++) addBook(lane, z + n * 2); };
const bookArc = (lane, z) => { for (let n = 0; n < 5; n++) addBook(lane, z - 4 + n * 2, 0.9 + Math.sin((n / 4) * Math.PI) * 1.2); };

function addRow(z) {
  const [a, b, c] = shuffled();
  const roll = Math.random();
  if (roll < 0.35) {
    addHazard('block', a, z);
    bookLine(b, z - 3);
  } else if (roll < 0.6) {
    addHazard('low', a, z);
    if (Math.random() < 0.5) addHazard('low', b, z);
    bookArc(a, z);
    bookLine(c, z - 3);
  } else if (roll < 0.8) {
    addHazard('high', a, z);
    if (Math.random() < 0.5) addHazard('high', b, z);
    bookLine(c, z - 3);
  } else {
    addHazard('block', a, z);
    addHazard('block', b, z);
    bookLine(c, z - 3);
  }
}

function buildCourse() {
  QUESTIONS.forEach((_, i) => {
    const from = i === 0 ? 40 : gateZ(i - 1) + 25;
    const to = zoneStart(i) - QUESTION_LEAD - 12;
    for (let z = from; z <= to; z += 13 + Math.random() * 4) addRow(z);
  });
}

// --- Personnage : étudiant en tenue académique --------------------------------
const player = new TransformNode('player', scene);
const visual = new TransformNode('visual', scene);
visual.parent = player;
const anim = { groups: {}, current: null };
let headNode = null;
let capHolder = null;
let charYaw = 0;                       // orientation du modèle : à ajuster si besoin

async function buildPlayer() {
  const man = lib.man.container;
  // Tenue noire (toge), peau brune, chaussures orange, selon la charte
  const colors = { Shirt: INK, Pants: INK, Hair: '#0d0a06', Skin: '#6b4226', Socks: ORANGE };
  for (const m of man.materials) {
    const hex = colors[m.name];
    if (hex) m.albedoColor = Color3.FromHexString(hex);
  }
  man.addAllToScene();
  const root = man.meshes[0];
  root.parent = visual;
  root.computeWorldMatrix(true);
  const b = root.getHierarchyBoundingVectors(true);
  const s = PLAYER_HEIGHT / (b.max.y - b.min.y);
  root.scaling.scaleInPlace(s);
  root.position.set(0, -b.min.y * s, 0);
  visual.rotation.y = charYaw;

  for (const g of man.animationGroups) {
    g.stop();
    g.enableBlending = true;
    g.blendingSpeed = 0.12;
    anim.groups[g.name.split('|').pop().replace('Man_', '').toLowerCase()] = g;
  }

  // Toque de diplômé posée sur la tête (suit l'os de la tête)
  const head = man.skeletons[0].bones.find((bone) => bone.name === 'Head');
  headNode = head ? head.getTransformNode() : null;
  const cap = lib.cap.container;
  cap.addAllToScene();
  const capRoot = cap.meshes[0];
  capHolder = new TransformNode('cap-holder', scene);
  capRoot.parent = capHolder;
  capRoot.computeWorldMatrix(true);
  const cb = capRoot.getHierarchyBoundingVectors(true);
  const cs = 0.42 / Math.max(cb.max.x - cb.min.x, cb.max.z - cb.min.z);
  capRoot.scaling.scaleInPlace(cs);
  capRoot.position.set(-((cb.min.x + cb.max.x) / 2) * cs, -cb.min.y * cs, -((cb.min.z + cb.max.z) / 2) * cs);
  capHolder.scaling.setAll(1);
  play('idle');
}

function play(name, { loop = true, speed = 1 } = {}) {
  const g = anim.groups[name];
  if (!g || anim.current === g) return;
  anim.current?.stop();
  anim.current = g;
  g.start(loop, speed);
}

// La toque suit la tête de la course, mais reste à plat
scene.onAfterAnimationsObservable.add(() => {
  if (!headNode || !capHolder) return;
  const p = headNode.getAbsolutePosition();
  capHolder.position.set(p.x, p.y + 0.12, p.z);
  capHolder.rotation.y = visual.rotation.y;
});

// --- Caméra -------------------------------------------------------------------
// Derrière le personnage, légèrement au-dessus, comme dans un runner mobile
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
    play('runningjump', { loop: false, speed: 1.1 });
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

// Tactile : glisser dans une direction, ou toucher pour sauter
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

// Le joueur passe sous un panneau : la voie occupée est la réponse choisie.
function passGate(i) {
  const q = QUESTIONS[i];
  const gate = gates[i];
  const lane = LANES.reduce((best, x, l) => (Math.abs(player.position.x - x) < Math.abs(player.position.x - LANES[best]) ? l : best), 0);
  const result = state.results[i];
  result.chosen = gate.picks[lane];

  gate.signs.forEach((sign, l) => { if (l !== lane) sign.status = 'dim'; });
  state.current = i + 1;
  hideQuestion();

  if (lane === gate.correctLane) {
    gate.signs[lane].status = 'good';
    result.status = 'ok';
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    result.xp = 100 + 25 * Math.min(state.streak - 1, 4);
    state.xp += result.xp;
    state.speed = Math.min(MAX_SPEED, state.speed + 0.3);
    state.boostUntil = state.elapsed + 1;
    showBanner('ok', `Bonne réponse ! +${result.xp} XP`, q);
  } else {
    gate.signs[lane].status = 'bad';
    gate.signs[gate.correctLane].status = 'reveal';
    result.status = 'ko';
    state.streak = 0;
    state.lives--;
    state.shakeUntil = state.elapsed + 0.5;
    state.stumbleUntil = state.elapsed + 0.8;
    state.slowUntil = state.elapsed + 1.2;
    flash();
    showBanner('ko', `Raté, −1 protection ! Bonne réponse : ${LANE_LETTERS[gate.correctLane]} · ${q.choices[q.answer]}`, q, 8000);
    if (state.lives <= 0) {
      state.phase = 'over';
      play('death', { loop: false });
      setTimeout(() => showBilan(false), 3500);
    }
  }
  progress.ticks[i].classList.add(result.status);
  updateHud();
}

// --- Obstacles et livres : règles ---------------------------------------------
// Pieds à la hauteur y, tête à y + 1,8 (0,7 en glissade).
function hitsHazard(h, feetY, sliding) {
  if (h.type === 'block') return true;
  if (h.type === 'low') return feetY < 0.85;                  // on passe en sautant
  return feetY + (sliding ? 0.7 : PLAYER_HEIGHT) > 1.3;       // banderole : on passe en glissant
}

function crash(hazard) {
  hazard.hit = true;
  hazard.holder.setEnabled(false);
  state.xp = Math.max(0, state.xp - CRASH_XP);
  state.invulnUntil = state.elapsed + 1;
  state.slowUntil = state.elapsed + 0.7;
  state.shakeUntil = state.elapsed + 0.4;
  state.stumbleUntil = state.elapsed + 0.7;
  flash();
  showBanner('ko', `Collision ! −${CRASH_XP} XP`, null, 1800);
  updateHud();
}

function collect(book) {
  book.taken = true;
  book.holder.setEnabled(false);
  state.books++;
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
    const heart = document.createElement('span');
    heart.className = 'heart' + (n < state.lives ? '' : ' lost');
    heart.textContent = '♥';
    return heart;
  }));
  const streak = state.streak > 1 ? ` · 🔥 série ×${state.streak}` : '';
  hud.stats.textContent = `XP ${state.xp}${streak} · 📖 ${state.books}`;
  const q = QUESTIONS[Math.min(state.current, QUESTIONS.length - 1)];
  hud.title.textContent = MISSIONS.find((m) => m.id === q.missionId).title;
}

function showBilan(victory) {
  bilan.title.textContent = victory ? 'Diplôme obtenu ! 🎓' : 'Fin de la course';
  bilan.score.textContent = `XP ${state.xp} · Protections ${state.lives}/${LIVES} · Livres ${state.books} · Meilleure série ×${state.bestStreak}`;
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
    play('run', { speed: 1.15 });
    showBanner('ok', 'C’est parti ! Évitez les obstacles, ramassez les livres.', null, 3500);
  }
  const running = state.phase === 'run';

  if (running) {
    const hasGate = state.current < QUESTIONS.length;
    const zs = hasGate ? zoneStart(state.current) : Infinity;
    const gz = hasGate ? gateZ(state.current) : Infinity;

    // La question apparaît à l'approche de la zone et disparaît après les panneaux
    if (hasGate && player.position.z >= zs - QUESTION_LEAD && shownQuestion !== state.current) showQuestion(state.current);

    // Ralentissement doux dans la zone, pour laisser le temps de lire
    const inZone = hasGate && player.position.z >= zs - 5;
    state.zoneFactor += ((inZone ? ZONE_SPEED : 1) - state.zoneFactor) * Math.min(1, dt * 3);
    const stumble = state.elapsed < state.slowUntil ? 0.5 : 1;
    player.position.z += state.speed * state.zoneFactor * stumble * dt;

    // Changement de voie
    player.position.x += (LANES[state.lane] - player.position.x) * Math.min(1, dt * 12);

    // Saut et glissade
    state.jumpY += state.vy * dt;
    state.vy -= GRAVITY * dt;
    if (state.jumpY <= 0) { state.jumpY = 0; state.vy = 0; }
    const sliding = state.elapsed < state.slideUntil && state.jumpY === 0;
    player.position.y = state.jumpY;

    // Collisions et livres
    for (const h of hazards) {
      if (!h.hit && state.elapsed >= state.invulnUntil
        && Math.abs(h.z - player.position.z) < 0.9 && Math.abs(h.x - player.position.x) < 1.3
        && hitsHazard(h, player.position.y, sliding)) crash(h);
    }
    for (const b of books) {
      if (!b.taken && Math.abs(b.z - player.position.z) < 1 && Math.abs(b.x - player.position.x) < 1.2
        && Math.abs(b.y + 0.4 - (player.position.y + 0.9)) < 1) collect(b);
    }

    // Animation selon l'action en cours
    if (sliding) play('sitting');
    else if (state.jumpY > 0) { /* animation de saut déjà lancée */ }
    else play('run', { speed: 1.15 });

    if (hasGate && player.position.z >= gz) {
      passGate(state.current);
    } else if (!hasGate && player.position.z > FINISH_Z) {
      state.phase = 'finished';
      play('clapping');
      showBanner('ok', 'Bienvenue à la remise des diplômes !', null);
      setTimeout(() => showBilan(true), 2500);
    }
  }

  // Attitude : glissade basse, trébuchement après une erreur, inclinaison dans les virages
  const sliding = state.elapsed < state.slideUntil && state.jumpY === 0 && running;
  visual.position.y += ((sliding ? -0.25 : 0) - visual.position.y) * Math.min(1, dt * 14);
  const stumbling = state.stumbleUntil - state.elapsed;
  const tilt = stumbling > 0 ? Math.sin(stumbling * 20) * 0.18 : (running ? (player.position.x - LANES[state.lane]) * -0.1 : 0);
  visual.rotation.z += (tilt - visual.rotation.z) * Math.min(1, dt * 12);
  visual.rotation.x += ((stumbling > 0 ? 0.25 : 0) - visual.rotation.x) * Math.min(1, dt * 10);

  // Caméra : champ de vision élargi en accélération, secousse après une erreur
  const boosting = state.elapsed < state.boostUntil;
  camera.fov += ((boosting ? 1.0 : 0.9) - camera.fov) * Math.min(1, dt * 6);
  const shaking = state.elapsed < state.shakeUntil;
  camTarget.position.set(
    player.position.x * 0.5 + (shaking ? (Math.random() - 0.5) * 0.4 : 0),
    CAM_LOOK_Y + player.position.y * 0.5 + (shaking ? (Math.random() - 0.5) * 0.4 : 0),
    player.position.z,
  );

  progress.fill.style.width = `${Math.min(100, (player.position.z / FINISH_Z) * 100)}%`;

  // Décor : les tronçons dépassés repartent devant le joueur
  for (const c of chunks) {
    if (c.position.z < player.position.z - CHUNK * 2) c.position.z += CHUNK * CHUNKS;
  }

  // Livres qui tournent
  for (const b of books) {
    if (!b.taken && Math.abs(b.z - player.position.z) < 60) b.holder.rotation.y += dt * 2.5;
  }

  // Animation des panneaux : le bon s'élève (le passage s'ouvre), le mauvais tremble et s'estompe
  const ease = Math.min(1, dt * 6);
  gates.forEach((gate) => gate.signs.forEach((sign) => {
    const m = sign.plane.material;
    let targetY = sign.baseY;
    let alpha = 1;
    if (sign.status === 'good') { targetY = sign.baseY + 4; alpha = 0; }
    if (sign.status === 'dim') alpha = 0.35;
    if (sign.status === 'bad') alpha = 0.5;
    sign.plane.position.y += (targetY - sign.plane.position.y) * ease;
    sign.plane.rotation.z = sign.status === 'bad' ? Math.sin(state.elapsed * 30) * 0.05 : 0;
    m.alpha += (alpha - m.alpha) * ease;
    m.emissiveColor = sign.status === 'reveal' ? new Color3(0.5, 0.32, 0) : Color3.Black();
  }));
}

// --- Démarrage ----------------------------------------------------------------
async function start() {
  await loadAssets();
  for (const key of ['bldLarge1', 'bldLarge2', 'bldLarge3', 'bldSmall', 'bldTower']) tintAsset(key, '#f2dcb0', 0.75);
  tintAsset('bldBig', CREAM, 0.4);
  tintAsset('bldKay', CREAM, 0.4);
  tintAsset('book', ORANGE, 0.7);
  tintAsset('banner', ORANGE, 0.85);

  await buildPlayer();
  for (let k = 0; k < CHUNKS; k++) {
    const node = new TransformNode('chunk-' + k, scene);
    node.position.z = -CHUNK * 2 + k * CHUNK;
    populateChunk(node);
    chunks.push(node);
  }
  buildGates();
  buildCourse();
  buildProgressTicks();
  updateHud();

  loading.root.hidden = true;
  state.phase = 'ready';
  state.readyUntil = state.elapsed + READY_TIME;
  showBanner('ok', 'À vos marques…', null, 1500);
}

scene.onBeforeRenderObservable.add(update);
engine.runRenderLoop(() => scene.render());
start();
