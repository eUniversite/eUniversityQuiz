import {
  Color3, MeshBuilder, StandardMaterial, TransformNode, Mesh, VertexData, Vector3,
} from '@babylonjs/core';

// Étudiant eUniversité en version « blocs » : construit cube par cube (voxels chanfreinés),
// proportions mini et trapues, nuances de teinte d'un bloc à l'autre. Même interface que student.js.
const ORANGE = '#FFA000';
const VS = 0.065;                      // taille d'un bloc

// --- Moteur de voxels -----------------------------------------------------------
class Vox {
  constructor() { this.map = new Map(); }
  set(x, y, z, hex) { this.map.set(`${x},${y},${z}`, [x, y, z, hex]); }
  has(x, y, z) { return this.map.has(`${x},${y},${z}`); }
  get(x, y, z) { return this.map.get(`${x},${y},${z}`); }
}

const hash = (x, y, z) => {
  let h = Math.imul(x * 73856093 ^ y * 19349663 ^ z * 83492791, 2654435761);
  h ^= h >>> 15;
  return ((h >>> 0) % 1000) / 1000;
};

// Cube chanfreiné (arêtes biseautées) : 6 faces rétrécies + 12 bandes d'arête
const BEVEL = 0.08;
const T = { v: [], n: [], i: [] };
(function buildTemplate() {
  const quad = (p0, p1, p2, p3, n) => {
    const base = T.v.length / 3;
    for (const p of [p0, p1, p2, p3]) { T.v.push(...p); T.n.push(...n); }
    T.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const h = 0.5 - BEVEL;
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const c = (a + 2) % 3;
    for (const s of [-1, 1]) {
      const n = [0, 0, 0];
      n[a] = s;
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([db, dc]) => {
        const p = [0, 0, 0];
        p[a] = s * 0.5; p[b] = db * h; p[c] = dc * h;
        return p;
      });
      quad(...pts, n);
    }
  }
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    const c = 3 - a - b;
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const n = [0, 0, 0];
      n[a] = sa * Math.SQRT1_2; n[b] = sb * Math.SQRT1_2;
      const P = (c0) => { const p = [0, 0, 0]; p[a] = sa * 0.5; p[b] = sb * h; p[c] = c0; return p; };
      const Q = (c0) => { const p = [0, 0, 0]; p[a] = sa * h; p[b] = sb * 0.5; p[c] = c0; return p; };
      quad(P(-h), P(h), Q(h), Q(-h), n);
    }
  }
}());

const NEIGHBORS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const rgb = (hex) => { const c = Color3.FromHexString(hex); return [c.r, c.g, c.b]; };

// Assemble un seul maillage à partir des blocs visibles (les blocs enfouis sont ignorés)
function voxelMesh(name, vox, scene, material, { jitter = 0.14 } = {}) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const [x, y] of vox.map.values()) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
  for (const [x, y, z, hex] of vox.map.values()) {
    if (NEIGHBORS.every(([dx, dy, dz]) => vox.has(x + dx, y + dy, z + dz))) continue;
    const base = positions.length / 3;
    const [r, g, b] = rgb(hex);
    const k = 1 + (hash(x, y, z) - 0.5) * jitter + ((y - ymin) / (ymax - ymin || 1) - 0.5) * 0.08;
    for (let i = 0; i < T.v.length; i += 3) {
      positions.push((x + T.v[i]) * VS, (y + T.v[i + 1]) * VS, (z + T.v[i + 2]) * VS);
      normals.push(T.n[i], T.n[i + 1], T.n[i + 2]);
      colors.push(Math.min(1, r * k), Math.min(1, g * k), Math.min(1, b * k), 1);
    }
    for (const idx of T.i) indices.push(base + idx);
  }
  const vd = new VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.colors = colors;
  vd.indices = indices;
  const mesh = new Mesh(name, scene);
  vd.applyToMesh(mesh);
  mesh.material = material;
  return mesh;
}

// Remplit un volume : la fonction donne la couleur d'un bloc, ou rien s'il est vide
function fill(vox, [x0, x1], [y0, y1], [z0, z1], colorAt) {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
    const c = colorAt(x, y, z);
    if (c) vox.set(x, y, z, c);
  }
}

// Bloc le plus en avant d'une colonne (x, y) : sert à peindre le visage et l'étole
function frontZ(vox, x, y) {
  let best = null;
  for (const [vx, vy, vz] of vox.map.values()) if (vx === x && vy === y && (best === null || vz > best)) best = vz;
  return best;
}
function paintFront(vox, x, y, hex, depth = 0) {
  const z = frontZ(vox, x, y);
  if (z !== null) for (let d = 0; d <= depth; d++) if (vox.has(x, y, z - d)) vox.set(x, y, z - d, hex);
}

// --- Couleurs -------------------------------------------------------------------
const C = {
  skin: '#a05d2c', skinDark: '#7b451f', blush: '#d97a3c',
  hair: '#1a120b',
  gown: '#2c3664', gownLight: '#38447a', cap: '#1d2342', sleeve: '#34407a',
  orange: ORANGE, white: '#fbf7ee', cream: '#fff3da', sole: '#e8dec8',
  eye: '#2b1608', mouth: '#58221b',
};

export function createStudent(scene, { pedestal = false } = {}) {
  void pedestal;
  const mat = new StandardMaterial('voxel-mat', scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.22, 0.2, 0.18);
  mat.specularPower = 28;
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;

  const root = new TransformNode('student', scene);
  const HIP = 8;                       // hauteur des hanches, en blocs
  const body = new TransformNode('body', scene);
  body.parent = root;
  body.position.y = HIP * VS;
  const headPivot = new TransformNode('head-pivot', scene);
  headPivot.parent = body;
  headPivot.position.y = 14 * VS;      // au cou

  // Toge : cloche carrée aux épaules larges, étole orange en V, col blanc
  const torso = new Vox();
  fill(torso, [-8, 8], [0, 14], [-7, 7], (x, y, z) => {
    const rx = y <= 11 ? 7.2 - y * 0.2 : y === 12 ? 6.6 : y === 13 ? 4.6 : 2.6;
    const rz = y <= 11 ? 5.8 - y * 0.15 : y === 12 ? 4.6 : y === 13 ? 3.6 : 2.4;
    const d = Math.pow(Math.abs(x) / rx, 3) + Math.pow(Math.abs(z) / rz, 3);
    if (d > 1) return null;
    if (y === 14) return C.skinDark;
    return y === 0 ? C.gownLight : y > 10 ? C.gownLight : C.gown;
  });
  for (let y = 3; y <= 12; y++) {
    const g = Math.round(1 + (12 - y) * 0.2);
    for (const s of [-1, 1]) for (const w of [0, 1]) paintFront(torso, s * (g + w), y, C.orange, 1);
  }
  for (let x = -3; x <= 3; x++) paintFront(torso, x, 13, C.white, 1);
  for (const x of [-4, 4]) paintFront(torso, x, 13, C.white, 0);
  const gown = voxelMesh('gown', torso, scene, mat);
  gown.parent = body;

  // Manches larges qui s'évasent, mains rondes
  function buildArm(side) {
    const pivot = new TransformNode('arm-' + side, scene);
    pivot.parent = body;
    pivot.position.set(side * 8.2 * VS, 11.5 * VS, 0);
    const arm = new Vox();
    for (let y = 0; y >= -11; y--) {
      const r = 2.1 + (-y) * 0.12;
      fill(arm, [-4, 4], [y, y], [-4, 4], (x, _y, z) => (x * x + z * z <= r * r ? (y > -3 ? C.sleeve : C.gownLight) : null));
    }
    fill(arm, [-2, 2], [-14, -12], [-2, 2], (x, y, z) => (x * x + (y + 13) * (y + 13) + z * z <= 5.2 ? C.skin : null));
    const mesh = voxelMesh('sleeve-' + side, arm, scene, mat);
    mesh.parent = pivot;
    return { pivot, mesh };
  }
  const armL = buildArm(-1);
  const armR = buildArm(1);

  // Diplôme roulé, ruban orange
  const diploma = new TransformNode('diploma', scene);
  diploma.parent = armR.pivot;
  diploma.position.set(0, -13 * VS, 1.5 * VS);
  diploma.rotation.x = Math.PI / 2.4;
  const roll = new Vox();
  fill(roll, [0, 1], [0, 1], [-5, 5], () => C.cream);
  for (const z of [-1, 0]) fill(roll, [-1, 2], [-1, 2], [z, z], (x, y) => (x >= 0 && x <= 1 && y >= 0 && y <= 1 ? null : C.orange));
  const diplomaMesh = voxelMesh('diploma-mesh', roll, scene, mat, { jitter: 0.06 });
  diplomaMesh.parent = diploma;
  diplomaMesh.position.set(-0.5 * VS, -0.5 * VS, 0);

  // Jambes courtes en pantalon sombre, baskets blanches à semelle crème et liseré orange
  function buildLeg(side) {
    const pivot = new TransformNode('leg-' + side, scene);
    pivot.parent = root;
    pivot.position.set(side * 3.2 * VS, HIP * VS, 0);
    const leg = new Vox();
    fill(leg, [-2, 2], [-5, -1], [-2, 2], (x, y, z) => (x * x + z * z <= 5.6 ? C.cap : null));
    fill(leg, [-3, 3], [-8, -6], [-4, 4], (x, y, z) => {
      if (z > 3 && Math.abs(x) > 2) return null;
      if (y === -8) return C.sole;
      if (y === -6 && Math.abs(x) >= 3 && z >= -1 && z <= 2) return C.orange;
      return C.white;
    });
    fill(leg, [-2, 2], [-5, -5], [-2, 2], (x, y, z) => (x * x + z * z <= 5.6 ? C.white : null));
    const mesh = voxelMesh('leg-' + side, leg, scene, mat);
    mesh.parent = pivot;
    return pivot;
  }
  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  // Tête : bloc arrondi, cheveux, visage peint sur la face avant
  const headC = new TransformNode('head-center', scene);
  headC.parent = headPivot;
  headC.position.y = 8 * VS;
  const hv = new Vox();
  fill(hv, [-8, 8], [-7, 7], [-7, 7], (x, y, z) => {
    const d = Math.pow(x / 7.5, 4) + Math.pow(y / 6.7, 4) + Math.pow(z / 6.7, 4);
    if (d > 1) return null;
    const hair = (y >= 3 && (z <= 4 || Math.abs(x) >= 5)) || y >= 5;
    return hair ? C.hair : C.skin;
  });
  for (const s of [-1, 1]) fill(hv, [8, 8], [-1, 2], [-1, 1], () => C.skinDark);   // oreilles (côtés)
  // Visage
  const paint = (x, y, hex) => paintFront(hv, x, y, hex, 0);
  for (const s of [-1, 1]) {
    for (const x of [3, 4]) for (const y of [0, 1, 2]) paint(s * x, y, C.white);          // blanc des yeux
    for (const y of [0, 1]) paint(s * 3, y, C.eye);                                         // pupille
    for (const x of [3, 4, 5]) paint(s * x, 4, C.hair);                                     // sourcil
    paint(s * 6, -1, C.blush);                                                              // joue
    paint(s * 4, -2, C.mouth);                                                              // coin du sourire
  }
  for (let x = -3; x <= 3; x++) paint(x, -3, Math.abs(x) <= 2 ? C.white : C.mouth);       // sourire : dents
  for (let x = -2; x <= 2; x++) paint(x, -4, C.mouth);                                      // bouche ouverte
  paint(0, -1, C.skinDark);                                                                 // nez
  paint(0, 0, C.skinDark);
  const head = voxelMesh('head', hv, scene, mat);
  head.parent = headC;

  // Toque : calotte et planche carrée à 45°, bouton, gland orange
  const capV = new Vox();
  fill(capV, [-6, 6], [5, 8], [-6, 6], (x, y, z) => (Math.pow(x / 6.4, 4) + Math.pow(z / 6.4, 4) <= 1 ? C.cap : null));
  const capBase = voxelMesh('cap-base', capV, scene, mat, { jitter: 0.1 });
  capBase.parent = headC;
  const boardV = new Vox();
  fill(boardV, [-9, 9], [0, 1], [-9, 9], () => C.cap);
  boardV.set(0, 2, 0, C.orange);
  const board = voxelMesh('board', boardV, scene, mat, { jitter: 0.1 });
  board.parent = headC;
  board.position.y = 9 * VS;
  board.rotation.y = Math.PI / 4;

  const tassel = new TransformNode('tassel', scene);
  tassel.parent = headC;
  tassel.position.set(0, 10.5 * VS, 0);
  tassel.rotation.y = Math.PI * 0.75;
  const cordV = new Vox();
  for (let x = 0; x <= 9; x++) cordV.set(x, 0, 0, C.orange);
  const cord = voxelMesh('cord', cordV, scene, mat, { jitter: 0.08 });
  cord.parent = tassel;
  const tasselEnd = new TransformNode('tassel-end', scene);
  tasselEnd.parent = tassel;
  tasselEnd.position.set(9 * VS, 0, 0);
  const fringeV = new Vox();
  fill(fringeV, [0, 0], [-1, -3], [0, 0], () => C.orange);
  fill(fringeV, [-1, 1], [-7, -4], [-1, 1], () => C.orange);
  const fringe = voxelMesh('fringe', fringeV, scene, mat, { jitter: 0.08 });
  fringe.parent = tasselEnd;

  // Étoiles qui tournent au-dessus de la tête (pose « échec »)
  const starMat = new StandardMaterial('star-mat', scene);
  starMat.diffuseColor = Color3.FromHexString(ORANGE);
  starMat.emissiveColor = Color3.FromHexString(ORANGE).scale(0.8);
  const stars = new TransformNode('stars', scene);
  stars.parent = headC;
  stars.position.y = 12 * VS;
  const starMeshes = [0, 1, 2].map((n) => {
    const st = MeshBuilder.CreateBox('star-' + n, { size: 0.12 }, scene);
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


  const lerp = (a, b, k) => a + (b - a) * k;

  function update(pose, dt, t) {
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
  }


  return { root, update, shadow };
}
