import {
  Color3, MeshBuilder, StandardMaterial, TransformNode, Mesh, VertexData, VertexBuffer, Vector3,
} from '@babylonjs/core';

// Étudiant eUniversité « mini », style jouet doux : formes très arrondies, dégradés peints sur
// chaque pièce, reflets discrets, contours fins teintés. Partagé par l'atelier et par le jeu.
export const ORANGE = '#FFA000';
export const CREAM = '#FFF0D5';

// Outils de style partagés (personnage et décor)
export function createToy(scene) {
  let uid = 0;
  const hexColor = (hex) => Color3.FromHexString(hex);

  // Matériau pour pièces peintes en dégradé (couleurs portées par les sommets)
  const paintedMat = (() => {
    const m = new StandardMaterial('painted', scene);
    m.diffuseColor = new Color3(1, 1, 1);
    m.specularColor = new Color3(0.32, 0.3, 0.26);
    m.specularPower = 36;
    m.twoSidedLighting = true;           // les formes de révolution ont leurs normales dans les deux sens
    m.backFaceCulling = false;
    return m;
  })();

  // Matériau uni
  function solid(hex, { specular = 0.1, alpha = 1 } = {}) {
    const m = new StandardMaterial('solid-' + ++uid, scene);
    m.diffuseColor = hexColor(hex);
    m.specularColor = new Color3(specular, specular, specular);
    m.specularPower = 30;
    m.alpha = alpha;
    m.twoSidedLighting = true;
    return m;
  }

  // Dégradé vertical peint sur les sommets : clair en haut, plus sombre en bas
  function paint(mesh, topHex, bottomHex) {
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < pos.length; i += 3) {
      lo = Math.min(lo, pos[i]);
      hi = Math.max(hi, pos[i]);
    }
    const top = hexColor(topHex);
    const bot = hexColor(bottomHex);
    const colors = [];
    for (let i = 1; i < pos.length; i += 3) {
      const t = (pos[i] - lo) / (hi - lo || 1);
      colors.push(bot.r + (top.r - bot.r) * t, bot.g + (top.g - bot.g) * t, bot.b + (top.b - bot.b) * t, 1);
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    mesh.material = paintedMat;
    mesh.__edge = bottomHex;
    return mesh;
  }

  // Contour fin : une teinte sombre de la couleur de la pièce, jamais du noir pur
  function edge(mesh, width = 0.014) {
    const base = hexColor(mesh.__edge || '#3a2412');
    mesh.renderOutline = true;
    mesh.outlineWidth = width;
    mesh.outlineColor = new Color3(base.r * 0.3, base.g * 0.3, base.b * 0.32);
    return mesh;
  }

  // Forme arrondie « bloc mou » : super-ellipsoïde (n grand = presque un cube aux coins adoucis)
  function softBlock(name, w, h, d, n = 4, seg = 36) {
    const e = 2 / n;
    const cs = (a, m) => Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), m);
    const sn = (a, m) => Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), m);
    const positions = [];
    const indices = [];
    for (let i = 0; i <= seg; i++) {
      const v = -Math.PI / 2 + (i / seg) * Math.PI;
      for (let j = 0; j <= seg; j++) {
        const u = (j / seg) * Math.PI * 2;
        positions.push((w / 2) * cs(v, e) * cs(u, e), (h / 2) * sn(v, e), (d / 2) * cs(v, e) * sn(u, e));
      }
    }
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < seg; j++) {
        const a = i * (seg + 1) + j;
        const b = a + seg + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const normals = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    const mesh = new Mesh(name, scene);
    vd.applyToMesh(mesh);
    return mesh;
  }

  // Forme de révolution lisse à partir d'un profil (rayon, hauteur)
  function lathe(name, profile, tessellation = 40) {
    const shape = profile.map(([r, y]) => new Vector3(r, y, 0));
    return MeshBuilder.CreateLathe(name, { shape, tessellation, sideOrientation: Mesh.DOUBLESIDE }, scene);
  }

  function ball(name, parent, d, pos, scale, topHex, bottomHex = topHex, line = 0.012) {
    const m = MeshBuilder.CreateSphere(name, { diameter: d, segments: 28 }, scene);
    m.parent = parent;
    m.position.set(...pos);
    m.scaling.set(...scale);
    paint(m, topHex, bottomHex);
    if (line) edge(m, line);
    return m;
  }

  return { hexColor, paintedMat, solid, paint, edge, softBlock, lathe, ball };
}

export function createStudent(scene, { pedestal = false } = {}) {
  const toy = createToy(scene);
  const { hexColor, solid, paint, edge, softBlock, lathe, ball } = toy;

  const C = {
    skinTop: '#b4703c', skinBot: '#7e4720', skinMid: '#9a5b2e',
    gownTop: '#33406b', gownBot: '#161a30',
    sleeveTop: '#3a4876', sleeveBot: '#1b2038',
    capTop: '#2d3560', capBot: '#161a30',
    hairTop: '#2a1c12', hairBot: '#0f0a06',
    whiteTop: '#ffffff', whiteBot: '#d8d0c0',
    orangeTop: '#ffc34a', orangeBot: '#e68500',
  };

  const M = {
    eye: solid('#2b1608', { specular: 0.6 }),
    white: solid('#ffffff', { specular: 0.5 }),
    mouth: solid('#53201a'),
    tongue: solid('#e8705a'),
    blush: solid('#e8793e', { specular: 0, alpha: 0.38 }),
    brow: solid('#1a100a'),
    star: (() => { const m = solid(ORANGE); m.emissiveColor = hexColor(ORANGE).scale(0.8); return m; })(),
  };

  // --- Construction -------------------------------------------------------------
  const root = new TransformNode('student', scene);
  const body = new TransformNode('body', scene);      // tronc et toge, pivote à la taille
  body.parent = root;
  body.position.y = 0.22;
  const headPivot = new TransformNode('head-pivot', scene);   // pivote au cou
  headPivot.parent = body;
  headPivot.position.y = 0.92;
  headPivot.scaling.setAll(1.14);

  // Toge : cloche lisse à ourlet arrondi
  const gown = paint(lathe('gown', [
    [0.001, 0], [0.46, 0.0], [0.6, 0.04], [0.65, 0.12], [0.6, 0.28], [0.5, 0.5], [0.42, 0.68], [0.34, 0.8], [0.22, 0.88], [0.001, 0.9],
  ]), C.gownTop, C.gownBot);
  gown.parent = body;
  gown.position.y = 0.22;
  edge(gown, 0.016);

  // Épaules rondes
  const shoulders = ball('shoulders', body, 1, [0, 0.93, 0], [0.86, 0.42, 0.62], C.sleeveTop, C.gownTop, 0.014);

  // Cou, col blanc, étole orange
  const neck = MeshBuilder.CreateCylinder('neck', { height: 0.2, diameter: 0.26, tessellation: 20 }, scene);
  neck.parent = body;
  neck.position.y = 1.03;
  paint(neck, C.skinMid, C.skinBot);
  const collar = MeshBuilder.CreateTorus('collar', { diameter: 0.4, thickness: 0.1, tessellation: 28 }, scene);
  collar.parent = body;
  collar.position.y = 0.99;
  paint(collar, C.whiteTop, C.whiteBot);
  edge(collar, 0.008);

  for (const side of [-1, 1]) {
    const strip = softBlock('stole-' + side, 0.17, 0.7, 0.08, 4);
    strip.parent = body;
    strip.position.set(side * 0.12, 0.6, 0.5);
    strip.rotation.z = side * 0.1;
    strip.rotation.x = -0.2;
    paint(strip, C.orangeTop, C.orangeBot);
    edge(strip, 0.008);
  }

  // Manches larges et douces, mains rondes, diplôme
  function buildArm(side) {
    const pivot = new TransformNode('arm-' + side, scene);
    pivot.parent = body;
    pivot.position.set(side * 0.47, 0.98, 0);
    const sleeve = paint(lathe('sleeve-' + side, [
      [0.001, 0], [0.13, 0.0], [0.24, 0.04], [0.28, 0.14], [0.26, 0.32], [0.2, 0.5], [0.15, 0.6], [0.001, 0.62],
    ]), C.sleeveTop, C.sleeveBot);
    sleeve.parent = pivot;
    sleeve.position.y = -0.6;
    edge(sleeve, 0.014);
    const hand = ball('hand-' + side, pivot, 0.24, [0, -0.62, 0], [1, 1, 1], C.skinTop, C.skinBot, 0.01);
    return { pivot, hand };
  }
  const armL = buildArm(-1);
  const armR = buildArm(1);

  const diploma = new TransformNode('diploma', scene);
  diploma.parent = armR.pivot;
  diploma.position.set(0, -0.66, 0.1);
  diploma.rotation.x = Math.PI / 2.4;
  const scroll = MeshBuilder.CreateCapsule('scroll', { height: 0.52, radius: 0.058, tessellation: 16 }, scene);
  scroll.parent = diploma;
  paint(scroll, '#fffaf0', '#e6d9bd');
  edge(scroll, 0.008);
  const ribbon = MeshBuilder.CreateTorus('ribbon', { diameter: 0.125, thickness: 0.035, tessellation: 16 }, scene);
  ribbon.parent = diploma;
  paint(ribbon, C.orangeTop, C.orangeBot);

  // Jambes courtes et baskets bombées
  function buildLeg(side) {
    const pivot = new TransformNode('leg-' + side, scene);
    pivot.parent = root;
    pivot.position.set(side * 0.22, 0.5, 0);
    const leg = MeshBuilder.CreateCapsule('leg-mesh-' + side, { height: 0.46, radius: 0.09, tessellation: 16 }, scene);
    leg.parent = pivot;
    leg.position.y = -0.2;
    paint(leg, C.capTop, C.capBot);
    edge(leg, 0.01);
    const shoe = new TransformNode('shoe-' + side, scene);
    shoe.parent = pivot;
    shoe.position.set(0, -0.4, 0.05);
    const top = softBlock('shoe-top-' + side, 0.34, 0.26, 0.56, 3);
    top.parent = shoe;
    top.position.set(0, 0.05, 0.07);
    paint(top, C.whiteTop, C.whiteBot);
    edge(top, 0.012);
    const sole = softBlock('sole-' + side, 0.36, 0.09, 0.6, 3.4);
    sole.parent = shoe;
    sole.position.set(0, -0.06, 0.07);
    paint(sole, '#f3e9d4', '#d3c6a8');
    const stripe = softBlock('stripe-' + side, 0.355, 0.05, 0.2, 4);
    stripe.parent = shoe;
    stripe.position.set(0, 0.04, 0.0);
    paint(stripe, C.orangeTop, C.orangeBot);
    return pivot;
  }
  const legL = buildLeg(-1);
  const legR = buildLeg(1);

  // --- Tête ---------------------------------------------------------------------
  const HEAD_R = 0.5;
  const head = ball('head', headPivot, 1, [0, 0.58, 0], [1.05, 0.95, 0.99], C.skinTop, C.skinBot, 0.016);
  const headC = new TransformNode('head-center', scene);
  headC.parent = headPivot;
  headC.position.y = 0.58;

  function face(x, y, off = 0) {
    const nx = x / (HEAD_R * 1.05);
    const ny = y / (HEAD_R * 0.95);
    const z = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * HEAD_R * 0.99;
    return [x, y, z + off];
  }
  function onFace(name, d, x, y, scale, material, off = 0) {
    const m = MeshBuilder.CreateSphere(name, { diameter: d, segments: 18 }, scene);
    m.parent = headC;
    m.position.set(...face(x, y, off));
    m.scaling.set(...scale);
    m.material = material;
    return m;
  }

  for (const side of [-1, 1]) {
    const ear = ball('ear-' + side, headC, 0.2, face(side * 0.52, -0.02, -0.2), [0.55, 1, 0.8], C.skinTop, C.skinBot, 0.008);
    void ear;
  }

  // Yeux brillants
  for (const side of [-1, 1]) {
    onFace('sclera-' + side, 0.24, side * 0.185, 0.04, [1, 1.22, 0.5], M.white, -0.01);
    onFace('iris-' + side, 0.15, side * 0.185, 0.03, [1, 1.2, 0.5], M.eye, 0.035);
    onFace('shine-' + side, 0.055, side * 0.185 + 0.03, 0.09, [1, 1, 0.5], M.white, 0.075);
    onFace('shine2-' + side, 0.028, side * 0.185 - 0.03, -0.01, [1, 1, 0.5], M.white, 0.075);
  }

  // Sourcils joyeux
  for (const side of [-1, 1]) {
    const brow = MeshBuilder.CreateCapsule('brow-' + side, { height: 0.23, radius: 0.03 }, scene);
    brow.parent = headC;
    brow.position.set(...face(side * 0.19, 0.2, 0.045));
    brow.rotation.z = Math.PI / 2 - side * 0.2;
    brow.rotation.y = -side * 0.35;
    brow.material = M.brow;
  }

  onFace('nose', 0.13, 0, -0.07, [1.1, 0.8, 0.8], solid('#8a4d26'), 0.0);
  for (const side of [-1, 1]) onFace('blush-' + side, 0.17, side * 0.3, -0.12, [1, 0.62, 0.3], M.blush, 0.0);

  // Grand sourire en « D » : bouche, langue, dents
  function halfDisc(name, radius, x, y, material, off, scaleY = 1) {
    const d = MeshBuilder.CreateDisc(name, { radius, arc: 0.5, tessellation: 40 }, scene);
    d.parent = headC;
    d.position.set(...face(x, y, off));
    d.rotation.z = Math.PI;
    d.rotation.y = Math.PI;
    d.rotation.x = -0.12;
    d.scaling.y = scaleY;
    d.material = material;
    d.material.backFaceCulling = false;
    return d;
  }
  halfDisc('mouth', 0.22, 0, -0.14, M.mouth, 0.005, 1.0);
  halfDisc('tongue', 0.125, 0, -0.25, M.tongue, 0.02, 0.5);
  halfDisc('teeth', 0.195, 0, -0.145, M.white, 0.03, 0.42);

  // Cheveux courts, doux, inclinés vers l'arrière
  const hair = MeshBuilder.CreateSphere('hair', { diameter: 1.1, segments: 28, slice: 0.5 }, scene);
  hair.parent = headC;
  hair.position.set(0, 0.13, -0.1);
  hair.rotation.x = -0.5;
  hair.scaling.set(1.03, 0.84, 1);
  paint(hair, C.hairTop, C.hairBot);
  hair.material.backFaceCulling = false;

  // Toque : calotte lisse, planche carrée aux coins adoucis, bouton, gland orange
  const capBase = paint(lathe('cap-base', [
    [0.001, 0], [0.43, 0], [0.5, 0.03], [0.48, 0.2], [0.41, 0.25], [0.001, 0.26],
  ]), C.capTop, C.capBot);
  capBase.parent = headC;
  capBase.position.y = 0.33;
  edge(capBase, 0.014);

  const board = softBlock('board', 1.36, 0.1, 1.36, 6);
  board.parent = headC;
  board.position.y = 0.6;
  board.rotation.y = Math.PI / 4;
  paint(board, C.capTop, C.capBot);
  edge(board, 0.016);

  ball('button', headC, 0.13, [0, 0.67, 0], [1, 0.8, 1], C.orangeTop, C.orangeBot, 0.008);

  const tassel = new TransformNode('tassel', scene);
  tassel.parent = headC;
  tassel.position.set(0, 0.64, 0);
  const cord = MeshBuilder.CreateTube('cord', {
    path: [new Vector3(0, 0.03, 0), new Vector3(0.28, 0.04, 0.06), new Vector3(0.58, 0.025, 0.1), new Vector3(0.68, -0.04, 0.1)],
    radius: 0.024, tessellation: 10,
  }, scene);
  cord.parent = tassel;
  paint(cord, C.orangeTop, C.orangeBot);
  const tasselEnd = new TransformNode('tassel-end', scene);
  tasselEnd.parent = tassel;
  tasselEnd.position.set(0.68, -0.04, 0.1);
  ball('tassel-knob', tasselEnd, 0.11, [0, -0.04, 0], [1, 1, 1], C.orangeTop, C.orangeBot, 0.008);
  const fringe = paint(lathe('fringe', [[0.001, 0], [0.05, -0.005], [0.085, -0.03], [0.1, -0.08], [0.1, -0.16], [0.09, -0.24], [0.065, -0.31], [0.03, -0.34], [0.001, -0.345]], 28), C.orangeTop, C.orangeBot);
  fringe.parent = tasselEnd;
  fringe.position.y = -0.06;
  edge(fringe, 0.008);

  // Étoiles qui tournent au-dessus de la tête (pose « échec »)
  const stars = new TransformNode('stars', scene);
  stars.parent = headC;
  stars.position.y = 0.95;
  const starMeshes = [0, 1, 2].map((n) => {
    const st = MeshBuilder.CreatePolyhedron('star-' + n, { type: 1, size: 0.09 }, scene);
    st.parent = stars;
    st.material = M.star;
    return st;
  });


  if (pedestal) {
  // Socle doux et ombre
  const pedestal = softBlock('pedestal', 3.3, 0.2, 3.3, 2.6, 40);
  pedestal.position.y = -0.1;
  paint(pedestal, '#fbe9c4', '#e6c488');
  pedestal.__edge = '#c9a064';
  edge(pedestal, 0.02);
  const ring = MeshBuilder.CreateTorus('ring', { diameter: 2.7, thickness: 0.08, tessellation: 56 }, scene);
  ring.position.y = 0.012;
  paint(ring, C.orangeTop, C.orangeBot);
  }

  const shadow = MeshBuilder.CreateDisc('shadow', { radius: 0.85, tessellation: 36 }, scene);
  shadow.rotation.x = Math.PI / 2;
  shadow.position.y = 0.014;
  shadow.material = solid('#000000', { specular: 0, alpha: 0.2 });


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
