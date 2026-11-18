import {
  Engine, Scene, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, GlowLayer,
  ArcRotateCamera, MeshBuilder, StandardMaterial, DynamicTexture, Texture, TransformNode, TrailMesh,
} from '@babylonjs/core';
import { MISSIONS, QUESTIONS } from '../lessons.js';

// --- Réglages -----------------------------------------------------------------
const LIVES = 3;
const LANES = [-3.6, 0, 3.6];          // trois voies, comme dans un runner
const LANE_NAMES = ['voie gauche', 'voie centrale', 'voie droite'];
const LANE_COLORS = ['#ff2bd6', '#2be9ff', '#ff9a2b'];
const LANE_LETTERS = ['A', 'B', 'C'];

const BASE_SPEED = 8;                  // m/s, vitesse de départ
const MAX_SPEED = 11;                  // +0,3 m/s par bonne réponse
const ZONE_SPEED = 0.7;                // la fusée ralentit un peu en Zone Savoir pour laisser lire
const HOVER_Y = 1.1;                   // altitude de la fusée
const SLIDE_Y = 0.6;                   // altitude pendant une glissade
const JUMP_V = 9.5;
const GRAVITY = 28;
const CAM_LOOK_Y = 3.2;                // point visé au-dessus de la fusée : libère le bas de l'écran

// Parcours : une Zone Savoir tous les 160 m, avec la question affichée à l'approche
const zoneStart = (i) => 150 + i * 160;
const ZONE_LEN = 55;
const gateZ = (i) => zoneStart(i) + ZONE_LEN;     // les anneaux de réponse sont au bout de la zone
const QUESTION_LEAD = 25;              // la question s'affiche 25 m avant l'entrée de la zone
const FINISH_Z = gateZ(QUESTIONS.length - 1) + 40;

const COIN_XP = 10;
const CRASH_XP = 20;

const PALETTE = {
  space: '#0a0420',
  grid: '#2be9ff',
  railLeft: '#ff2bd6',
  railRight: '#2be9ff',
  wrong: '#ff3b5c',
  right: '#39ff7a',
  hull: '#f4f7ff',
  accent: '#ff2bd6',
  glass: '#2be9ff',
  flame: '#ffb347',
  block: '#ff3b5c',                    // à esquiver : changer de voie
  low: '#ff9a2b',                      // à sauter
  high: '#8a6bff',                     // à passer en glissant
  coin: '#ffe14a',
  zone: '#8a6bff',
  neon: ['#2be9ff', '#ff2bd6', '#ff9a2b', '#8a6bff', '#39ff7a'],
};

// --- État ---------------------------------------------------------------------
const state = {
  phase: 'run',                        // run · over · finished
  lives: LIVES,
  xp: 0,
  coins: 0,
  streak: 0,
  bestStreak: 0,
  current: 0,                          // index de la prochaine Zone Savoir
  lane: 1,
  speed: BASE_SPEED,
  zoneFactor: 1,
  elapsed: 0,
  vy: 0,
  jumpY: 0,
  slideUntil: 0,
  boostUntil: 0,
  shakeUntil: 0,
  spinUntil: 0,
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
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
const SPACE = Color3.FromHexString(PALETTE.space);
scene.clearColor = new Color4(SPACE.r, SPACE.g, SPACE.b, 1);
scene.fogMode = Scene.FOGMODE_LINEAR;
scene.fogStart = 90;
scene.fogEnd = 240;
scene.fogColor = SPACE;

const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.7), scene);
sun.diffuse = new Color3(1, 0.9, 1);
sun.intensity = 0.5;
const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
hemi.intensity = 0.6;
hemi.groundColor = new Color3(0.2, 0.1, 0.35);

// Halo autour de tout ce qui est lumineux (rails, anneaux, grille, flamme)
const glow = new GlowLayer('glow', scene, { blurKernelSize: 40 });
glow.intensity = 0.85;

let uid = 0;
// Matériau uni, avec une lueur propre (emissive entre 0 et 1)
function mat(hex, { emissive = 0, alpha = 1 } = {}) {
  const m = new StandardMaterial('mat-' + ++uid, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c;
  m.specularColor = Color3.Black();
  m.emissiveColor = c.scale(emissive);
  m.alpha = alpha;
  return m;
}

// Carte à texte (fond uni, bordure, texte centré)
function cardMaterial(text, { width, height, size, bg, fg, accent }) {
  const tex = new DynamicTexture('tex-' + ++uid, { width, height }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, width - 14, height - 14);
  ctx.font = `bold ${size}px system-ui`;
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2 + size * 0.05);
  tex.update();

  const m = new StandardMaterial('card-' + uid, scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.specularColor = Color3.Black();
  m.backFaceCulling = false;
  return m;
}

// Nébuleuse : halos transparents magenta, violet et cyan en arrière-plan
function nebulaMaterial() {
  const tex = new DynamicTexture('nebula', { width: 512, height: 256 }, scene, true);
  const ctx = tex.getContext();
  ctx.clearRect(0, 0, 512, 256);
  const cloud = (x, y, r, rgba) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 256);
  };
  cloud(130, 110, 230, 'rgba(255, 43, 214, 0.5)');
  cloud(380, 120, 210, 'rgba(43, 140, 255, 0.45)');
  cloud(260, 70, 170, 'rgba(138, 107, 255, 0.5)');
  cloud(250, 190, 150, 'rgba(43, 233, 255, 0.3)');
  tex.update(true);

  const m = new StandardMaterial('nebula-mat', scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.opacityTexture = tex;
  m.disableLighting = true;
  m.backFaceCulling = false;
  return m;
}

// Dalle de grille néon, répétée sur toute la piste
function gridMaterial(tileCount) {
  const size = 512;
  const tex = new DynamicTexture('grid', { width: size, height: size }, scene, true);
  const ctx = tex.getContext();
  const panelGlow = ctx.createLinearGradient(0, 0, size, size);
  panelGlow.addColorStop(0, '#150c3a');
  panelGlow.addColorStop(1, '#0a0724');
  ctx.fillStyle = panelGlow;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = PALETTE.grid;
  ctx.lineWidth = 6;
  ctx.shadowColor = PALETTE.grid;
  ctx.shadowBlur = 12;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  tex.update(true);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = tileCount.u;
  tex.vScale = tileCount.v;

  const m = new StandardMaterial('grid-mat', scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.specularColor = Color3.Black();
  m.disableLighting = true;
  return m;
}

// --- Piste ---------------------------------------------------------------------
const TRACK_LEN = FINISH_Z + 40;
const TRACK_MID = TRACK_LEN / 2 - 10;
const floor = MeshBuilder.CreateGround('floor', { width: 12, height: TRACK_LEN }, scene);
floor.position.z = TRACK_MID;
floor.material = gridMaterial({ u: 4, v: TRACK_LEN / 3 });

// Rails néon sur les bords, séparateurs de voies plus discrets
[[-5.8, PALETTE.railLeft, 0.35, 1], [5.8, PALETTE.railRight, 0.35, 1], [-1.8, '#ffffff', 0.08, 0.5], [1.8, '#ffffff', 0.08, 0.5]]
  .forEach(([x, color, w, emissive]) => {
    const rail = MeshBuilder.CreateBox('rail-' + x, { width: w, height: w, depth: TRACK_LEN }, scene);
    rail.position.set(x, w / 2 + 0.02, TRACK_MID);
    rail.material = mat(color, { emissive });
  });

// --- Zones Savoir et anneaux de réponse ---------------------------------------
// Chaque zone est balisée par une arche, au sol violet. Au bout, un anneau par voie :
// la fusée choisit sa réponse en le traversant, sans jamais s'arrêter.
function pickOptions(q) {
  const wrong = q.choices.map((_, k) => k).filter((k) => k !== q.answer)
    .sort(() => Math.random() - 0.5).slice(0, 2);
  return [q.answer, ...wrong].sort(() => Math.random() - 0.5);   // picks[voie] = index de la réponse
}

function setRingColor(ring, hex) {
  const c = Color3.FromHexString(hex);
  ring.torus.material.diffuseColor = c;
  ring.torus.material.emissiveColor = c;
  ring.disc.material.diffuseColor = c;
  ring.disc.material.emissiveColor = c;
}

const gates = QUESTIONS.map((q, i) => {
  const start = zoneStart(i);
  const z = gateZ(i);
  const picks = pickOptions(q);

  // Sol de la zone
  const zoneFloor = MeshBuilder.CreateGround('zone-floor-' + i, { width: 11.6, height: ZONE_LEN }, scene);
  zoneFloor.position.set(0, 0.03, (start + z) / 2);
  zoneFloor.material = mat(PALETTE.zone, { emissive: 0.5, alpha: 0.22 });

  // Arche d'entrée
  const archMat = mat(PALETTE.zone, { emissive: 1 });
  for (const x of [-5.8, 5.8]) {
    const post = MeshBuilder.CreateBox(`arch-post-${i}-${x}`, { width: 0.4, height: 5, depth: 0.4 }, scene);
    post.position.set(x, 2.5, start);
    post.material = archMat;
  }
  const beam = MeshBuilder.CreateBox('arch-beam-' + i, { width: 12, height: 0.4, depth: 0.4 }, scene);
  beam.position.set(0, 5, start);
  beam.material = archMat;
  const sign = MeshBuilder.CreatePlane('arch-sign-' + i, { width: 7, height: 1.4 }, scene);
  sign.position.set(0, 6, start);
  sign.material = cardMaterial(`ZONE SAVOIR · ${i + 1}/${QUESTIONS.length}`, {
    width: 1024, height: 200, size: 90, bg: '#0b0724', fg: '#ffffff', accent: PALETTE.zone,
  });

  // Un anneau par voie
  const rings = LANES.map((x, lane) => {
    const color = LANE_COLORS[lane];
    const torus = MeshBuilder.CreateTorus(`ring-${i}-${lane}`, { diameter: 3.2, thickness: 0.45, tessellation: 48 }, scene);
    torus.rotation.x = Math.PI / 2;
    torus.position.set(x, 1.6, z);
    torus.material = mat(color, { emissive: 1 });

    const disc = MeshBuilder.CreateDisc(`disc-${i}-${lane}`, { radius: 1.5, tessellation: 48 }, scene);
    disc.position.set(x, 1.6, z);
    disc.material = mat(color, { emissive: 1, alpha: 0.14 });
    disc.material.backFaceCulling = false;

    const tag = MeshBuilder.CreatePlane(`tag-${i}-${lane}`, { width: 1.3, height: 1.3 }, scene);
    tag.position.set(x, 4.3, z);
    tag.material = cardMaterial(LANE_LETTERS[lane], {
      width: 256, height: 256, size: 160, bg: '#0b0724', fg: '#ffffff', accent: color,
    });

    return { torus, disc, tag, status: 'idle', scale: 1 };
  });

  return { start, z, picks, correctLane: picks.indexOf(q.answer), rings };
});

// Station d'arrivée : grand anneau lumineux
const station = MeshBuilder.CreateTorus('station', { diameter: 11, thickness: 0.7, tessellation: 64 }, scene);
station.rotation.x = Math.PI / 2;
station.position.set(0, 5, FINISH_Z + 8);
station.material = mat(PALETTE.right, { emissive: 1 });

// --- Obstacles et pièces ------------------------------------------------------
// Trois types, trois couleurs : rouge = changer de voie, orange = sauter, violet = glisser.
const HAZARD_TYPES = {
  block: { size: { width: 2.4, height: 2.6, depth: 1.2 }, y: 1.3, color: PALETTE.block },
  low: { size: { width: 3, height: 0.9, depth: 0.7 }, y: 0.45, color: PALETTE.low },
  high: { size: { width: 3.2, height: 0.6, depth: 0.7 }, y: 1.65, color: PALETTE.high },
};
const hazardBases = {};
for (const [type, def] of Object.entries(HAZARD_TYPES)) {
  const base = MeshBuilder.CreateBox('hazard-' + type, def.size, scene);
  base.material = mat(def.color, { emissive: 0.8 });
  base.position.y = -100;                 // modèle des instances, hors de vue
  hazardBases[type] = base;
}
const coinBase = MeshBuilder.CreateSphere('coin', { diameter: 0.7, segments: 12 }, scene);
coinBase.material = mat(PALETTE.coin, { emissive: 1 });
coinBase.position.y = -100;

const hazards = [];
const coins = [];
const shuffled = () => [0, 1, 2].sort(() => Math.random() - 0.5);

function addHazard(type, lane, z) {
  const mesh = hazardBases[type].createInstance(`${type}-${hazards.length}`);
  mesh.position.set(LANES[lane], HAZARD_TYPES[type].y, z);
  hazards.push({ mesh, type, x: LANES[lane], z, hit: false });
}

function addCoin(lane, z, y = HOVER_Y) {
  const mesh = coinBase.createInstance('coin-' + coins.length);
  mesh.position.set(LANES[lane], y, z);
  coins.push({ mesh, x: LANES[lane], y, z, taken: false });
}

const coinLine = (lane, z) => { for (let n = 0; n < 4; n++) addCoin(lane, z + n * 2); };
// Arc de pièces au-dessus d'une barrière : elles se ramassent en sautant
const coinArc = (lane, z) => { for (let n = 0; n < 5; n++) addCoin(lane, z - 4 + n * 2, 1.1 + Math.sin((n / 4) * Math.PI) * 1.5); };

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

// Entre deux zones : un rang d'obstacles tous les 12 à 16 m, sans jamais empiéter sur une zone
QUESTIONS.forEach((_, i) => {
  const from = i === 0 ? 30 : gateZ(i - 1) + 25;
  const to = zoneStart(i) - QUESTION_LEAD - 12;
  for (let z = from; z <= to; z += 12 + Math.random() * 4) addRow(z);
});

// --- Décor : étoiles, cristaux, montagnes, lignes de vitesse ------------------
const starMats = ['#ffffff', '#ffe9a8', '#a8d8ff', '#ffb3d9'].map((c) => mat(c, { emissive: 1 }));
const stars = [];
for (let n = 0; n < 260; n++) {
  const s = MeshBuilder.CreateSphere('star-' + n, { diameter: 0.08 + Math.random() * 0.22, segments: 4 }, scene);
  s.position.set((Math.random() - 0.5) * 140, 4 + Math.random() * 60, -20 + Math.random() * 170);
  s.material = starMats[n % starMats.length];
  stars.push(s);
}

// Cristaux flottants de chaque côté de la piste
const crystalMats = PALETTE.neon.map((c) => mat(c, { emissive: 0.9, alpha: 0.85 }));
const crystals = [];
for (let n = 0; n < 45; n++) {
  const c = MeshBuilder.CreatePolyhedron('crystal-' + n, { type: 1, size: 0.5 + Math.random() * 0.9 }, scene);
  const baseY = 2 + Math.random() * 14;
  c.position.set((Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 30), baseY, -20 + Math.random() * 170);
  c.material = crystalMats[n % crystalMats.length];
  c.metadata = { baseY, phase: Math.random() * 6 };
  crystals.push(c);
}

// Montagnes anguleuses qui émergent du vide
const mountainMats = ['#2b1268', '#4a1a86'].map((c) => mat(c, { emissive: 0.35 }));
const mountains = [];
for (let n = 0; n < 36; n++) {
  const h = 6 + Math.random() * 16;
  const m = MeshBuilder.CreateCylinder('mountain-' + n, {
    height: h, diameterTop: 0, diameterBottom: 5 + Math.random() * 7, tessellation: 4,
  }, scene);
  m.position.set((Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 40), h / 2 - 4, -20 + Math.random() * 170);
  m.rotation.y = Math.random() * Math.PI;
  m.material = mountainMats[n % mountainMats.length];
  mountains.push(m);
}

// Fines traînées sur les côtés : elles défilent et donnent la sensation de vitesse
const lineMats = [mat('#bfe4ff', { emissive: 1, alpha: 0.5 }), mat('#ffc2f2', { emissive: 1, alpha: 0.5 })];
const speedLines = [];
for (let n = 0; n < 60; n++) {
  const line = MeshBuilder.CreateBox('speed-' + n, { width: 0.04, height: 0.04, depth: 4 }, scene);
  const side = Math.random() < 0.5 ? -1 : 1;
  line.position.set(side * (8 + Math.random() * 6), 0.3 + Math.random() * 7, -5 + Math.random() * 70);
  line.material = lineMats[n % 2];
  speedLines.push(line);
}

// Ce groupe suit la fusée : planètes et nébuleuse restent loin à l'horizon
const space = new TransformNode('space', scene);

const bigPlanet = MeshBuilder.CreateSphere('planet-main', { diameter: 18, segments: 32 }, scene);
bigPlanet.parent = space;
bigPlanet.position.set(-34, 20, 70);
bigPlanet.material = mat('#3b2a9a', { emissive: 0.3 });

const atmosphere = MeshBuilder.CreateSphere('planet-atmosphere', { diameter: 20.5, segments: 32 }, scene);
atmosphere.parent = bigPlanet;
atmosphere.material = mat('#2be9ff', { emissive: 0.7, alpha: 0.16 });

const bluePlanet = MeshBuilder.CreateSphere('planet-blue', { diameter: 10, segments: 32 }, scene);
bluePlanet.parent = space;
bluePlanet.position.set(42, 12, 110);
bluePlanet.material = mat('#ff7ad9', { emissive: 0.3 });

const ringed = MeshBuilder.CreateSphere('planet-ringed', { diameter: 6, segments: 24 }, scene);
ringed.parent = space;
ringed.position.set(-12, 30, 130);
ringed.material = mat('#d9c7ff', { emissive: 0.25 });

const planetRing = MeshBuilder.CreateTorus('planet-ring', { diameter: 13, thickness: 0.6, tessellation: 64 }, scene);
planetRing.parent = ringed;
planetRing.rotation.x = Math.PI / 2.3;
planetRing.material = mat('#f2e6ff', { emissive: 0.4 });

const nebula = MeshBuilder.CreatePlane('nebula', { width: 420, height: 200 }, scene);
nebula.parent = space;
nebula.position.set(0, 60, 150);
nebula.material = nebulaMaterial();
glow.addExcludedMesh(nebula);
const planets = [bigPlanet, bluePlanet, ringed];

// --- Fusée (joueur) -----------------------------------------------------------
// Construite le long de l'axe +Y puis orientée vers +Z (sens de la course)
const player = new TransformNode('player', scene);
player.position.y = HOVER_Y;
const bob = new TransformNode('bob', scene);
bob.parent = player;
const rocket = new TransformNode('rocket', scene);
rocket.parent = bob;
rocket.rotation.x = Math.PI / 2;
rocket.scaling.setAll(1.25);

const hullMat = mat(PALETTE.hull, { emissive: 0.25 });
const accentMat = mat(PALETTE.accent, { emissive: 0.7 });
const glassMat = mat(PALETTE.glass, { emissive: 1 });
const flameMat = mat(PALETTE.flame, { emissive: 1 });

function part(mesh, { parent = rocket, at, material, rotY } = {}) {
  mesh.parent = parent;
  if (at) mesh.position.copyFrom(at);
  if (material) mesh.material = material;
  if (rotY !== undefined) mesh.rotation.y = rotY;
  return mesh;
}

part(MeshBuilder.CreateCylinder('rocket-body', { height: 1.3, diameter: 0.5, tessellation: 24 }, scene),
  { material: hullMat });
part(MeshBuilder.CreateCylinder('rocket-nose', { height: 0.55, diameterTop: 0, diameterBottom: 0.5, tessellation: 24 }, scene),
  { at: new Vector3(0, 0.925, 0), material: accentMat });
for (let n = 0; n < 3; n++) {
  const angle = (n * 2 * Math.PI) / 3;
  part(MeshBuilder.CreateBox('rocket-fin-' + n, { width: 0.5, height: 0.55, depth: 0.06 }, scene),
    { at: new Vector3(Math.cos(angle) * 0.28, -0.4, Math.sin(angle) * 0.28), material: accentMat, rotY: -angle });
}
for (const x of [-0.26, 0.26]) {
  part(MeshBuilder.CreateSphere('rocket-window-' + x, { diameter: 0.2, segments: 12 }, scene),
    { at: new Vector3(x, 0.25, 0), material: glassMat });
}
const flame = part(MeshBuilder.CreateCylinder('rocket-flame', { height: 0.8, diameterTop: 0.36, diameterBottom: 0, tessellation: 16 }, scene),
  { at: new Vector3(0, -1.05, 0), material: flameMat });

// Traînée lumineuse derrière la flamme
const trail = new TrailMesh('trail', flame, scene, 0.3, 60, true);
trail.material = mat('#2be9ff', { emissive: 1, alpha: 0.45 });

// --- Caméra -------------------------------------------------------------------
// Caméra derrière la fusée, qui suit à moitié ses changements de voie
const camTarget = new TransformNode('cam-target', scene);
const camera = new ArcRotateCamera('cam', -Math.PI / 2, 1.15, 15, new Vector3(0, 1.2, 0), scene);
camera.lockedTarget = camTarget;
camera.lowerRadiusLimit = 15;
camera.upperRadiusLimit = 15;
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
    if (grounded) state.slideUntil = state.elapsed + 0.7;
    else state.vy = -16;                // en l'air : plongeon
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

// --- Questions : une Zone Savoir tous les 160 m -------------------------------
function showQuestion(i) {
  const q = QUESTIONS[i];
  const gate = gates[i];
  panel.meta.textContent = `Zone Savoir ${i + 1} / ${QUESTIONS.length} · ${q.source}`;
  panel.text.textContent = q.question;
  panel.options.replaceChildren(...gate.picks.map((choiceIndex, lane) => {
    const opt = document.createElement('div');
    opt.className = 'opt';
    opt.style.setProperty('--c', LANE_COLORS[lane]);
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

// La fusée traverse un anneau : la voie occupée est la réponse choisie.
function passGate(i) {
  const q = QUESTIONS[i];
  const gate = gates[i];
  const lane = LANES.reduce((best, x, l) => (Math.abs(player.position.x - x) < Math.abs(player.position.x - LANES[best]) ? l : best), 0);
  const result = state.results[i];
  result.chosen = gate.picks[lane];

  gate.rings.forEach((ring, l) => { if (l !== lane) ring.status = 'dim'; });
  state.current = i + 1;
  hideQuestion();

  if (lane === gate.correctLane) {
    gate.rings[lane].status = 'good';
    setRingColor(gate.rings[lane], PALETTE.right);
    result.status = 'ok';
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    result.xp = 100 + 25 * Math.min(state.streak - 1, 4);
    state.xp += result.xp;
    state.speed = Math.min(MAX_SPEED, state.speed + 0.3);
    state.boostUntil = state.elapsed + 1;
    showBanner('ok', `Bonne voie ! +${result.xp} XP`, q);
  } else {
    gate.rings[lane].status = 'bad';
    setRingColor(gate.rings[lane], PALETTE.wrong);
    gate.rings[gate.correctLane].status = 'reveal';
    setRingColor(gate.rings[gate.correctLane], PALETTE.right);
    result.status = 'ko';
    state.streak = 0;
    state.lives--;
    state.shakeUntil = state.elapsed + 0.5;
    state.spinUntil = state.elapsed + 0.7;
    flash();
    showBanner('ko', `Raté, −1 protection ! Bonne réponse : ${LANE_LETTERS[gate.correctLane]} · ${q.choices[q.answer]}`, q, 8000);
    if (state.lives <= 0) {
      state.phase = 'over';
      setTimeout(() => showBilan(false), 3500);
    }
  }
  progress.ticks[i].classList.add(result.status);
  updateHud();
}

// --- Obstacles et pièces ------------------------------------------------------
function hitsHazard(h, y) {
  if (h.type === 'block') return true;
  if (h.type === 'low') return y - 0.4 < 0.9;     // on passe en sautant
  return y + 0.4 > 1.35;                           // barre haute : on passe en glissant
}

function crash(hazard) {
  hazard.hit = true;
  hazard.mesh.setEnabled(false);
  state.xp = Math.max(0, state.xp - CRASH_XP);
  state.invulnUntil = state.elapsed + 1;
  state.slowUntil = state.elapsed + 0.6;
  state.shakeUntil = state.elapsed + 0.4;
  state.spinUntil = state.elapsed + 0.7;
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
gates.forEach((gate) => {
  const tick = document.createElement('span');
  tick.className = 'tick';
  tick.style.left = `${(gate.z / FINISH_Z) * 100}%`;
  progress.root.append(tick);
  progress.ticks.push(tick);
});

function updateHud() {
  hud.lives.replaceChildren(...Array.from({ length: LIVES }, (_, n) => {
    const heart = document.createElement('span');
    heart.className = 'heart' + (n < state.lives ? '' : ' lost');
    heart.textContent = '♥';
    return heart;
  }));
  const streak = state.streak > 1 ? ` · 🔥 série ×${state.streak}` : '';
  hud.stats.textContent = `XP ${state.xp}${streak} · ✦ ${state.coins}`;
  const q = QUESTIONS[Math.min(state.current, QUESTIONS.length - 1)];
  hud.title.textContent = MISSIONS.find((m) => m.id === q.missionId).title;
}

function showBilan(victory) {
  bilan.title.textContent = victory ? 'Mission accomplie 🚀' : 'Fusée hors service';
  bilan.score.textContent = `XP ${state.xp} · Protections ${state.lives}/${LIVES} · Pièces ${state.coins} · Meilleure série ×${state.bestStreak}`;
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
  if (state.paused) return;
  state.elapsed += dt;
  const running = state.phase === 'run';

  if (running) {
    const hasGate = state.current < QUESTIONS.length;
    const zs = hasGate ? zoneStart(state.current) : Infinity;
    const gz = hasGate ? gateZ(state.current) : Infinity;

    // La question apparaît à l'approche de la zone et disparaît après les anneaux
    if (hasGate && player.position.z >= zs - QUESTION_LEAD && shownQuestion !== state.current) showQuestion(state.current);

    // Ralentissement doux dans la zone, pour laisser le temps de lire
    const inZone = hasGate && player.position.z >= zs - 5;
    state.zoneFactor += ((inZone ? ZONE_SPEED : 1) - state.zoneFactor) * Math.min(1, dt * 3);
    const stumble = state.elapsed < state.slowUntil ? 0.5 : 1;
    player.position.z += state.speed * state.zoneFactor * stumble * dt;

    // Changement de voie
    player.position.x += (LANES[state.lane] - player.position.x) * Math.min(1, dt * 14);

    // Saut et glissade
    state.jumpY += state.vy * dt;
    state.vy -= GRAVITY * dt;
    if (state.jumpY <= 0) { state.jumpY = 0; state.vy = 0; }
    const sliding = state.elapsed < state.slideUntil && state.jumpY === 0;
    player.position.y = (sliding ? SLIDE_Y : HOVER_Y) + state.jumpY;

    // Collisions et pièces
    for (const h of hazards) {
      if (!h.hit && state.elapsed >= state.invulnUntil
        && Math.abs(h.z - player.position.z) < 1 && Math.abs(h.x - player.position.x) < 1.5
        && hitsHazard(h, player.position.y)) crash(h);
    }
    for (const c of coins) {
      if (!c.taken && Math.abs(c.z - player.position.z) < 1 && Math.abs(c.x - player.position.x) < 1.2
        && Math.abs(c.y - player.position.y) < 0.9) collect(c);
    }

    if (hasGate && player.position.z >= gz) {
      passGate(state.current);
    } else if (!hasGate && player.position.z > FINISH_Z) {
      state.phase = 'finished';
      showBanner('ok', 'Bienvenue à la station !', null);
      setTimeout(() => showBilan(true), 2000);
    }
  }

  // Attitude de la fusée : cabrage au saut, piqué à la glissade, inclinaison dans les virages, tonneau au choc
  const sliding = state.elapsed < state.slideUntil && state.jumpY === 0;
  const spin = state.spinUntil - state.elapsed;
  if (spin > 0) {
    bob.rotation.z = (1 - spin / 0.7) * Math.PI * 2;
  } else {
    if (bob.rotation.z > 1) bob.rotation.z = 0;
    bob.rotation.z += ((player.position.x - LANES[state.lane]) * 0.15 - bob.rotation.z) * Math.min(1, dt * 8);
  }
  const pitch = sliding ? 0.45 : -state.vy * 0.035;
  bob.rotation.x += (pitch - bob.rotation.x) * Math.min(1, dt * 12);
  bob.position.y = Math.sin(state.elapsed * 2.2) * 0.05;

  // Flamme plus longue à l'accélération
  const boosting = state.elapsed < state.boostUntil;
  const burn = (boosting ? 1.8 : 1) * (running ? 1 : 0.4);
  flame.scaling.y = burn * (1 + 0.25 * Math.sin(state.elapsed * 25));
  flame.scaling.x = flame.scaling.z = burn * (1 + 0.12 * Math.sin(state.elapsed * 30));

  // Caméra : champ de vision élargi en accélération, secousse après un choc
  camera.fov += ((boosting ? 1.0 : 0.8) - camera.fov) * Math.min(1, dt * 6);
  const shaking = state.elapsed < state.shakeUntil;
  camTarget.position.set(
    player.position.x * 0.45 + (shaking ? (Math.random() - 0.5) * 0.5 : 0),
    CAM_LOOK_Y + (shaking ? (Math.random() - 0.5) * 0.5 : 0),
    player.position.z,
  );

  // Barre de progression
  progress.fill.style.width = `${Math.min(100, (player.position.z / FINISH_Z) * 100)}%`;

  // Le fond suit la fusée ; décor, étoiles et lignes de vitesse sont recyclés devant elle
  space.position.z = player.position.z;
  planets.forEach((p, n) => { p.rotation.y += dt * (0.03 + n * 0.01); });
  for (const s of stars) {
    if (s.position.z < player.position.z - 25) s.position.z += 170;
  }
  for (const l of speedLines) {
    if (l.position.z < player.position.z - 6) l.position.z += 70;
  }
  for (const c of crystals) {
    c.rotation.y += dt * 0.8;
    c.rotation.x += dt * 0.4;
    c.position.y = c.metadata.baseY + Math.sin(state.elapsed * 1.5 + c.metadata.phase) * 0.5;
    if (c.position.z < player.position.z - 25) c.position.z += 170;
  }
  for (const m of mountains) {
    if (m.position.z < player.position.z - 30) m.position.z += 170;
  }
  for (const c of coins) {
    if (!c.taken && Math.abs(c.z - player.position.z) < 80) c.mesh.rotation.y += dt * 3;
  }

  // Animation des anneaux de réponse
  const ease = Math.min(1, dt * 6);
  gates.forEach((gate) => gate.rings.forEach((ring, n) => {
    const hit = ring.status === 'good' || ring.status === 'bad';
    const target = hit ? 1.35 : ring.status === 'reveal' ? 1.15 : 1 + 0.04 * Math.sin(state.elapsed * 3 + n);
    ring.scale += (target - ring.scale) * ease;
    ring.torus.scaling.setAll(ring.scale);
    ring.disc.scaling.setAll(ring.scale);
    const dim = ring.status === 'dim';
    ring.torus.material.alpha += ((dim ? 0.25 : 1) - ring.torus.material.alpha) * ease;
    ring.disc.material.alpha += ((hit ? 0.4 : dim ? 0.03 : 0.14) - ring.disc.material.alpha) * ease;
  }));
}

// --- Démarrage ----------------------------------------------------------------
updateHud();
showBanner('ok', 'C’est parti ! Évitez les obstacles et ramassez les pièces.', null);
scene.onBeforeRenderObservable.add(update);
engine.runRenderLoop(() => scene.render());
