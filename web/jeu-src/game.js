import {
  Engine, Scene, Vector3, Color3, Color4, HemisphericLight, DirectionalLight,
  ArcRotateCamera, MeshBuilder, StandardMaterial, DynamicTexture, Texture, TransformNode, Mesh,
} from '@babylonjs/core';
import { MISSIONS as DEMO_MISSIONS, QUESTIONS as DEMO_QUESTIONS } from './lessons.js';
import { createToy, ORANGE, CREAM } from './student.js';
import { createStudent, createBlocks } from './lowpoly.js';
import { audio } from './audio.js';

// --- Contenu du jeu -------------------------------------------------------------
// ?course=<id> : les questions viennent du cours importé par l'étudiant (API Study).
// Sans paramètre : parcours de démonstration (lessons.js).
window.__build = typeof __BUILD__ === 'undefined' ? 'dev' : __BUILD__;   // numéro de build, affiché si le démarrage échoue
const COURSE_ID = new URLSearchParams(location.search).get('course');
async function loadCourse(id) {
  // Message d'erreur affiché dans l'écran de chargement (avec un lien de retour), sans détruire la page.
  const fail = (msg) => {
    window.__fail?.(msg, '/etudiant', 'Retour à mon espace');
    const err = new Error(msg);
    err.handled = true;
    throw err;
  };
  let res;
  try {
    res = await fetch(`/api/study/courses/${encodeURIComponent(id)}/game${location.search}`, { headers: { authorization: `Bearer ${localStorage.getItem('euniv:student') || ''}` } });
  } catch { fail('Connexion impossible. Vérifiez votre réseau.'); }
  if (res.status === 401) fail('Votre session a expiré. Reconnectez-vous pour jouer.');
  if (res.status === 402) fail((await res.json().catch(() => ({}))).error || 'Cette mission est réservée aux abonnés.');
  if (res.status === 409) fail((await res.json().catch(() => ({}))).error || 'Ce parcours n’est pas encore prêt.');
  if (!res.ok) fail('Ce parcours est introuvable ou pas encore prêt.');
  const data = await res.json();
  if (!data.questions?.length) fail('Ce parcours ne contient aucune question.');
  return data;
}
const L = (pct, label) => window.__loading?.(pct, label);   // avancement réel du chargement (écran d'attente de index.html)
L(70, 'Chargement de ton parcours…');
const lesson = COURSE_ID ? await loadCourse(COURSE_ID) : { missions: DEMO_MISSIONS, questions: DEMO_QUESTIONS };
L(78, 'Préparation du moteur 3D…');
const MISSIONS = lesson.missions;
const QUESTIONS = lesson.questions;
const SCOPE = lesson.scope || 'course';

const INK = '#19150E';

// --- Réglages -----------------------------------------------------------------
const LIVES = 3;
const LANES = [-3, 0, 3];
const LANE_NAMES = ['porte de gauche', 'porte du milieu', 'porte de droite'];
const LANE_LETTERS = ['A', 'B', 'C'];

const BASE_SPEED = 10;
const MAX_SPEED = 17;
// Difficulté croissante : chaque niveau de question accélère la course et raccourcit le temps de réponse.
const DIFF = {
  1: { name: 'Facile', secs: 18, boost: 0 },
  2: { name: 'Moyen', secs: 14, boost: 2.4 },
  3: { name: 'Difficile', secs: 11, boost: 4.6 },
};
const diffOf = (i) => QUESTIONS[Math.min(i, QUESTIONS.length - 1)].level ?? Math.min(3, 1 + Math.floor((i * 3) / QUESTIONS.length));
/** Temps pour répondre : celui du niveau, plus un peu de temps de lecture quand l'énoncé et les choix sont longs. */
function answerSeconds(i) {
  const q = QUESTIONS[i];
  const len = q.question.length + q.choices.reduce((n, c) => n + c.length, 0) / 2;
  return Math.round(DIFF[diffOf(i)].secs + Math.min(6, Math.max(0, (len - 120) / 40)));
}
const JUMP_V = 8.5;
const GRAVITY = 24;
const CAM_LOOK_Y = 1.6;
const READY_TIME = 1.8;
const STUDENT_SCALE = 0.7;             // l'étudiant fait 2,5 unités dans l'atelier : on le ramène à ~1,75

// Parcours : trois portes-réponses se dressent directement sur la route tous les 90 m, sans zone ni arche.
// La course s'arrête 16 m avant pour la question, puis reprend : l'étudiant file vers la porte choisie.
const gateZ = (i) => 80 + i * 90;
const STOP_BEFORE_GATE = 16;
const FINISH_Z = gateZ(QUESTIONS.length - 1) + 40;

const COIN_XP = 10;
const CRASH_XP = 20;

const CHUNK = 40;
const CHUNKS = 10;

// --- État ---------------------------------------------------------------------
const state = {
  who: 'boy',
  phase: 'loading',                    // loading · select · ready · run · question · answering · over · finished
  lives: LIVES,
  xp: 0,
  coins: 0,
  streak: 0,
  bestStreak: 0,
  timedOut: false,
  current: 0,
  lane: 1,
  chosenLane: 1,
  speed: BASE_SPEED,
  elapsed: 0,
  readyUntil: 0,
  vy: 0,
  jumpY: 0,
  slideUntil: 0,
  boostUntil: 0,
  shakeUntil: 0,
  reactUntil: 0,
  landUntil: 0,
  popUntil: 0,
  reactPose: 'victory',
  slowUntil: 0,
  invulnUntil: 0,
  results: QUESTIONS.map(() => ({ status: 'pending', xp: 0 })),
  paused: false,
};

// --- DOM ----------------------------------------------------------------------
const $ = (id) => document.getElementById(id) || document.createElement('div');   // un élément absent ne doit jamais faire planter le jeu
const hud = { no: $('mission-no'), name: $('mission-name'), lives: $('lives'), streak: $('streak'), streakN: $('streak-n'), books: $('books'), coins: $('coins'), xpNum: $('xp-num') };
const quiz = { root: $('quiz'), meta: $('q-meta'), text: $('q-text'), options: $('q-options') };
const progress = { fill: $('trail-fill'), root: $('trail'), runner: $('runner'), ticks: [] };
const banner = $('banner');
const flashEl = $('flash');
const pauseEl = $('pause');
const bilan = { root: $('bilan'), title: $('bilan-title'), sub: $('bilan-sub'), list: $('bilan-list'), restart: $('bilan-restart') };
let bannerTimer = 0;

// --- Moteur et scène ----------------------------------------------------------
const canvas = $('scene');
const mobile = matchMedia('(pointer: coarse)').matches;
const engine = new Engine(canvas, true, { adaptToDeviceRatio: false, powerPreference: 'high-performance' }, false);

// Résolution du rendu : on dessine à la densité réelle de l'écran (un téléphone 3× a trois fois plus de pixels que de
// pixels CSS), plafonnée par un budget de pixels. Si l'appareil peine, `quality` baisse par petits pas, puis remonte.
const PIXEL_BUDGET = mobile ? 2.6e6 : 5e6;
const MIN_QUALITY = 0.6;
const weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
const render = { quality: weak ? 0.8 : 1, scale: 1 };
function applyRenderScale() {
  const w = Math.max(1, canvas.clientWidth);
  const h = Math.max(1, canvas.clientHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 3 : 2);
  const fit = Math.sqrt(PIXEL_BUDGET / (w * h));
  render.scale = Math.max(0.6, Math.min(dpr, fit) * render.quality);
  engine.setHardwareScalingLevel(1 / render.scale);
  engine.resize();
}
applyRenderScale();
const scene = new Scene(engine);
const HAZE = Color3.FromHexString('#fff0d5');
scene.clearColor = new Color4(HAZE.r, HAZE.g, HAZE.b, 1);
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogStart = 90;
scene.fogEnd = 250;
scene.fogColor = HAZE;

const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0.25), scene);
hemi.intensity = 0.95;
hemi.diffuse = new Color3(1, 0.98, 0.94);
hemi.groundColor = new Color3(0.62, 0.5, 0.36);
const key = new DirectionalLight('key', new Vector3(-0.5, -0.9, 0.7), scene);
key.diffuse = new Color3(1, 0.96, 0.88);
key.specular = new Color3(1, 0.95, 0.85);
key.intensity = 0.4;

const toy = createToy(scene);
const { paint, solid, paintedMat } = toy;
const block = createBlocks(scene);           // mêmes gros blocs biseautés que l'étudiant

let uid = 0;

function textTexture(draw, width, height, { alpha = false } = {}) {
  const tex = new DynamicTexture('tex-' + ++uid, { width, height }, scene, true);
  draw(tex.getContext(), width, height);
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

// Face d'une porte : fond orange, grande lettre, réponse
function doorFaceMaterial(letter, text) {
  return textTexture((ctx, w, h) => {
    ctx.fillStyle = ORANGE;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 230px system-ui, sans-serif';
    ctx.fillText(letter, w / 2, h * 0.22);
    ctx.font = '800 58px system-ui, sans-serif';
    const lines = wrapLines(ctx, text, w - 70);
    const lineH = 70;
    const top = h * 0.55 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, n) => ctx.fillText(l, w / 2, top + n * lineH));
  }, 512, 760);
}

function bannerMaterial(text) {
  return textTexture((ctx, w, h) => {
    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 18;
    ctx.strokeRect(9, 9, w - 18, h - 18);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 84px system-ui, sans-serif';
    ctx.fillText(text, w / 2, h / 2 + 4);
  }, 1024, 140);
}

// --- Ciel, soleil, nuages -------------------------------------------------------
const space = new TransformNode('space', scene);     // suit le joueur : l'horizon reste à distance

const sky = MeshBuilder.CreateSphere('sky', { diameter: 700, segments: 10, sideOrientation: Mesh.BACKSIDE }, scene);
sky.parent = space;
paint(sky, '#7cc8ff', '#fff0d5');
const skyMat = paintedMat.clone('sky-mat');
skyMat.fogEnabled = false;
skyMat.emissiveColor = new Color3(0.5, 0.5, 0.5);
skyMat.disableLighting = false;
sky.material = skyMat;
sky.isPickable = false;

// Soleil doux avec halo
const sunMat = textTexture((ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  const halo = ctx.createRadialGradient(w / 2, h / 2, w * 0.15, w / 2, h / 2, w / 2);
  halo.addColorStop(0, 'rgba(255,190,70,0.55)');
  halo.addColorStop(1, 'rgba(255,190,70,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffb13a';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.14, 0, Math.PI * 2);
  ctx.fill();
}, 512, 512, { alpha: true });
sunMat.disableLighting = true;
sunMat.fogEnabled = false;
const sunPlane = MeshBuilder.CreatePlane('sun', { size: 80 }, scene);
sunPlane.parent = space;
sunPlane.position.set(40, 40, 230);
sunPlane.material = sunMat;

// Nuages en blocs blancs
const clouds = [];
for (let n = 0; n < 12; n++) {
  const cloud = new TransformNode('cloud-' + n, scene);
  cloud.parent = space;
  const base = [(Math.random() - 0.5) * 360, 45 + Math.random() * 40, 90 + Math.random() * 130];
  cloud.position.set(...base);
  const sz = 6 + Math.random() * 6;
  [[0, 0, 1], [sz * 0.55, -0.6, 0.7], [-sz * 0.55, -0.5, 0.65], [sz * 0.1, sz * 0.22, 0.55]].forEach(([x, y, k]) => {
    block('puff', cloud, [sz * k, sz * 0.36, sz * 0.5], [x, y, 0], '#ffffff', '#dde8f3', { bevel: 0.7 });
  });
  cloud.metadata = { baseX: base[0], speed: 0.4 + Math.random() * 0.6 };
  clouds.push(cloud);
}

// --- Sol : pelouse à damier, allée crème avec tirets orange, bordures douces --
const TRACK_LEN = FINISH_Z + 160;
const TRACK_MID = TRACK_LEN / 2 - 40;
const TRACK_W = 10.5;

function lawnMaterial() {
  const tex = new DynamicTexture('lawn', { width: 128, height: 128 }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = '#86d65a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#7acb4f';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillRect(64, 64, 64, 64);
  tex.update(true);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = 300 / 8;
  tex.vScale = TRACK_LEN / 8;
  const m = new StandardMaterial('lawn-mat', scene);
  m.diffuseTexture = tex;
  m.specularColor = Color3.Black();
  return m;
}

function pathMaterial() {
  const w = 512;
  const h = 256;
  const tex = new DynamicTexture('path', { width: w, height: h }, scene, true);
  const ctx = tex.getContext();
  ctx.fillStyle = '#f7e6c2';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#ecd4a2';
  ctx.lineWidth = 5;
  ctx.strokeRect(2, 2, w - 4, h - 4);
  ctx.fillStyle = ORANGE;
  for (const x of [-1.5, 1.5]) {
    const px = ((x + TRACK_W / 2) / TRACK_W) * w;
    for (let y = 0; y < h; y += 64) {
      ctx.beginPath();
      ctx.roundRect(px - 6, y + 6, 12, 38, 6);
      ctx.fill();
    }
  }
  tex.update(true);
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.vScale = TRACK_LEN / 4;
  const m = new StandardMaterial('path-mat', scene);
  m.diffuseTexture = tex;
  m.specularColor = new Color3(0.08, 0.08, 0.08);
  return m;
}

const lawn = MeshBuilder.CreateGround('lawn', { width: 300, height: TRACK_LEN }, scene);
lawn.position.set(0, 0, TRACK_MID);
lawn.material = lawnMaterial();

const path = MeshBuilder.CreateGround('path', { width: TRACK_W, height: TRACK_LEN }, scene);
path.position.set(0, 0.03, TRACK_MID);
path.material = pathMaterial();

// Bordures en gros blocs de chaque côté
for (const x of [-TRACK_W / 2 - 0.2, TRACK_W / 2 + 0.2]) {
  block('curb', null, [0.6, 0.45, TRACK_LEN], [x, 0.22, TRACK_MID], '#fff6e4', '#e8d3a6', { bevel: 0.12 });
}

// --- Modèles du décor (gabarits instanciés), même langage de blocs que l'étudiant ----
const templates = new TransformNode('templates', scene);
templates.position.y = -400;

function template(build) {
  const root = new TransformNode('tpl-' + ++uid, scene);
  root.parent = templates;
  build(root);
  return root;
}

function place(tpl, parent, { x = 0, y = 0, z = 0, rotY = 0, scale = 1 } = {}) {
  const r = tpl.instantiateHierarchy(parent);
  r.position.set(x, y, z);
  r.rotation.y = rotY;
  r.scaling.setAll(scale);
  return r;
}

const PAL = {
  creamT: '#fff4dc', creamB: '#e3c994', orT: '#ffb53f', orB: '#e07f00',
  navyT: '#3b4a86', navyB: '#252e58', glassT: '#bfe3fb', glassB: '#6fb0e0',
  woodT: '#a2683a', woodB: '#6c3f1f', leafT: '#8ad658', leafB: '#47a238',
  leaf2T: '#6fc24c', leaf2B: '#3a8d31', peachT: '#ffe2b8', peachB: '#e6bf86',
  poleT: '#59638c', poleB: '#3b4268', whiteT: '#ffffff', whiteB: '#dcd4c2',
  stoneT: '#ece0c6', stoneB: '#c9b890',
};

// Bibliothèque : colonnes, fronton en gradins, perron, grandes fenêtres
const tplLibrary = template((r) => {
  block('lib-base', r, [9, 4.6, 6.4], [0, 2.3, 0], PAL.creamT, PAL.creamB, { bevel: 0.16 });
  block('lib-roof', r, [9.8, 0.8, 7.2], [0, 5.0, 0], PAL.orT, PAL.orB, { bevel: 0.14 });
  block('ped-1', r, [5.2, 0.7, 0.9], [0, 5.75, 3.3], PAL.creamT, PAL.creamB, { bevel: 0.1 });
  block('ped-2', r, [3.7, 0.7, 0.9], [0, 6.45, 3.3], PAL.creamT, PAL.creamB, { bevel: 0.1 });
  block('ped-3', r, [2.2, 0.7, 0.9], [0, 7.15, 3.3], PAL.orT, PAL.orB, { bevel: 0.1 });
  for (const x of [-3.3, -1.1, 1.1, 3.3]) block('col', r, [0.7, 3.9, 0.7], [x, 2.25, 3.7], PAL.whiteT, PAL.whiteB, { bevel: 0.12 });
  block('steps-1', r, [6.8, 0.4, 1.5], [0, 0.2, 4.3], PAL.stoneT, PAL.stoneB, { bevel: 0.08 });
  block('steps-2', r, [5.8, 0.4, 1.0], [0, 0.6, 3.95], PAL.stoneT, PAL.stoneB, { bevel: 0.08 });
  block('door', r, [1.8, 2.7, 0.3], [0, 1.95, 3.25], PAL.navyT, PAL.navyB, { bevel: 0.08 });
  for (const x of [-3.7, 3.7]) for (const y of [1.9, 3.5]) block('win', r, [1.3, 1.2, 0.25], [x, y, 3.25], PAL.glassT, PAL.glassB, { bevel: 0.07 });
});

// Amphithéâtre : toit en gradins orange et bleu
const tplHall = template((r) => {
  block('hall-base', r, [8.4, 5, 6.2], [0, 2.5, 0], PAL.peachT, PAL.peachB, { bevel: 0.16 });
  block('hall-roof-1', r, [9, 0.8, 6.8], [0, 5.4, 0], PAL.orT, PAL.orB, { bevel: 0.12 });
  block('hall-roof-2', r, [6.2, 0.8, 4.8], [0, 6.2, 0], PAL.orT, PAL.orB, { bevel: 0.12 });
  block('hall-roof-3', r, [3.4, 0.9, 2.6], [0, 7.05, 0], PAL.navyT, PAL.navyB, { bevel: 0.12 });
  block('door', r, [1.7, 2.6, 0.3], [0, 1.3, 3.1], PAL.orT, PAL.orB, { bevel: 0.08 });
  for (const x of [-2.8, 2.8]) block('win', r, [1.4, 1.5, 0.25], [x, 2.8, 3.1], PAL.glassT, PAL.glassB, { bevel: 0.07 });
});

// Tour de l'horloge : le repère du campus
const tplTower = template((r) => {
  block('tower-base', r, [3.2, 10, 3.2], [0, 5, 0], PAL.creamT, PAL.creamB, { bevel: 0.16 });
  block('belfry', r, [3.8, 1.5, 3.8], [0, 10.7, 0], PAL.navyT, PAL.navyB, { bevel: 0.14 });
  block('tower-roof-1', r, [4.2, 0.7, 4.2], [0, 11.8, 0], PAL.orT, PAL.orB, { bevel: 0.12 });
  block('tower-roof-2', r, [2.8, 0.7, 2.8], [0, 12.5, 0], PAL.orT, PAL.orB, { bevel: 0.12 });
  block('tower-roof-3', r, [1.2, 1.0, 1.2], [0, 13.3, 0], PAL.orT, PAL.orB, { bevel: 0.1 });
  block('clock', r, [1.8, 1.8, 0.2], [0, 8.2, 1.65], PAL.whiteT, PAL.whiteB, { bevel: 0.08 });
  block('hand-1', r, [0.14, 0.7, 0.12], [0, 8.4, 1.8], '#2a2018', '#2a2018', { bevel: 0.02 });
  block('hand-2', r, [0.55, 0.14, 0.12], [0.22, 8.2, 1.8], '#2a2018', '#2a2018', { bevel: 0.02 });
  block('door', r, [1.2, 1.9, 0.2], [0, 0.95, 1.65], PAL.woodT, PAL.woodB, { bevel: 0.06 });
});

// Résidence haute, toit végétal, balcons orange
const tplDorm = template((r) => {
  block('dorm-base', r, [5.4, 8.5, 5.4], [0, 4.25, 0], PAL.peachT, PAL.peachB, { bevel: 0.16 });
  block('dorm-roof', r, [5.9, 0.6, 5.9], [0, 8.8, 0], PAL.leafT, PAL.leafB, { bevel: 0.12 });
  for (const y of [3.1, 5.6]) block('balcony', r, [4.4, 0.22, 0.8], [0, y, 2.9], PAL.orT, PAL.orB, { bevel: 0.05 });
  for (const row of [0, 1, 2]) for (const x of [-1.2, 1.2]) block('win', r, [1.1, 1.3, 0.22], [x, 2.2 + row * 2.5, 2.75], PAL.glassT, PAL.glassB, { bevel: 0.06 });
  block('door', r, [1.4, 1.7, 0.25], [0, 0.85, 2.75], PAL.navyT, PAL.navyB, { bevel: 0.06 });
});

// Laboratoire bas à verrières
const tplLab = template((r) => {
  block('lab-base', r, [10, 3.8, 5.6], [0, 1.9, 0], PAL.creamT, PAL.creamB, { bevel: 0.16 });
  block('lab-roof', r, [10.6, 0.5, 6.2], [0, 4.05, 0], PAL.navyT, PAL.navyB, { bevel: 0.1 });
  for (const x of [-2.6, 2.6]) block('skylight', r, [2.6, 1.2, 2.6], [x, 4.9, 0], PAL.glassT, PAL.glassB, { bevel: 0.1 });
  for (const x of [-3.2, 3.2]) block('win', r, [1.7, 1.3, 0.22], [x, 2.1, 2.8], PAL.glassT, PAL.glassB, { bevel: 0.07 });
  block('door', r, [1.7, 2.4, 0.25], [0, 1.2, 2.8], PAL.orT, PAL.orB, { bevel: 0.07 });
});
const buildings = [tplLibrary, tplHall, tplDorm, tplLab, tplLibrary, tplDorm];

// Arbres à étages de blocs, buissons carrés, banc, lampadaire
const tplTreeRound = template((r) => {
  block('trunk', r, [0.55, 2.4, 0.55], [0, 1.2, 0], PAL.woodT, PAL.woodB, { bevel: 0.08 });
  block('canopy-1', r, [3.0, 2.4, 3.0], [0, 3.5, 0], PAL.leafT, PAL.leafB, { bevel: 0.3 });
  block('canopy-2', r, [2.0, 1.6, 2.0], [0.2, 5.3, 0], PAL.leafT, PAL.leaf2B, { bevel: 0.25, rot: [0, 0.6, 0] });
});
const tplTreeCone = template((r) => {
  block('trunk', r, [0.5, 1.8, 0.5], [0, 0.9, 0], PAL.woodT, PAL.woodB, { bevel: 0.08 });
  block('tier-1', r, [3.2, 1.4, 3.2], [0, 2.5, 0], PAL.leaf2T, PAL.leaf2B, { bevel: 0.25 });
  block('tier-2', r, [2.4, 1.4, 2.4], [0, 3.8, 0], PAL.leaf2T, PAL.leaf2B, { bevel: 0.22, rot: [0, 0.5, 0] });
  block('tier-3', r, [1.5, 1.4, 1.5], [0, 5.1, 0], PAL.leaf2T, PAL.leaf2B, { bevel: 0.2 });
});
const tplBush = template((r) => { block('bush', r, [1.9, 1.1, 1.6], [0, 0.55, 0], PAL.leafT, PAL.leafB, { bevel: 0.25 }); });
const tplBench = template((r) => {
  block('seat', r, [2.3, 0.28, 0.9], [0, 0.62, 0], PAL.orT, PAL.orB, { bevel: 0.06 });
  block('back', r, [2.3, 0.8, 0.22], [0, 1.1, -0.36], PAL.orT, PAL.orB, { bevel: 0.06 });
  for (const x of [-0.9, 0.9]) block('leg', r, [0.26, 0.6, 0.7], [x, 0.3, 0], PAL.creamT, PAL.creamB, { bevel: 0.05 });
});
const tplLamp = template((r) => {
  block('pole', r, [0.22, 3.6, 0.22], [0, 1.8, 0], PAL.poleT, PAL.poleB, { bevel: 0.05 });
  block('head', r, [0.6, 0.6, 0.6], [0, 3.9, 0], '#fff3b0', '#ffc85a', { bevel: 0.12 });
});

// --- Éléments de gameplay (même style de blocs) -------------------------------
// Barrière = changer de voie · pile de livres = sauter · banderole = glisser dessous.
const tplBarrier = template((r) => {
  block('barrier', r, [2.3, 2.2, 0.8], [0, 1.1, 0], PAL.creamT, PAL.creamB, { bevel: 0.1 });
  block('stripe-1', r, [2.34, 0.42, 0.84], [0, 0.6, 0], PAL.orT, PAL.orB, { bevel: 0.08 });
  block('stripe-2', r, [2.34, 0.42, 0.84], [0, 1.6, 0], PAL.orT, PAL.orB, { bevel: 0.08 });
});
const tplBooks = template((r) => {
  block('book-1', r, [2.2, 0.3, 1.5], [0, 0.15, 0], PAL.orT, PAL.orB, { bevel: 0.06 });
  block('book-2', r, [2.0, 0.28, 1.35], [0.05, 0.44, 0], PAL.creamT, PAL.creamB, { bevel: 0.06, rot: [0, 0.12, 0] });
  block('book-3', r, [1.8, 0.28, 1.2], [-0.05, 0.72, 0], PAL.leafT, PAL.leafB, { bevel: 0.06, rot: [0, -0.1, 0] });
});
const tplBanner = template((r) => {
  for (const x of [-1.3, 1.3]) block('post', r, [0.26, 1.9, 0.26], [x, 0.95, 0], PAL.woodT, PAL.woodB, { bevel: 0.05 });
  block('beam', r, [3.0, 0.5, 0.3], [0, 1.55, 0], PAL.orT, PAL.orB, { bevel: 0.07 });
  block('beam-stripe', r, [3.04, 0.14, 0.34], [0, 1.55, 0], PAL.creamT, PAL.creamB, { bevel: 0.03 });
});
// Livre à ramasser : couverture jaune-orangé, tranche crème, signet bleu ; il flotte et tourne
const tplCoin = template((r) => {
  const book = new TransformNode('book', scene);
  book.parent = r;
  book.rotation.z = 0.18;
  block('cover', book, [0.78, 0.98, 0.3], [0, 0, 0], '#ffd44a', '#ff9a00', { bevel: 0.07 });
  block('pages', book, [0.66, 0.86, 0.26], [0.1, 0, 0.04], '#fffaf0', '#e8d6ae', { bevel: 0.03 });
  block('spine', book, [0.1, 1.0, 0.32], [-0.37, 0, 0], '#e07800', '#b85f00', { bevel: 0.03 });
  block('mark', book, [0.16, 0.5, 0.05], [0.12, -0.05, 0.17], '#3a4880', '#252e58', { bevel: 0.02 });
});

// --- Tronçons de décor recyclés ----------------------------------------------
const world = new TransformNode('world', scene);
const chunks = [];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function populateChunk(node) {
  for (const side of [-1, 1]) {
    const facing = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    for (let n = 0; n < 2; n++) {
      place(pick(buildings), node, { x: side * (17 + Math.random() * 3), z: 8 + n * 20, rotY: facing, scale: 1 + Math.random() * 0.25 });
    }
    if (Math.random() < 0.25) place(tplTower, node, { x: side * (26 + Math.random() * 4), z: 18, rotY: facing, scale: 1.2 });
    place(pick([tplTreeRound, tplTreeCone]), node, { x: side * (8.5 + Math.random() * 2), z: 4 + Math.random() * 6, scale: 0.9 + Math.random() * 0.4 });
    place(pick([tplTreeRound, tplTreeCone]), node, { x: side * (8.5 + Math.random() * 2), z: 24 + Math.random() * 8, scale: 0.9 + Math.random() * 0.4 });
    place(tplBush, node, { x: side * (6.8 + Math.random() * 1.2), z: 12 + Math.random() * 10, scale: 0.9 + Math.random() * 0.5 });
    place(tplBush, node, { x: side * (6.8 + Math.random() * 1.2), z: 30 + Math.random() * 8, scale: 0.9 + Math.random() * 0.5 });
    place(tplLamp, node, { x: side * 6.4, z: 18 });
    if (Math.random() < 0.5) place(tplBench, node, { x: side * 6.6, z: 34, rotY: facing });
  }
}

// --- Portes-réponses ----------------------------------
function pickOptions(q) {
  const wrong = q.choices.map((_, k) => k).filter((k) => k !== q.answer)
    .sort(() => Math.random() - 0.5).slice(0, 2);
  return [q.answer, ...wrong].sort(() => Math.random() - 0.5);   // picks[porte] = index de la réponse
}

const gates = [];
function buildGates() {
  QUESTIONS.forEach((q, i) => {
    const z = gateZ(i);
    const picks = pickOptions(q);
    const root = new TransformNode('gate-' + i, scene);

    // Trois portes : cadre crème, panneau orange coulissant
    const doors = LANES.map((x, lane) => {
      for (const dx of [-1.4, 1.4]) block('door-post', root, [0.4, 3.7, 0.55], [x + dx, 1.85, z], PAL.creamT, PAL.creamB, { bevel: 0.1 });
      block('door-top', root, [3.2, 0.45, 0.55], [x, 3.7, z], PAL.creamT, PAL.creamB, { bevel: 0.1 });
      const slab = block('door-slab', root, [2.5, 3.4, 0.3], [x, 1.72, z], PAL.orT, PAL.orB, { bevel: 0.1 });
      const face = MeshBuilder.CreatePlane(`face-${i}-${lane}`, { width: 2.4, height: 3.3 }, scene);
      face.parent = slab;
      face.position.set(0, 0, -0.17);
      face.material = doorFaceMaterial(LANE_LETTERS[lane], q.choices[picks[lane]]);
      return { slab, baseY: 1.72, status: 'closed' };
    });

    gates.push({ z, picks, correctLane: picks.indexOf(q.answer), doors });
  });
}

// --- Obstacles et livres ------------------------------------------------------
const hazards = [];
const coins = [];
const shuffled = () => [0, 1, 2].sort(() => Math.random() - 0.5);

function addHazard(type, lane, z) {
  const tpl = type === 'block' ? tplBarrier : type === 'low' ? tplBooks : tplBanner;
  const holder = place(tpl, world, { x: LANES[lane], z });
  hazards.push({ holder, type, x: LANES[lane], z, hit: false });
}

function addCoin(lane, z, y = 1) {
  const holder = place(tplCoin, world, { x: LANES[lane], y, z });
  coins.push({ holder, x: LANES[lane], y, z, taken: false });
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
    const from = i === 0 ? 30 : gateZ(i - 1) + 20;
    const to = gateZ(i) - STOP_BEFORE_GATE - 8;
    for (let z = from; z <= to; z += 13 + Math.random() * 4) addRow(z);
  });
}

// --- L'étudiant ---------------------------------------------------------------
const player = new TransformNode('player', scene);
const studentHolder = new TransformNode('student-holder', scene);
studentHolder.parent = player;
studentHolder.scaling.setAll(STUDENT_SCALE);
// Deux étudiants prêts à l'emploi ; celui qui est choisi à l'écran de sélection est affiché
const students = { boy: createStudent(scene, 'boy'), girl: createStudent(scene, 'girl') };
for (const st of Object.values(students)) {
  st.root.parent = studentHolder;
  st.shadow.parent = player;
  st.shadow.scaling.setAll(STUDENT_SCALE);
}
let student = students.boy;
function pickStudent(who) {
  state.who = who;
  student = students[who];
  for (const [k, st] of Object.entries(students)) { st.root.setEnabled(k === who); st.shadow.setEnabled(k === who); }
  if (window.__study) window.__study.student = student;
}

// --- Caméra -------------------------------------------------------------------
const camTarget = new TransformNode('cam-target', scene);
const camera = new ArcRotateCamera('cam', -Math.PI / 2, 1.18, 9.5, new Vector3(0, 1.2, 0), scene);
camera.lockedTarget = camTarget;
camera.lowerRadiusLimit = 9.5;
camera.upperRadiusLimit = 9.5;
camera.fov = 0.9;
camera.inputs.clear();

// --- Commandes ----------------------------------------------------------------
function act(action) {
  if (state.phase !== 'run' || state.paused) return;
  const grounded = state.jumpY <= 0.001;
  if (action === 'left' || action === 'right') {
    const next = action === 'left' ? Math.max(0, state.lane - 1) : Math.min(2, state.lane + 1);
    if (next !== state.lane) audio.sfx('swish');
    state.lane = next;
  } else if (action === 'jump' && grounded) {
    state.vy = JUMP_V;
    state.slideUntil = 0;
    audio.sfx('jump');
  } else if (action === 'slide') {
    if (grounded) state.slideUntil = state.elapsed + 0.8;
    else state.vy = -14;
    audio.sfx('slide');
  }
}

const KEY_ACTIONS = {
  arrowleft: 'left', q: 'left', a: 'left',
  arrowright: 'right', d: 'right',
  arrowup: 'jump', z: 'jump', w: 'jump', ' ': 'jump',
  arrowdown: 'slide', s: 'slide',
};

// Son : le navigateur exige un geste avant de jouer. Le bouton / la touche M coupent ou remettent le son.
const soundBtn = $('sound');
const refreshSoundBtn = () => {
  soundBtn.textContent = audio.muted ? '🔇' : '🔊';
  soundBtn.setAttribute('aria-label', audio.muted ? 'Activer le son' : 'Couper le son');
};
audio.onMute(refreshSoundBtn);
refreshSoundBtn();
soundBtn.addEventListener('click', () => { audio.unlock(); audio.toggleMute(); soundBtn.blur(); });
window.addEventListener('pointerdown', () => audio.unlock());

let selectKeys = () => {};
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  audio.unlock();
  if (state.phase === 'select') { if (!e.repeat) { e.preventDefault(); if (k === 'm') audio.toggleMute(); else selectKeys(k); } return; }
  if (k === 'm' && !e.repeat) { audio.toggleMute(); return; }
  if (state.phase === 'question') {
    // Réponse au clavier : 1, 2, 3 ou A, B, C
    const lane = ['1', '2', '3'].indexOf(k) >= 0 ? ['1', '2', '3'].indexOf(k) : ['a', 'b', 'c'].indexOf(k);
    if (lane >= 0 && !e.repeat) answer(lane);
    return;
  }
  if (k === 'p' || k === 'escape') {
    if (!e.repeat) togglePause();
    return;
  }
  const action = KEY_ACTIONS[k];
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
// Toute modification de la zone visible (rotation, barre d'adresse, clavier, zoom) recalcule la résolution du rendu.
new ResizeObserver(applyRenderScale).observe(canvas);
window.addEventListener('resize', applyRenderScale);
window.addEventListener('orientationchange', () => setTimeout(applyRenderScale, 250));
window.visualViewport?.addEventListener('resize', applyRenderScale);

// Ajustement dynamique : sous 38 images/s la résolution baisse de 15 % ; après 5 s à pleine cadence elle remonte de 10 %.
let warmup = 3;
let fastSecs = 0;
setInterval(() => {
  if (document.hidden || state.paused) return;
  if (warmup > 0) { warmup--; return; }
  const fps = engine.getFps();
  if (fps < 38 && render.quality > MIN_QUALITY) { render.quality = Math.max(MIN_QUALITY, render.quality * 0.85); fastSecs = 0; applyRenderScale(); }
  else if (fps > 57) { if (++fastSecs >= 5 && render.quality < 1) { render.quality = Math.min(1, render.quality * 1.1); fastSecs = 0; applyRenderScale(); } }
  else fastSecs = 0;
}, 1000);

function togglePause() {
  if (state.phase !== 'run') return;
  state.paused = !state.paused;
  pauseEl.hidden = !state.paused;
  audio.setPaused(state.paused);
}

// --- Questions en plein écran -------------------------------------------------
// La course s'arrête devant l'arche. Après la réponse, elle reprend : l'étudiant file vers la porte choisie.
const clock = { box: $('q-clock'), bar: $('q-timer-fill'), root: $('q-timer') };
let quizLeft = 0, quizTotal = 1, lastTick = 0;
function tickQuestion(dt) {
  quizLeft -= dt;
  const left = Math.max(0, quizLeft);
  clock.bar.style.width = `${(left / quizTotal) * 100}%`;
  const sec = Math.ceil(left);
  clock.box.textContent = String(sec);
  const low = left <= 5;
  clock.box.classList.toggle('low', low);
  clock.root.classList.toggle('low', low);
  if (low && sec !== lastTick && sec > 0 && sec <= 3) { lastTick = sec; audio.sfx('tick'); }
  if (quizLeft <= 0) timeUp();
}
/** Temps écoulé : l'étudiant fonce dans une mauvaise porte (compte comme une erreur). */
function timeUp() {
  const gate = gates[state.current];
  const wrong = [0, 1, 2].filter((l) => l !== gate.correctLane);
  state.timedOut = true;
  answer(wrong[Math.floor(Math.random() * wrong.length)]);
}

function startQuestion(i) {
  const q = QUESTIONS[i];
  const gate = gates[i];
  state.phase = 'question';
  quiz.meta.textContent = `Question ${i + 1} / ${QUESTIONS.length} · ${DIFF[diffOf(i)].name}`;
  quizTotal = quizLeft = answerSeconds(i);
  lastTick = 0;
  clock.box.textContent = String(quizTotal);
  clock.bar.style.width = '100%';
  quiz.text.textContent = q.question;
  quiz.options.replaceChildren(...gate.picks.map((choiceIndex, lane) => {
    const btn = document.createElement('button');
    btn.className = 'answer';
    const tag = document.createElement('span');
    tag.className = 'tag';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = LANE_LETTERS[lane];
    const where = document.createElement('span');
    where.textContent = LANE_NAMES[lane];
    tag.append(chip, where);
    const text = document.createElement('span');
    text.textContent = q.choices[choiceIndex];
    btn.append(tag, text);
    btn.addEventListener('click', () => answer(lane));
    return btn;
  }));
  banner.hidden = true;
  quiz.root.hidden = false;
  audio.setMode('quiz');
  audio.sfx('question');
}

function answer(lane) {
  if (state.phase !== 'question') return;
  state.chosenLane = lane;
  state.lane = lane;
  state.phase = 'answering';
  quiz.root.hidden = true;
  audio.setMode('run');
  audio.sfx('select');
}

// Arrivé aux portes, l'étudiant franchit la porte choisie : la bonne s'ouvre, l'erreur ouvre la correction.
function passGate(i) {
  const q = QUESTIONS[i];
  const gate = gates[i];
  const lane = state.chosenLane;
  const result = state.results[i];
  result.chosen = gate.picks[lane];
  state.current = i + 1;
  state.phase = 'run';

  if (lane === gate.correctLane) {
    gate.doors[lane].status = 'open';
    result.status = 'ok';
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    result.xp = 100 + 25 * Math.min(state.streak - 1, 4);
    state.xp += result.xp;
    state.boostUntil = state.elapsed + 1;
    state.reactPose = 'victory';
    state.reactUntil = state.elapsed + 1.3;
    audio.sfx('door');
    audio.sfx('correct');
    pop(`+${result.xp} XP`);
    if (state.streak >= 2) setTimeout(() => pop(`Série ×${state.streak} 🔥`, 'small'), 350);
    showBanner('ok', 'Porte ouverte !', q);
  } else {
    gate.doors[lane].status = 'bad';
    gate.doors[gate.correctLane].status = 'open';
    result.status = 'ko';
    state.streak = 0;
    state.lives--;
    state.shakeUntil = state.elapsed + 0.5;
    state.slowUntil = state.elapsed + 1.2;
    state.reactPose = 'fail';
    state.reactUntil = state.elapsed + 1.4;
    flash();
    audio.sfx('wrong');
    pop('−1 🛡️', 'ko');
    const late = state.timedOut;
    state.timedOut = false;
    showBanner('ko', `${late ? 'Temps écoulé !' : 'Porte fermée !'} Bonne réponse : ${LANE_LETTERS[gate.correctLane]} · ${q.choices[q.answer]}`, q, 8000);
    setTimeout(() => { gate.doors[lane].status = 'open'; }, 700);
    if (state.lives <= 0) {
      state.phase = 'over';
      audio.setMode('off');
      setTimeout(() => audio.sfx('gameover'), 700);
      setTimeout(() => showBilan(false), 3500);
    }
  }
  progress.ticks[i].classList.add(result.status);
  if (state.phase === 'run' && i + 1 < QUESTIONS.length && diffOf(i + 1) > diffOf(i)) setTimeout(() => pop('Ça accélère ! ⚡', 'small'), 900);
  updateHud();
}

// --- Obstacles et livres : règles ---------------------------------------------
function hitsHazard(h, feetY, sliding) {
  if (h.type === 'block') return true;
  if (h.type === 'low') return feetY < 0.85;
  return feetY + (sliding ? 0.7 : 1.75) > 1.3;
}

function crash(hazard) {
  hazard.hit = true;
  hazard.holder.setEnabled(false);
  state.xp = Math.max(0, state.xp - CRASH_XP);
  state.invulnUntil = state.elapsed + 1;
  state.slowUntil = state.elapsed + 0.7;
  state.shakeUntil = state.elapsed + 0.4;
  state.reactPose = 'fail';
  state.reactUntil = state.elapsed + 0.8;
  flash();
  audio.sfx('crash');
  pop(`−${CRASH_XP} XP`, 'ko small');
  showBanner('ko', 'Collision !', null, 1500);
  updateHud();
}

function collect(coin) {
  coin.taken = true;
  coin.holder.setEnabled(false);
  state.popUntil = state.elapsed + 0.18;               // petit rebond de joie
  state.coins++;
  audio.sfx('coin');
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
const XP_PER_LEVEL = 300;                                    // niveau de la partie ; le vrai niveau durable viendra du compte de l'étudiant
const levelOf = (xp) => 1 + Math.floor(xp / XP_PER_LEVEL);
const HEART = '<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21C5 15.5 2.5 12 2.5 8.6 2.5 5.9 4.6 4 7 4c1.9 0 3.7 1 5 2.9C13.300 5 15.100 4 17 4c2.400 0 4.500 1.900 4.500 4.600C21.500 12 19 15.500 12 21z"/></svg>';

/** Sticker flottant (+XP, série, protection perdue) : ce qui se passe doit se voir, pas se lire. */
function pop(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'pop ' + kind;
  el.textContent = text;
  $('pops').append(el);
  setTimeout(() => el.remove(), 1300);
}

function buildProgressTicks() {
  gates.forEach((gate, i) => {
    const node = document.createElement('span');
    node.className = 'node';
    node.textContent = String(i + 1);
    node.style.left = `${(gate.z / FINISH_Z) * 100}%`;
    progress.root.append(node);
    progress.ticks.push(node);
  });
  const end = document.createElement('span');
  end.className = 'node finish';
  end.textContent = '🎓';
  end.style.left = '100%';
  progress.root.append(end);
}

let shownXp = 0, shownMission = null, lastLives = LIVES, lastStreak = 0, lastCoins = 0;
function updateHud() {
  hud.lives.innerHTML = Array.from({ length: LIVES }, (_, n) => HEART.replace('class="heart"', `class="heart${n < state.lives ? '' : ' lost'}"`)).join('');
  if (state.lives < lastLives) hud.lives.children[state.lives]?.classList.add('hit');
  lastLives = state.lives;
  hud.streakN.textContent = `×${Math.max(state.streak, 0)}`;
  hud.streak.dataset.n = String(state.streak);
  hud.streak.hidden = state.streak < 2;                          // la série n'apparaît qu'à partir de 2 bonnes réponses de suite
  if (state.streak > lastStreak && state.streak > 1) { hud.streak.classList.remove('bump'); void hud.streak.offsetWidth; hud.streak.classList.add('bump'); }
  lastStreak = state.streak;
  hud.coins.textContent = String(state.coins);
  if (state.coins > lastCoins) { hud.books.classList.remove('bump'); void hud.books.offsetWidth; hud.books.classList.add('bump'); }
  lastCoins = state.coins;
  hud.xpNum.textContent = String(state.xp);
  shownXp = state.xp;

  const q = QUESTIONS[Math.min(state.current, QUESTIONS.length - 1)];
  const title = MISSIONS.find((m) => m.id === q.missionId).title;
  const [no, ...rest] = title.split(' · ');
  hud.no.textContent = rest.length ? no : 'Mission';
  hud.name.textContent = rest.length ? rest.join(' · ') : title;
  if (shownMission !== q.missionId) {
    const first = shownMission === null;
    shownMission = q.missionId;
    if (!first) showSplash(rest.length ? no : 'Mission', rest.length ? rest.join(' · ') : title);
  }
}

function showSplash(no, name) {
  const el = $('splash');
  $('splash-no').textContent = no;
  $('splash-name').textContent = name;
  el.hidden = true; void el.offsetWidth; el.hidden = false;
  audio.sfx('door');
  setTimeout(() => { el.hidden = true; }, 2300);
}

/** 3, 2, 1, GO ! avant le départ, avec le rappel des commandes. */
function countdown(done) {
  const box = $('countdown');
  const touch = matchMedia('(pointer: coarse)').matches;
  const ctrl = touch
    ? ['<span><b>Glisse</b> à gauche / droite : changer de voie</span>', '<span><b>Glisse</b> en haut : sauter · en bas : glisser</span>']
    : ['<span><b>← →</b> changer de voie</span>', '<span><b>↑</b> sauter</span>', '<span><b>↓</b> glisser</span>', '<span><b>P</b> pause</span>'];
  const seq = ['3', '2', '1', 'GO !'];
  box.classList.add('on');
  seq.forEach((t, i) => setTimeout(() => {
    const last = i === seq.length - 1;
    box.innerHTML = `<div class="num${last ? ' go' : ''}"></div><div class="ctrl">${ctrl.join('')}</div>`;
    box.firstChild.textContent = t;
    audio.sfx(last ? 'correct' : 'select');
    if (last) { done?.(); setTimeout(() => { box.classList.remove('on'); box.replaceChildren(); }, 800); }
  }, i * 800));
}

/** Confettis (canvas maison, aucune bibliothèque). Désactivés si l'étudiant a demandé moins d'animations. */
function confetti(power = 1) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = $('confetti');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr; c.height = innerHeight * dpr; c.hidden = false;
  const ctx = c.getContext('2d');
  const colors = ['#FF9F0A', '#FFC93C', '#2f9e5b', '#4d8dff', '#ff4d6d', '#ffffff'];
  const parts = [];
  const add = (x, y, vx, vy) => parts.push({ x, y, vx, vy, w: (6 + Math.random() * 7) * dpr, h: (4 + Math.random() * 6) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, col: colors[(Math.random() * colors.length) | 0], round: Math.random() < 0.25, ph: Math.random() * 6 });
  const burst = (fx, dir) => { for (let i = 0; i < 70 * power; i++) add(fx * c.width, c.height * 0.8, dir * (2 + Math.random() * 9) * dpr, -(9 + Math.random() * 14) * dpr); };
  burst(0.08, 1); burst(0.92, -1);
  const t0 = performance.now();
  let rained = 0;
  const frame = (now) => {
    const t = now - t0;
    if (t < 2200 && now - rained > 90) { rained = now; for (let i = 0; i < 6 * power; i++) add(Math.random() * c.width, -10 * dpr, (Math.random() - 0.5) * 2 * dpr, (2 + Math.random() * 3) * dpr); }
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of parts) {
      p.vy += 0.32 * dpr; p.vx *= 0.99; p.vy *= 0.992; p.x += p.vx + Math.sin(p.ph += 0.08) * 0.8 * dpr; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 7); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].y > c.height + 30) parts.splice(i, 1);
    if (t < 2200 || parts.length) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, c.width, c.height); c.hidden = true; }
  };
  requestAnimationFrame(frame);
}

const STAR = '<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.500l2.900 6 6.600.9-4.800 4.600 1.200 6.500L12 17.300 6.100 20.500l1.200-6.500L2.500 9.400l6.600-.9z"/></svg>';
const count = (el, to, ms) => {
  const t0 = performance.now();
  const tick = (t) => { const k = Math.min(1, (t - t0) / ms); el.textContent = String(Math.round(to * (1 - (1 - k) ** 3))); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};

/** Fin de partie : le serveur reçoit seulement les réponses choisies et recalcule XP, étoiles et rappels (Learn Engine). */
async function saveSession(victory) {
  if (!COURSE_ID) return null;
  const answers = QUESTIONS.map((q, i) => ({ q, r: state.results[i] })).filter((x) => x.r.status === 'ok' || x.r.status === 'ko')
    .map((x) => ({ questionId: x.q.id, chosen: x.r.chosen }));
  if (!answers.length) return null;
  try {
    const res = await fetch(`/api/study/courses/${encodeURIComponent(COURSE_ID)}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${localStorage.getItem('euniv:student') || ''}` },
      body: JSON.stringify({ scope: SCOPE, answers, coins: state.coins, finished: victory }),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

function applyServerResult(sr) {
  if (!sr) { $('save-note').textContent = 'Partie non enregistrée (connexion).'; return; }
  count($('bilan-xp'), sr.xp, 700);
  $('bilan-lvl').textContent = String(sr.level);
  $('bilan-lvfill').style.width = `${(sr.totalXp % XP_PER_LEVEL) / XP_PER_LEVEL * 100}%`;
  $('save-note').textContent = state.results.some((r) => r.status === 'ko') ? 'Les notions ratées reviendront en révision demain.' : '';
  if (sr.level > levelOf(sr.totalXp - sr.xp)) {
    const lu = $('levelup');
    lu.textContent = `⬆ Niveau ${sr.level} atteint !`;
    lu.hidden = false;
    audio.sfx('victory');
    confetti(1.2);
  }
  if (sr.unlocked?.length) {
    const u = $('unlock');
    u.textContent = `🔓 Mission ${sr.unlocked[0].slice(1)} débloquée !`;
    u.hidden = false;
  }
  if (sr.victory && sr.nextMissionId) {
    const nx = $('bilan-next');
    nx.textContent = `Mission ${sr.nextMissionId.slice(1)} →`;
    nx.hidden = false;
    nx.onclick = () => { location.href = `?course=${encodeURIComponent(COURSE_ID)}&mission=${sr.nextMissionId}`; };
  }
  window.__bilan = { ...window.__bilan, server: sr };
}

function showBilan(victory) {
  const total = QUESTIONS.length;
  const okN = state.results.filter((r) => r.status === 'ok').length;
  const ratio = okN / total;
  const stars = !victory ? 0 : ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : 1;
  bilan.root.classList.toggle('lost', !victory);
  $('bilan-badge').textContent = !victory ? '💪' : stars === 3 ? '🏆' : '🎓';
  bilan.title.textContent = !victory ? 'Presque !' : stars === 3 ? 'Parcours parfait !' : SCOPE === 'course' ? 'Diplôme obtenu !' : SCOPE === 'review' ? 'Révision terminée !' : 'Mission réussie !';
  ['levelup', 'unlock', 'bilan-next'].forEach((id) => { $(id).hidden = true; });
  bilan.sub.textContent = victory ? `${okN} bonnes réponses sur ${total}` : 'Plus de protection. Révise puis relance la course.';
  $('stars').innerHTML = STAR.repeat(3);
  [...$('stars').children].forEach((el, i) => {
    if (i < stars) setTimeout(() => { el.classList.add('on'); audio.sfx('coin'); }, 500 + i * 450);
    else el.classList.add('off');
  });
  count($('bilan-xp'), state.xp, 1400);
  const lv = levelOf(state.xp);
  $('bilan-lvl').textContent = String(lv);
  setTimeout(() => { $('bilan-lvfill').style.width = `${((state.xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100}%`; }, 300);
  // À revoir : seulement les questions ratées ou non atteintes, avec la bonne réponse et la source.
  const missed = QUESTIONS.map((q, i) => ({ q, r: state.results[i] })).filter((x) => x.r.status !== 'ok');
  $('review').hidden = missed.length === 0;
  $('review-sum').textContent = `À revoir (${missed.length})`;
  bilan.list.replaceChildren(...missed.map(({ q, r }) => {
    const li = document.createElement('li');
    if (r.status === 'ko') {
      // La bonne réponse, puis le passage du cours qui la prouve (page et citation), pour relire au bon endroit.
      li.className = 'ko';
      li.textContent = `${q.question} → ${q.choices[q.answer]}`;
      if (q.excerpt) {
        const src = document.createElement('small');
        src.textContent = `${q.source} · « ${q.excerpt} »`;
        li.append(src);
      }
    } else li.textContent = `${q.question} (non atteinte)`;
    return li;
  }));
  if (victory) setTimeout(() => confetti(stars === 3 ? 1.4 : 1), 350);
  bilan.root.hidden = false;
  window.__bilan = { stars, okN, total, xp: state.xp };
  $('save-note').textContent = COURSE_ID ? 'Enregistrement…' : '';
  saveSession(victory).then(applyServerResult);
}

bilan.restart.addEventListener('click', () => location.reload());
if (COURSE_ID) {
  const back = $('bilan-back');
  back.hidden = false;
  back.addEventListener('click', () => { location.href = `/etudiant/study/${COURSE_ID}`; });
}

// --- Boucle de jeu ------------------------------------------------------------
const ease = (cur, target, k) => cur + (target - cur) * k;
let camLift = 0;                       // pendant la question, on remonte le point visé : l'étudiant reste visible sous le panneau

function update() {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  if (state.paused || state.phase === 'loading') return;
  state.elapsed += dt;
  if (state.phase === 'question') tickQuestion(dt);

  if (state.phase === 'ready' && state.elapsed >= state.readyUntil) {
    state.phase = 'run';
    showBanner('ok', 'Évitez les obstacles, ramassez les livres !', null, 3000);
  }

  let pose = state.phase === 'run' || state.phase === 'answering' ? 'run' : 'idle';
  const hasGate = state.current < QUESTIONS.length;

  if (state.phase === 'run') {
    const stopZ = hasGate ? gateZ(state.current) - STOP_BEFORE_GATE : Infinity;
    const slowed = state.elapsed < state.slowUntil ? 0.5 : 1;
    const target = Math.min(MAX_SPEED, BASE_SPEED + DIFF[diffOf(state.current)].boost + Math.min(state.streak, 5) * 0.35);
    state.speed = ease(state.speed, target, Math.min(1, dt * 1.2));
    player.position.z += state.speed * slowed * dt;
    player.position.x = ease(player.position.x, LANES[state.lane], Math.min(1, dt * 12));

    const wasAir = state.jumpY > 0;
    state.jumpY += state.vy * dt;
    state.vy -= GRAVITY * dt;
    if (state.jumpY <= 0) {
      state.jumpY = 0;
      state.vy = 0;
      if (wasAir) { state.landUntil = state.elapsed + 0.2; audio.sfx('land'); }   // écrasement à l'atterrissage
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

    if (state.jumpY > 0) pose = 'jump';
    else if (sliding) pose = 'slide';

    // Arrêt devant l'arche : la question s'affiche en plein écran
    if (hasGate && player.position.z >= stopZ) {
      player.position.z = stopZ;
      player.position.x = LANES[1];
      state.lane = 1;
      pose = 'idle';
      startQuestion(state.current);
    } else if (!hasGate && player.position.z > FINISH_Z) {
      state.phase = 'finished';
      audio.setMode('off');
      audio.sfx('victory');
      showBanner('ok', 'Bienvenue à la remise des diplômes !', null);
      setTimeout(() => showBilan(true), 2800);
    }
  } else if (state.phase === 'answering') {
    // Après la réponse, la course reprend : l'étudiant file vers la porte choisie
    player.position.z += state.speed * 0.9 * dt;
    player.position.x = ease(player.position.x, LANES[state.chosenLane], Math.min(1, dt * 6));
    if (player.position.z >= gateZ(state.current)) passGate(state.current);
  }

  if (state.phase === 'finished') pose = 'victory';
  else if (state.phase === 'over') pose = 'fail';
  else if (state.elapsed < state.reactUntil) pose = state.reactPose;
  const fx = {
    vy: state.phase === 'run' ? state.vy : 0,
    bank: state.phase === 'run' ? Math.max(-1, Math.min(1, (LANES[state.lane] - player.position.x) / 2)) : 0,
    land: Math.max(0, (state.landUntil - state.elapsed) / 0.2),
    pop: Math.max(0, (state.popUntil - state.elapsed) / 0.18),
  };
  student.update(pose, dt, state.elapsed, fx);

  // Caméra : champ de vision élargi en accélération, secousse après une erreur
  const boosting = state.elapsed < state.boostUntil;
  camera.fov = ease(camera.fov, boosting ? 1.0 : 0.9, Math.min(1, dt * 6));
  camLift = ease(camLift, state.phase === 'question' ? 1.7 : 0, Math.min(1, dt * 4));
  const shaking = state.elapsed < state.shakeUntil;
  camTarget.position.set(
    player.position.x * 0.5 + (shaking ? (Math.random() - 0.5) * 0.4 : 0),
    CAM_LOOK_Y + camLift + player.position.y * 0.5 + (shaking ? (Math.random() - 0.5) * 0.4 : 0),
    player.position.z,
  );

  const pct = Math.min(100, (player.position.z / FINISH_Z) * 100);
  progress.fill.style.width = `${pct}%`;
  progress.runner.style.left = `${pct}%`;

  // Ciel et nuages suivent l'étudiant ; les tronçons dépassés repartent devant
  space.position.z = player.position.z;
  space.position.x = player.position.x * 0.2;
  for (const c of clouds) c.position.x = c.metadata.baseX + Math.sin(state.elapsed * 0.05 * c.metadata.speed) * 8;
  for (const c of chunks) {
    if (c.position.z < player.position.z - CHUNK * 2) c.position.z += CHUNK * CHUNKS;
  }
  for (const c of coins) {
    if (!c.taken && Math.abs(c.z - player.position.z) < 60) c.holder.rotation.y += dt * 3;
  }

  // Portes : la bonne coulisse vers le haut, la mauvaise tremble puis s'efface
  const k = Math.min(1, dt * 6);
  gates.forEach((gate) => gate.doors.forEach((door) => {
    const target = door.status === 'open' ? door.baseY + 3.9 : door.baseY;
    door.slab.position.y = ease(door.slab.position.y, target, k);
    door.slab.rotation.z = door.status === 'bad' ? Math.sin(state.elapsed * 35) * 0.04 : 0;
  }));
}

// --- Démarrage ----------------------------------------------------------------
for (let k = 0; k < CHUNKS; k++) {
  const node = new TransformNode('chunk-' + k, scene);
  node.position.z = -CHUNK * 2 + k * CHUNK;
  populateChunk(node);
  chunks.push(node);
}
L(86, 'Construction des portes de savoir…');
buildGates();
L(92, 'Construction du campus…');
buildCourse();
buildProgressTicks();
updateHud();
L(100, 'C’est prêt !');

// Choix du personnage : cartes cliquables (ou touches 1 / 2, flèches, Entrée). ?who=girl lance directement la course.
const WHO = ['boy', 'girl'];
const selectEl = $('select');
const cards = [...selectEl.querySelectorAll('[data-who]')];
let chosen = 'boy';
try { chosen = localStorage.getItem('study-who') || 'boy'; } catch { /* stockage indisponible */ }
if (!WHO.includes(chosen)) chosen = 'boy';
function highlight(who) {
  chosen = who;
  pickStudent(who);
  cards.forEach((c) => c.classList.toggle('on', c.dataset.who === who));
}
function startRun() {
  if (state.phase !== 'select') return;
  try { localStorage.setItem('study-who', chosen); } catch { /* ignoré */ }
  selectEl.hidden = true;
  state.phase = 'ready';
  state.elapsed = 0;
  state.readyUntil = 3.2;                                    // la course démarre au « GO ! »
  audio.setMode('run');
  showSplash($('mission-no').textContent, $('mission-name').textContent);   // annonce de la mission, puis 3-2-1-GO
  countdown();
}
cards.forEach((c) => c.addEventListener('click', () => { audio.unlock(); highlight(c.dataset.who); audio.sfx('swish'); }));
$('select-go').addEventListener('click', () => { audio.unlock(); startRun(); });
selectKeys = (k) => {
  if (k === '1') highlight('boy');
  else if (k === '2') highlight('girl');
  else if (k === 'arrowleft' || k === 'arrowright') highlight(chosen === 'boy' ? 'girl' : 'boy');
  else if (k === 'enter' || k === ' ') startRun();
};
const forced = new URLSearchParams(location.search).get('who');
highlight(WHO.includes(forced) ? forced : chosen);
state.phase = 'select';
selectEl.hidden = false;
if (WHO.includes(forced)) startRun();
// Poignée de test (navigateur local uniquement) : permet de vérifier l'habillage sans jouer toute la course.
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__study = { state, player, showBilan, answerSeconds, diffOf, QUESTIONS, render };
scene.onBeforeRenderObservable.add(update);
engine.runRenderLoop(() => scene.render());
