import {
  Engine, Scene, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, ArcRotateCamera,
} from '@babylonjs/core';
import { createStudent } from './lowpoly.js';

// Atelier personnage : le même étudiant que dans le jeu, sur un socle, avec ses poses.
const canvas = document.getElementById('c');
const engine = new Engine(canvas, true, { alpha: true, preserveDrawingBuffer: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0, 0, 0, 0);

const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0.25), scene);
hemi.intensity = 0.95;
hemi.diffuse = new Color3(1, 0.98, 0.94);
hemi.groundColor = new Color3(0.62, 0.45, 0.3);
const key = new DirectionalLight('key', new Vector3(-0.5, -0.9, 0.7), scene);
key.diffuse = new Color3(1, 0.96, 0.88);
key.specular = new Color3(1, 0.95, 0.85);
key.intensity = 0.4;

const students = { boy: createStudent(scene, 'boy'), girl: createStudent(scene, 'girl') };
let student = students.boy;
const setWho = (who) => {
  student = students[who];
  for (const [k, v] of Object.entries(students)) { v.root.setEnabled(k === who); v.shadow.setEnabled(k === who); }
};
setWho(new URLSearchParams(location.search).get('who') === 'girl' ? 'girl' : 'boy');
let pose = 'idle';
scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  student.update(pose, dt, performance.now() / 1000);
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
for (const b of document.querySelectorAll('button[data-who]')) {
  b.addEventListener('click', () => {
    setWho(b.dataset.who);
    document.querySelectorAll('button[data-who]').forEach((x) => x.classList.toggle('on', x === b));
  });
}

window.__lab = { setWho, setPose: (p) => { pose = p; }, camera, setSpin: (v) => { spin = v; } };

window.addEventListener('resize', () => engine.resize());
engine.runRenderLoop(() => scene.render());
