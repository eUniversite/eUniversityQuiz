import {
  Color3, MeshBuilder, StandardMaterial, TransformNode, Mesh, VertexData, DynamicTexture,
} from '@babylonjs/core';

// Étudiant eUniversité « bas poly » : quelques gros blocs chanfreinés aux faces plates,
// mains et chaussures carrées, chapeau massif. Animation nerveuse (étirement, écrasement, virages).
// Même interface que student.js : createStudent(scene) -> { root, update, shadow }.
const ORANGE = '#FFA000';

// --- Bloc chanfreiné : grandes faces plates, arêtes biseautées, évasement optionnel ---
function boxGeometry(w, h, d, bevel, flare) {
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  const b = Math.min(bevel, hx * 0.45, hy * 0.45, hz * 0.45);
  const H = [hx, hy, hz];
  const pos = [];
  const nor = [];
  const idx = [];
  const quad = (pts, n) => {
    const base = pos.length / 3;
    for (const p of pts) {
      // évasement : le bas est plus large que le haut
      const t = (p[1] + hy) / (2 * hy);
      const s = flare + (1 - flare) * t;
      pos.push(p[0] * s, p[1], p[2] * s);
      nor.push(...n);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let a = 0; a < 3; a++) {
    const bb = (a + 1) % 3;
    const c = (a + 2) % 3;
    for (const s of [-1, 1]) {
      const n = [0, 0, 0];
      n[a] = s;
      quad([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([db, dc]) => {
        const p = [0, 0, 0];
        p[a] = s * H[a];
        p[bb] = db * (H[bb] - b);
        p[c] = dc * (H[c] - b);
        return p;
      }), n);
    }
  }
  for (const [a, bb] of [[0, 1], [0, 2], [1, 2]]) {
    const c = 3 - a - bb;
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const n = [0, 0, 0];
      n[a] = sa * Math.SQRT1_2;
      n[bb] = sb * Math.SQRT1_2;
      const P = (c0) => { const p = [0, 0, 0]; p[a] = sa * H[a]; p[bb] = sb * (H[bb] - b); p[c] = c0; return p; };
      const Q = (c0) => { const p = [0, 0, 0]; p[a] = sa * (H[a] - b); p[bb] = sb * H[bb]; p[c] = c0; return p; };
      quad([P(-(H[c] - b)), P(H[c] - b), Q(H[c] - b), Q(-(H[c] - b))], n);
    }
  }
  return { pos, nor, idx, hy };
}

// Fabrique de blocs partagée (personnage et décor)
export function createBlocks(scene) {
  const mat = new StandardMaterial('lowpoly-mat', scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.12, 0.11, 0.1);
  mat.specularPower = 20;
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;

  // Fabrique un bloc : dimensions, dégradé haut/bas, biseau, évasement
  const block = (name, parent, [w, h, d], [x, y, z], top, bottom = top, { bevel = 0.05, flare = 1, rot = [0, 0, 0] } = {}) => {
    const g = boxGeometry(w, h, d, bevel, flare);
    const t = Color3.FromHexString(top);
    const bt = Color3.FromHexString(bottom);
    const colors = [];
    for (let i = 1; i < g.pos.length; i += 3) {
      const k = (g.pos[i] + g.hy) / (2 * g.hy);
      colors.push(bt.r + (t.r - bt.r) * k, bt.g + (t.g - bt.g) * k, bt.b + (t.b - bt.b) * k, 1);
    }
    const vd = new VertexData();
    vd.positions = g.pos;
    vd.normals = g.nor;
    vd.indices = g.idx;
    vd.colors = colors;
    const mesh = new Mesh(name, scene);
    vd.applyToMesh(mesh);
    mesh.material = mat;
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.rotation.set(...rot);
    return mesh;
  };
  return block;
}

// Logo « Genius Pay » peint sur une texture : posé sur le torse (et dans le dos, pour qu'il se voie en course)
function logoMaterial(scene) {
  const tex = new DynamicTexture('gp-logo', { width: 512, height: 220 }, scene, true);
  const c = tex.getContext();
  c.clearRect(0, 0, 512, 220);
  c.fillStyle = '#ffffff';
  c.font = '800 80px system-ui, Arial, sans-serif';
  c.textBaseline = 'middle';
  c.fillText('Genius', 10, 84);
  c.fillStyle = '#1b3fb8';
  c.beginPath();
  c.roundRect(284, 28, 218, 112, 22);
  c.fill();
  c.fillStyle = '#ffffff';
  c.fillText('Pay', 318, 86);
  c.font = '700 34px system-ui, Arial, sans-serif';
  c.fillStyle = '#d9e4ff';
  c.fillText('L’API de paiement pour l’Afrique', 14, 182);
  tex.update();
  tex.hasAlpha = true;
  const m = new StandardMaterial('gp-logo-mat', scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.opacityTexture = tex;
  m.disableLighting = true;
  m.backFaceCulling = true;
  return m;
}

// variant : 'boy' (toge marine) ou 'girl' (tee-shirt bleu Genius Pay, bob de twists, toque noire)
export function createStudent(scene, variant = 'boy') {
  const girl = variant === 'girl';
  const block = createBlocks(scene);

  const SK = girl ? ['#a8663a', '#82482a'] : ['#b0703f', '#8a5128'];          // peau : haut / bas
  const SKD = girl ? '#6e3a1e' : '#7a4522';
  const HAIR = girl ? '#2a160e' : '#1d150e';
  const NAVY = girl ? ['#3a3a47', '#1f1f28'] : ['#3a4880', '#252e58'];
  const SHOULD = girl ? '#4a4a58' : '#44539a';
  const SLEEVE = girl ? '#414150' : '#4a5aa6';
  const TROUSER = girl ? ['#2b3560', '#1a2040'] : ['#2f3a70', '#1e2650'];
  const CAP = girl ? ['#34343f', '#1d1d25'] : ['#2f3a70', '#1e2650'];
  const BOARD = girl ? '#40404d' : '#36427c';
  const WHITE = ['#ffffff', '#dcd4c2'];
  const OR = ['#ffbf47', '#e88a00'];
  const CREAM = ['#fff6e2', '#e8d6ae'];

  const root = new TransformNode('student', scene);
  const HIP = 0.66;
  const body = new TransformNode('body', scene);
  body.parent = root;
  body.position.y = HIP;

  // Toge : gros bloc évasé, carrure large, col blanc, étole orange en V
  const gown = block('gown', body, [0.78, 0.92, 0.62], [0, 0.46, 0], NAVY[0], NAVY[1], { bevel: 0.07, flare: 1.4 });
  block('shoulders', body, [1.04, 0.34, 0.7], [0, 0.86, 0], SHOULD, NAVY[0], { bevel: 0.08 });
  block('neck', body, [0.26, 0.2, 0.26], [0, 1.08, 0], SK[0], SK[1], { bevel: 0.03 });
  block('collar', body, [0.56, 0.1, 0.46], [0, 1.0, 0.01], girl ? '#2449c4' : WHITE[0], girl ? '#1a37a0' : WHITE[1], { bevel: 0.03 });
  if (girl) {
    // Toge noire ouverte sur le tee-shirt bleu Genius Pay ; logo sur le tee-shirt devant et sur la toge dans le dos
    block('tee', gown, [0.44, 0.92, 0.62], [0, 0, 0.04], '#3f6df0', '#1c3cae', { bevel: 0.05, flare: 1.4 });
    const logo = logoMaterial(scene);
    for (const [z, ry, w] of [[0.415, Math.PI, 0.44], [-0.375, 0, 0.58]]) {
      const plane = MeshBuilder.CreatePlane('logo', { width: w, height: w * 0.43 }, scene);
      plane.material = logo;
      plane.parent = gown;
      plane.position.set(0, 0.12, z);
      plane.rotation.y = ry;
    }
  }
  for (const side of [-1, 1]) {
    block('stole-' + side, body, [0.15, 0.74, 0.07], [side * (girl ? 0.34 : 0.15), 0.5, 0.4], OR[0], OR[1], { bevel: 0.025, rot: [-0.16, 0, side * 0.12] });
  }

  // Bras : manche évasée, grosse main carrée
  function buildArm(side) {
    const pivot = new TransformNode('arm-' + side, scene);
    pivot.parent = body;
    pivot.position.set(side * 0.62, 0.9, 0);
    block('sleeve-' + side, pivot, [0.3, 0.62, 0.32], [0, -0.31, 0], SLEEVE, NAVY[1], { bevel: 0.05, flare: 1.5 });
    block('hand-' + side, pivot, [0.26, 0.24, 0.26], [0, -0.72, 0], SK[0], SK[1], { bevel: 0.05 });
    return { pivot };
  }
  const armL = buildArm(-1);
  const armR = buildArm(1);

  // Diplôme dans la main droite
  const diploma = new TransformNode('diploma', scene);
  diploma.parent = armR.pivot;
  diploma.position.set(0, -0.74, 0.1);
  diploma.rotation.x = Math.PI / 2.3;
  block('scroll', diploma, [0.11, 0.11, 0.56], [0, 0, 0], CREAM[0], CREAM[1], { bevel: 0.03 });
  block('ribbon', diploma, [0.14, 0.14, 0.09], [0, 0, 0.02], OR[0], OR[1], { bevel: 0.02 });

  // Jambes courtes et baskets carrées à semelle crème et liseré orange
  function buildLeg(side) {
    const pivot = new TransformNode('leg-' + side, scene);
    pivot.parent = root;
    pivot.position.set(side * 0.24, HIP, 0);
    block('trouser-' + side, pivot, [0.3, 0.38, 0.32], [0, -0.19, 0], TROUSER[0], TROUSER[1], { bevel: 0.05 });
    block('shoe-' + side, pivot, [0.4, 0.24, 0.66], [0, -0.5, 0.08], WHITE[0], WHITE[1], { bevel: 0.07 });
    block('sole-' + side, pivot, [0.42, 0.07, 0.7], [0, -0.615, 0.08], CREAM[0], CREAM[1], { bevel: 0.03 });
    block('stripe-' + side, pivot, [0.43, 0.06, 0.22], [0, -0.46, 0.04], OR[0], OR[1], { bevel: 0.02 });
    return pivot;
  }
  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  // Tête : gros bloc, cheveux, visage en petits blocs plats
  const headPivot = new TransformNode('head-pivot', scene);
  headPivot.parent = body;
  headPivot.position.y = 1.1;
  const headC = new TransformNode('head-center', scene);
  headC.parent = headPivot;
  headC.position.y = 0.52;
  block('head', headC, [1.02, 0.94, 0.94], [0, 0, 0], SK[0], SK[1], { bevel: 0.1 });
  const swingers = [];                                   // mèches qui suivent le mouvement
  if (girl) {
    // Bob de twists : frange séparée au milieu, deux rideaux de twists + nuque, stries plus claires pour le relief
    const TW = ['#5c321e', '#3d2014'];
    block('hair-top', headC, [1.08, 0.2, 1.0], [0, 0.36, 0], HAIR, HAIR, { bevel: 0.06 });
    for (const s of [-1, 1]) {
      block('fringe-' + s, headC, [0.5, 0.18, 0.1], [s * 0.26, 0.32, 0.46], HAIR, HAIR, { bevel: 0.04, rot: [0, 0, s * -0.1] });
      const pivot = new TransformNode('twists-' + s, scene);
      pivot.parent = headC;
      pivot.position.set(s * 0.64, 0.36, -0.05);
      block('curtain-' + s, pivot, [0.26, 0.86, 0.76], [0, -0.43, 0], HAIR, '#3a1f12', { bevel: 0.07, flare: 1.12 });
      for (let n = 0; n < 5; n++) {
        block('twist-' + s + n, pivot, [0.28 + n * 0.006, 0.09, 0.78], [0, -0.14 - n * 0.16, 0], TW[0], TW[1], { bevel: 0.03, rot: [0, 0, s * (n % 2 ? 0.28 : -0.28)] });
      }
      swingers.push({ node: pivot, side: s });
    }
    const back = new TransformNode('twists-back', scene);
    back.parent = headC;
    back.position.set(0, 0.36, -0.5);
    block('curtain-back', back, [1.3, 0.86, 0.3], [0, -0.43, 0], HAIR, '#3a1f12', { bevel: 0.07, flare: 1.1 });
    for (let n = 0; n < 5; n++) {
      block('twist-back' + n, back, [1.32, 0.09, 0.32], [0, -0.14 - n * 0.16, -0.01], TW[0], TW[1], { bevel: 0.03, rot: [0, 0, n % 2 ? 0.06 : -0.06] });
    }
    for (const s of [-1, 1]) {
      block('ear-' + s, headC, [0.1, 0.2, 0.14], [s * 0.54, -0.04, 0.02], SKD, SKD, { bevel: 0.03 });
      // yeux : blanc, pupille brune, cils, sourcil fin ; sourire fermé aux commissures relevées
      block('eye-' + s, headC, [0.19, 0.16, 0.05], [s * 0.21, 0.06, 0.47], WHITE[0], WHITE[1], { bevel: 0.02 });
      block('pupil-' + s, headC, [0.11, 0.13, 0.05], [s * 0.2, 0.05, 0.5], '#2b1608', '#2b1608', { bevel: 0.015 });
      block('lash-' + s, headC, [0.25, 0.05, 0.06], [s * 0.21, 0.15, 0.49], '#150b06', '#150b06', { bevel: 0.015, rot: [0, 0, 0] });
      block('brow-' + s, headC, [0.24, 0.05, 0.06], [s * 0.22, 0.27, 0.48], HAIR, HAIR, { bevel: 0.02 });
      block('cheek-' + s, headC, [0.15, 0.09, 0.04], [s * 0.34, -0.15, 0.47], '#d9774a', '#d9774a', { bevel: 0.02 });
      block('smile-' + s, headC, [0.06, 0.07, 0.05], [s * 0.2, -0.24, 0.485], '#9c4540', '#9c4540', { bevel: 0.012, rot: [0, 0, s * 0.5] });
    }
    block('nose', headC, [0.13, 0.14, 0.1], [0, -0.04, 0.5], SKD, SKD, { bevel: 0.03 });
    block('mouth', headC, [0.32, 0.09, 0.05], [0, -0.27, 0.48], '#b8584f', '#b8584f', { bevel: 0.02 });
  } else {
    block('hair-back', headC, [1.08, 0.62, 0.22], [0, 0.08, -0.38], HAIR, HAIR, { bevel: 0.07 });
    block('hair-top', headC, [1.08, 0.2, 1.0], [0, 0.36, 0], HAIR, HAIR, { bevel: 0.06 });
    for (const s of [-1, 1]) {
      block('ear-' + s, headC, [0.12, 0.22, 0.16], [s * 0.56, -0.02, 0], SKD, SKD, { bevel: 0.03 });
      block('side-hair-' + s, headC, [0.12, 0.34, 0.5], [s * 0.55, 0.22, -0.12], HAIR, HAIR, { bevel: 0.03 });
      // yeux : blanc plat + pupille ; sourcil épais ; joue
      block('eye-' + s, headC, [0.2, 0.19, 0.05], [s * 0.21, 0.07, 0.47], WHITE[0], WHITE[1], { bevel: 0.02 });
      block('pupil-' + s, headC, [0.1, 0.12, 0.05], [s * 0.18, 0.05, 0.5], '#2b1608', '#2b1608', { bevel: 0.015 });
      block('brow-' + s, headC, [0.26, 0.07, 0.06], [s * 0.21, 0.25, 0.48], HAIR, HAIR, { bevel: 0.02, rot: [0, 0, -s * 0.16] });
      block('cheek-' + s, headC, [0.14, 0.09, 0.04], [s * 0.34, -0.14, 0.47], '#e0813f', '#e0813f', { bevel: 0.02 });
      block('corner-' + s, headC, [0.07, 0.09, 0.05], [s * 0.29, -0.22, 0.48], '#58221b', '#58221b', { bevel: 0.015 });
    }
    block('nose', headC, [0.13, 0.15, 0.1], [0, -0.04, 0.5], SKD, SKD, { bevel: 0.03 });
    block('mouth', headC, [0.5, 0.17, 0.05], [0, -0.27, 0.48], '#58221b', '#58221b', { bevel: 0.02 });
    block('teeth', headC, [0.4, 0.07, 0.05], [0, -0.225, 0.5], '#ffffff', '#ffffff', { bevel: 0.015 });
  }

  // Toque massive : calotte, planche épaisse à 45°, bouton, gland orange
  block('cap-base', headC, [0.9, 0.22, 0.84], [0, 0.58, 0], CAP[0], CAP[1], { bevel: 0.07 });
  const board = block('board', headC, [1.5, 0.12, 1.5], [0, 0.74, 0], BOARD, CAP[1], { bevel: 0.05, rot: [0, Math.PI / 4, 0] });
  void board;
  block('button', headC, [0.12, 0.08, 0.12], [0, 0.82, 0], OR[0], OR[1], { bevel: 0.02 });
  const tassel = new TransformNode('tassel', scene);
  tassel.parent = headC;
  tassel.position.set(0, 0.8, 0);
  tassel.rotation.y = -Math.PI / 4;      // le gland retombe devant, côté droit
  block('cord', tassel, [0.72, 0.05, 0.05], [0.36, 0, 0], OR[0], OR[1], { bevel: 0.015 });
  const tasselEnd = new TransformNode('tassel-end', scene);
  tasselEnd.parent = tassel;
  tasselEnd.position.set(0.74, 0, 0);
  block('knot', tasselEnd, [0.1, 0.1, 0.1], [0, -0.05, 0], OR[0], OR[1], { bevel: 0.02 });
  block('fringe', tasselEnd, [0.17, 0.3, 0.17], [0, -0.24, 0], OR[0], OR[1], { bevel: 0.04, flare: 1.3 });

  // Étoiles qui tournent au-dessus de la tête (pose « échec »)
  const starMat = new StandardMaterial('star-mat', scene);
  starMat.diffuseColor = Color3.FromHexString(ORANGE);
  starMat.emissiveColor = Color3.FromHexString(ORANGE).scale(0.8);
  const stars = new TransformNode('stars', scene);
  stars.parent = headC;
  stars.position.y = 0.95;
  const starMeshes = [0, 1, 2].map((n) => {
    const st = MeshBuilder.CreateBox('star-' + n, { size: 0.13 }, scene);
    st.parent = stars;
    st.material = starMat;
    return st;
  });

  // Ombre ronde
  const shadow = MeshBuilder.CreateDisc('shadow', { radius: 0.85, tessellation: 32 }, scene);
  shadow.rotation.x = Math.PI / 2;
  shadow.position.y = 0.014;
  const shadowMat = new StandardMaterial('shadow-mat', scene);
  shadowMat.diffuseColor = new Color3(0, 0, 0);
  shadowMat.specularColor = new Color3(0, 0, 0);
  shadowMat.alpha = 0.22;
  shadow.material = shadowMat;

  // --- Poses animées, nerveuses -------------------------------------------------
  // Bras : x négatif = vers l'avant, z = écart sur le côté (~2,8 = bras levé). Jambes : x positif = pied vers l'arrière.
  // fx : { vy (vitesse verticale), bank (-1..1 virage), land (0..1 atterrissage), pop (0..1 petit rebond de joie) }
  const S = {
    y: 0, lean: 0, roll: 0, yaw: 0, headRoll: 0, headNod: 0, sy: 1,
    armLx: 0, armLz: 0, armRx: 0, armRz: 0, legL: 0, legR: 0, sway: 0, stars: 0,
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function target(pose, t, fx) {
    const T = {
      y: 0, lean: 0, roll: 0, yaw: 0, headRoll: Math.sin(t * 1.6) * 0.06, headNod: 0, sy: 1,
      armLx: 0, armLz: 0.3, armRx: 0, armRz: 0.3, legL: 0, legR: 0, sway: 0, stars: 0,
    };
    switch (pose) {
      case 'idle':
        T.y = Math.sin(t * 2.4) * 0.03;
        T.sy = 1 + Math.sin(t * 2.4) * 0.02;
        T.armRx = -0.65;
        T.armRz = 0.12;
        T.yaw = Math.sin(t * 0.9) * 0.18;                 // regarde autour de lui
        T.headRoll = Math.sin(t * 1.3) * 0.08;
        break;
      case 'run': {
        const f = 16;
        const s = Math.sin(t * f);
        T.y = Math.abs(s) * 0.2;
        T.lean = 0.3;
        T.roll = Math.cos(t * f) * 0.08;
        T.headRoll = Math.cos(t * f) * 0.07;
        T.headNod = -Math.abs(s) * 0.07;
        T.armLx = -s * 1.35;
        T.armRx = s * 1.35 - 0.25;
        T.armLz = 0.32;
        T.armRz = 0.32;
        T.legL = s * 1.25;
        T.legR = -s * 1.25;
        T.sway = s * 0.08;
        T.sy = 1 + Math.cos(t * f * 2) * 0.045;
        break;
      }
      case 'jump':
        T.y = 0.62;
        T.lean = 0.08;
        T.armLz = 2.7; T.armRz = 2.7;
        T.armLx = -0.2; T.armRx = -0.2;
        T.legL = -1.0; T.legR = 0.35;
        T.headNod = -0.18;
        break;
      case 'slide':
        T.y = -0.1;
        T.lean = 1.0;
        T.sy = 0.86;
        T.armLx = -1.5; T.armRx = -1.5; T.armLz = 0.4; T.armRz = 0.4;
        T.legL = 1.1; T.legR = 1.1;
        T.headNod = -0.4;
        break;
      case 'victory':
        T.y = Math.abs(Math.sin(t * 6)) * 0.45;
        T.sy = 1 + Math.sin(t * 12) * 0.05;
        T.armRz = 2.9; T.armRx = -0.3;
        T.armLz = 1.2 + Math.sin(t * 6) * 0.35; T.armLx = -0.1;
        T.yaw = Math.sin(t * 3) * 0.55;
        T.headRoll = Math.sin(t * 4) * 0.14;
        T.legL = -0.25; T.legR = 0.25;
        break;
      case 'fail':
        T.y = -0.03;
        T.lean = -0.1;
        T.sy = 0.95;
        T.headRoll = Math.sin(t * 11) * 0.34;
        T.headNod = 0.25;
        T.armLz = 0.2; T.armRz = 0.2; T.armLx = 0.3; T.armRx = 0.3;
        T.roll = Math.sin(t * 11) * 0.09;
        T.yaw = Math.sin(t * 7) * 0.4;
        T.stars = 1;
        break;
      default:
    }
    // Vivacité : virage, étirement en l'air, écrasement à l'atterrissage, petit rebond de joie
    T.roll += (fx.bank || 0) * 0.4;
    T.yaw += (fx.bank || 0) * 0.5;
    T.sy *= 1 + clamp((fx.vy || 0) * 0.022, -0.14, 0.22);
    T.sy *= 1 - (fx.land || 0) * 0.3;
    T.sy *= 1 + (fx.pop || 0) * 0.14;
    return T;
  }

  const lerp = (a, b, k) => a + (b - a) * k;

  function update(pose, dt, t, fx = {}) {
    const T = target(pose, t, fx);
    const k = Math.min(1, dt * 20);                       // réaction vive
    for (const name of Object.keys(T)) S[name] = lerp(S[name], T[name], name === 'stars' ? Math.min(1, dt * 8) : k);

    root.position.y = S.y;
    root.rotation.y = S.yaw;
    const wide = 1 + (1 - S.sy) * 0.55;                   // écrasement-étirement : plus bas = plus large
    root.scaling.set(wide, S.sy, wide);
    body.rotation.x = S.lean;
    body.rotation.z = S.roll;
    headPivot.rotation.z = S.headRoll;
    headPivot.rotation.x = S.headNod;
    armL.pivot.rotation.x = S.armLx;
    armR.pivot.rotation.x = S.armRx;
    armL.pivot.rotation.z = -S.armLz;                     // vers l'extérieur : gauche négatif, droite positif
    armR.pivot.rotation.z = S.armRz;
    legL.rotation.x = S.legL;
    legR.rotation.x = S.legR;
    gown.rotation.z = S.sway;
    for (const w of swingers) w.node.rotation.z = w.side * (0.05 + S.y * 0.35) - S.headRoll * 0.4;   // les twists battent en courant
    tassel.rotation.z = Math.sin(t * 5) * 0.14 + S.sway;
    tasselEnd.rotation.z = Math.sin(t * 6 + 1) * 0.3;
    stars.setEnabled(S.stars > 0.05);
    stars.rotation.y = t * 5;
    starMeshes.forEach((st, n) => {
      const a = (n / 3) * Math.PI * 2;
      st.position.set(Math.cos(a) * 0.55, Math.sin(t * 7 + a) * 0.06, Math.sin(a) * 0.55);
      st.rotation.y = t * 6;
    });
    shadow.scaling.setAll(Math.max(0.5, 1 - S.y * 0.5));
  }

  return { root, update, shadow };
}
