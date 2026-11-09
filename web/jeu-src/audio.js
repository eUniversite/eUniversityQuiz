// Sons du jeu, générés en direct avec WebAudio : aucun fichier, aucune licence.
// - musique chiptune en boucle (mode "run" entraînant, mode "quiz" plus calme et tendu)
// - bruitages : pièce, saut, glissade, atterrissage, collision, question, bonne/mauvaise réponse, victoire, défaite
// Les navigateurs interdisent le son avant un geste de l'utilisateur : unlock() est appelé à la première touche / au premier toucher.

const N = { // fréquences (Hz)
  C2: 65.41, F2: 87.31, G2: 98, A2: 110,
  C3: 130.81, F3: 174.61, G3: 196, A3: 220,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568,
};

// Grille d'accords : C – Am – F – G (une mesure chacun, 16 pas par mesure)
const BARS = [
  { root: N.C2, bass: N.C3, arp: [N.C5, N.E5, N.G5, N.E5], mel: [N.E5, 0, N.G5, 0, N.C6, 0, N.G5, 0, N.E5, 0, N.G5, N.A5, N.G5, 0, 0, 0] },
  { root: N.A2, bass: N.A3, arp: [N.A4, N.C5, N.E5, N.C5], mel: [N.C6, 0, N.A5, 0, N.E5, 0, N.A5, 0, N.C6, 0, N.B5, N.A5, N.E5, 0, 0, 0] },
  { root: N.F2, bass: N.F3, arp: [N.A4, N.C5, N.F5, N.C5], mel: [N.A5, 0, N.F5, 0, N.C6, 0, N.A5, 0, N.F5, 0, N.A5, N.C6, N.A5, 0, 0, 0] },
  { root: N.G2, bass: N.G3, arp: [N.B4, N.D5, N.G5, N.D5], mel: [N.G5, 0, N.B5, 0, N.D5, 0, N.G5, 0, N.B5, 0, N.C6, N.B5, N.G5, 0, 0, 0] },
];

const BPM = 132;
const STEP = 60 / BPM / 4;

let ctx = null;
let master, musicGain, sfxGain, noiseBuf;
let muted = false;
try { muted = localStorage.getItem('study-muted') === '1'; } catch { /* stockage indisponible */ }

let mode = 'off';            // 'off' | 'run' | 'quiz'
let paused = false;
let step = 0;
let nextTime = 0;
let timer = null;
let coinCombo = 0;
let lastCoin = 0;
const listeners = new Set();

function init() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.8;
  master.connect(ctx.destination);
  musicGain = ctx.createGain();
  musicGain.gain.value = 0.22;
  musicGain.connect(master);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.55;
  sfxGain.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return true;
}

// --- Briques de base ------------------------------------------------------------
function tone(freq, t, dur, { type = 'square', vol = 0.3, to = 0, attack = 0.005, dest = sfxGain } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(t, dur, { vol = 0.3, freq = 4000, type = 'highpass', to = 0, dest = sfxGain } = {}) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(dest);
  s.start(t);
  s.stop(t + dur + 0.02);
}

// --- Musique ---------------------------------------------------------------------
function playStep(t) {
  const bar = BARS[Math.floor(step / 16) % BARS.length];
  const s = step % 16;
  const out = { dest: musicGain };

  if (mode === 'run') {
    if (s % 4 === 0) { // grosse caisse
      tone(150, t, 0.12, { type: 'sine', vol: 0.9, to: 45, ...out });
    }
    if (s % 4 === 2) noise(t, 0.04, { vol: 0.18, freq: 7000, ...out });          // charleston
    if (s === 4 || s === 12) noise(t, 0.12, { vol: 0.35, freq: 1800, type: 'bandpass', ...out }); // caisse claire
    if (s % 2 === 0) tone(s % 4 === 0 ? bar.bass : bar.bass * 2, t, STEP * 1.6, { type: 'triangle', vol: 0.5, ...out });
    if (s % 2 === 1 || s % 4 === 0) tone(bar.arp[(s >> 1) % 4], t, STEP * 0.9, { type: 'square', vol: 0.06, ...out });
    const m = bar.mel[s];
    if (m) tone(m, t, STEP * 1.8, { type: 'square', vol: 0.11, ...out });
  } else if (mode === 'quiz') {
    // Tension douce : basse tenue, arpège lent, petit "tic" de réflexion
    if (s === 0) tone(bar.root * 2, t, STEP * 14, { type: 'triangle', vol: 0.5, attack: 0.04, ...out });
    if (s % 4 === 0) tone(bar.arp[(s >> 2) % 4] / 2, t, STEP * 3, { type: 'triangle', vol: 0.16, ...out });
    if (s % 8 === 4) noise(t, 0.025, { vol: 0.12, freq: 6000, ...out });
  }
  step++;
}

function schedule() {
  if (!ctx || mode === 'off' || paused) return;
  while (nextTime < ctx.currentTime + 0.18) {
    playStep(nextTime);
    nextTime += STEP;
  }
}

function startLoop() {
  if (timer || !ctx) return;
  nextTime = ctx.currentTime + 0.05;
  timer = setInterval(schedule, 40);
}

function stopLoop() {
  clearInterval(timer);
  timer = null;
}

// --- Bruitages -------------------------------------------------------------------
const SFX = {
  coin(t) {
    const now = performance.now();
    coinCombo = now - lastCoin < 900 ? Math.min(coinCombo + 1, 6) : 0;
    lastCoin = now;
    const k = 2 ** (coinCombo / 12 * 2);                                // monte par tons entiers à chaque pièce de suite
    tone(N.E5 * k, t, 0.07, { vol: 0.28 });
    tone(N.B5 * k, t + 0.065, 0.16, { vol: 0.28 });
  },
  jump(t) { tone(280, t, 0.2, { type: 'square', vol: 0.2, to: 760 }); },
  slide(t) { noise(t, 0.38, { vol: 0.35, freq: 600, type: 'bandpass', to: 3200 }); },
  swish(t) { noise(t, 0.1, { vol: 0.14, freq: 1800, type: 'bandpass', to: 5000 }); },
  land(t) { tone(130, t, 0.12, { type: 'sine', vol: 0.5, to: 55 }); noise(t, 0.05, { vol: 0.12, freq: 900, type: 'lowpass' }); },
  crash(t) {
    noise(t, 0.35, { vol: 0.6, freq: 2600, type: 'lowpass', to: 200 });
    tone(180, t, 0.3, { type: 'sawtooth', vol: 0.35, to: 40 });
  },
  question(t) { // alerte "zone savoir"
    [N.G4, N.C5, N.E5, N.G5].forEach((f, i) => tone(f, t + i * 0.07, 0.18, { vol: 0.24 }));
    tone(N.C6, t + 0.3, 0.45, { type: 'triangle', vol: 0.3 });
  },
  tick(t) { tone(N.A5, t, 0.05, { type: 'square', vol: 0.22 }); },
  select(t) { tone(N.C5, t, 0.06, { vol: 0.25 }); tone(N.G5, t + 0.05, 0.1, { vol: 0.25 }); },
  correct(t) { // fanfare courte
    [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => tone(f, t + i * 0.07, 0.22, { vol: 0.26 }));
    tone(N.G5, t + 0.35, 0.5, { type: 'triangle', vol: 0.3 });
    tone(N.C6, t + 0.35, 0.5, { type: 'square', vol: 0.12 });
  },
  wrong(t) {
    tone(N.G4, t, 0.18, { type: 'sawtooth', vol: 0.3, to: N.E4 });
    tone(N.D4, t + 0.18, 0.4, { type: 'sawtooth', vol: 0.3, to: 90 });
  },
  door(t) { noise(t, 0.6, { vol: 0.22, freq: 300, type: 'lowpass', to: 1800 }); tone(110, t, 0.5, { type: 'triangle', vol: 0.3, to: 220 }); },
  victory(t) {
    const m = [N.C5, N.E5, N.G5, N.C6, 0, N.G5, N.C6, N.E6, N.G6];
    m.forEach((f, i) => { if (f) tone(f, t + i * 0.13, 0.3, { vol: 0.25 }); });
    [N.C4, N.G4, N.C5].forEach((f) => tone(f, t + 1.2, 1.1, { type: 'triangle', vol: 0.3 }));
    tone(N.C6, t + 1.2, 1.1, { type: 'square', vol: 0.12 });
  },
  gameover(t) {
    [N.G4, N.E4, N.C4].forEach((f, i) => tone(f, t + i * 0.28, 0.4, { type: 'triangle', vol: 0.38 }));
    tone(N.C3, t + 0.84, 1.0, { type: 'sawtooth', vol: 0.25, to: 50 });
  },
};

// --- API publique ----------------------------------------------------------------
export const audio = {
  // À appeler depuis un geste (touche, toucher) : crée le contexte et lance la musique voulue.
  unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (mode !== 'off') startLoop();
  },
  sfx(name) {
    if (!ctx || muted || ctx.state !== 'running' || !SFX[name]) return;
    SFX[name](ctx.currentTime + 0.01);
  },
  setMode(next) {
    if (next === mode) return;
    mode = next;
    if (next === 'off') { stopLoop(); return; }
    step = Math.ceil(step / 16) * 16;                                   // on repart au début d'une mesure
    if (ctx) { nextTime = Math.max(nextTime, ctx.currentTime + 0.05); startLoop(); }
  },
  setPaused(p) {
    paused = p;
    if (ctx && !p) nextTime = ctx.currentTime + 0.05;
  },
  toggleMute() {
    muted = !muted;
    try { localStorage.setItem('study-muted', muted ? '1' : '0'); } catch { /* ignoré */ }
    if (ctx) master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.03);
    listeners.forEach((fn) => fn(muted));
    return muted;
  },
  get muted() { return muted; },
  onMute(fn) { listeners.add(fn); },
};
