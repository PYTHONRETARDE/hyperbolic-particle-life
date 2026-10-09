/**
 * App wiring: simulation loop, camera controls, UI panel, shareable links.
 * Everything interesting is exposed on `window.hpl` for tinkering from the
 * browser console — see the README.
 */

import * as H from './hyperbolic.js';
import { Surface } from './surface.js';
import { Simulation } from './sim.js';
import { Renderer } from './render.js';
import { Camera } from './camera.js';
import { PALETTE, PRESETS } from './rules.js';
import { readState, writeState } from './state.js';

const DEFAULT_SEED = 13;
/** Draw tiles whose centre is within this distance of the camera. */
const VIEW_DEPTH = { 2: 6.5, 3: 5.6, 4: 5.0 };
const SPECIES_NAMES = ['red', 'amber', 'yellow', 'green', 'cyan', 'blue', 'violet', 'pink', 'mint', 'salmon', 'olive', 'white'];

const $ = (id) => document.getElementById(id);
const query = new URLSearchParams(location.search);
const canvas = $('view');

// ─── State ──────────────────────────────────────────────────────────────

const view = { tiling: true, copies: true, klein: false, glow: false, tour: true, tourSpeed: 0.18, size: 0.03, zoom: 1, offset: 0, lodFalloff: 0.9 };
let speed = 1;
let paused = false;

const initial = readState();
const params = {};
for (const k of ['count', 'species', 'radius', 'force', 'friction', 'beta', 'mutation']) {
  if (initial[k] !== undefined) params[k] = initial[k];
}

let surface = new Surface(initial.genus ?? 2);
const sim = new Simulation(surface, { params, seed: initial.seed ?? DEFAULT_SEED, matrix: initial.matrix });
const camera = new Camera(surface);
let allTiles = surface.tilesWithin(VIEW_DEPTH[surface.genus] + surface.circumradius);

let renderer = null;
try {
  renderer = new Renderer(canvas);
  renderer.setSurface(surface);
} catch (err) {
  showIntro(`Sorry — this needs WebGL2, which isn't available here (${err.message}).`);
}

function setGenus(g) {
  surface = new Surface(g);
  sim.setSurface(surface);
  camera.setSurface(surface);
  renderer?.setSurface(surface);
  allTiles = surface.tilesWithin(VIEW_DEPTH[g] + surface.circumradius);
  scheduleHash();
}

function newUniverse() {
  sim.reset((Math.random() * 2 ** 32) >>> 0);
  buildMatrix();
  scheduleHash();
}

/** Tiles near the camera, farthest first, with camera·tile already composed. */
function visibleTiles() {
  const c = camera.position();
  const coshDepth = Math.cosh(VIEW_DEPTH[surface.genus]);
  const out = [];
  for (const tile of allTiles) {
    const ch = c[0] * tile.center[0] - c[1] * tile.center[1] - c[2] * tile.center[2];
    if (ch > coshDepth) continue;
    out.push({ matrix: H.mul(camera.M, tile.matrix), distance: Math.acosh(Math.max(1, ch)), home: tile.distance === 0 });
  }
  return out.sort((a, b) => b.distance - a.distance);
}

// ─── Shareable URL ──────────────────────────────────────────────────────

function currentState() {
  const p = sim.params;
  return {
    genus: surface.genus, count: sim.count, species: p.species, radius: p.radius, force: p.force,
    friction: p.friction, beta: p.beta, mutation: p.mutation, seed: sim.seed, matrix: sim.matrix,
  };
}

let hashTimer = 0;
function scheduleHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, '', location.pathname + location.search + writeState(currentState())), 400);
}

// ─── Panel ──────────────────────────────────────────────────────────────

const syncers = [];

function bindRange(id, get, set, format) {
  const input = $(id), out = $(`${id}-out`);
  const sync = () => { input.value = get(); out.textContent = format(get()); };
  input.addEventListener('input', () => {
    set(parseFloat(input.value));
    out.textContent = format(get());
    scheduleHash();
  });
  syncers.push(sync);
  sync();
}

function bindCheck(id, key, onChange) {
  const input = $(id);
  const sync = () => { input.checked = view[key]; };
  input.addEventListener('change', () => { view[key] = input.checked; onChange?.(); });
  syncers.push(sync);
  sync();
}

const fixed = (d) => (v) => (+v).toFixed(d);

bindRange('count', () => sim.count, (v) => sim.setCount(v), (v) => v.toLocaleString());
bindRange('species', () => sim.params.species, (v) => { sim.setSpecies(v); buildMatrix(); }, String);
bindRange('mutation', () => sim.params.mutation, (v) => { sim.params.mutation = v; }, (v) => (v ? fixed(2)(v) : 'off'));
bindRange('radius', () => sim.params.radius, (v) => sim.setRadius(v), fixed(2));
bindRange('force', () => sim.params.force, (v) => { sim.params.force = v; }, fixed(1));
bindRange('friction', () => sim.params.friction, (v) => { sim.params.friction = v; }, (v) => `${fixed(3)(v)} s`);
bindRange('beta', () => sim.params.beta, (v) => { sim.params.beta = v; }, fixed(2));
bindRange('speed', () => speed, (v) => { speed = v; }, (v) => (v ? `${v}×` : 'paused'));
bindRange('size', () => view.size, (v) => { view.size = v; }, fixed(3));
bindCheck('tiling', 'tiling');
bindCheck('copies', 'copies');
bindCheck('klein', 'klein');
bindCheck('glow', 'glow');
bindCheck('tour', 'tour');
const syncAll = () => syncers.forEach((s) => s());

$('genus').value = String(surface.genus);
$('genus').addEventListener('change', (e) => setGenus(parseInt(e.target.value, 10)));
$('new-universe').addEventListener('click', newUniverse);
$('scatter').addEventListener('click', () => sim.scatter());
$('reset-view').addEventListener('click', () => { camera.M = H.identity(); view.zoom = 1; camera.velocity.speed = 0; });
$('share').addEventListener('click', share);
$('snapshot').addEventListener('click', snapshot);
$('about-link').addEventListener('click', (e) => { e.preventDefault(); showIntro(); });
for (const b of document.querySelectorAll('[data-preset]')) {
  b.addEventListener('click', () => {
    sim.setMatrix(PRESETS[b.dataset.preset](sim.params.species, sim.rng));
    paintMatrix();
    scheduleHash();
  });
}

const panel = $('panel'), toggle = $('panel-toggle');
function setPanel(open) {
  panel.classList.toggle('collapsed', !open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? '×' : '☰';
  layoutForPanel();
}

/** On wide screens, slide the disk left so the open panel doesn't cover it. */
function layoutForPanel() {
  const open = !panel.classList.contains('collapsed');
  view.offset = open && window.innerWidth > 900 ? -(panel.offsetWidth + 24) / 2 : 0;
}
window.addEventListener('resize', layoutForPanel);
toggle.addEventListener('click', () => setPanel(panel.classList.contains('collapsed')));
setPanel(query.get('panel') !== '0' && window.innerWidth > 640);

// ─── Rule matrix editor ─────────────────────────────────────────────────

let cells = [];
let paintedVersion = -1;

const rgb = (c, a = 1) => `rgba(${c.map((v) => Math.round(v * 255)).join(',')},${a})`;

function cellColour(v) {
  const a = Math.min(1, Math.abs(v));
  return v >= 0 ? `rgba(70, 225, 140, ${0.08 + 0.85 * a})` : `rgba(255, 80, 100, ${0.08 + 0.85 * a})`;
}

function buildMatrix() {
  const S = sim.params.species;
  const el = $('matrix');
  el.replaceChildren();
  el.style.gridTemplateColumns = `repeat(${S + 1}, 1fr)`;
  const dot = (s) => {
    const d = document.createElement('div');
    d.className = 'dot';
    d.style.background = rgb(PALETTE[s]);
    d.title = SPECIES_NAMES[s];
    return d;
  };
  const corner = document.createElement('div');
  corner.className = 'corner';
  corner.textContent = '→';
  corner.title = 'Row is attracted to (green) or repelled by (red) column';
  el.append(corner);
  for (let b = 0; b < S; b++) el.append(dot(b));
  cells = [];
  for (let a = 0; a < S; a++) {
    el.append(dot(a));
    for (let b = 0; b < S; b++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.setAttribute('role', 'gridcell');
      attachCellEditing(cell, a * S + b);
      cells.push(cell);
      el.append(cell);
    }
  }
  paintMatrix();
}

function paintMatrix() {
  const S = sim.params.species;
  cells.forEach((cell, i) => {
    const v = sim.matrix[i];
    cell.style.background = cellColour(v);
    cell.title = `${SPECIES_NAMES[Math.floor(i / S)]} → ${SPECIES_NAMES[i % S]}: ${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  });
  paintedVersion = sim.rulesVersion;
}

function attachCellEditing(cell, i) {
  let start = null;
  const set = (v) => {
    sim.matrix[i] = Math.max(-1, Math.min(1, v));
    sim.rulesVersion++;
    paintMatrix();
    scheduleHash();
  };
  cell.addEventListener('pointerdown', (e) => {
    cell.setPointerCapture(e.pointerId);
    start = { y: e.clientY, v: sim.matrix[i], moved: false };
  });
  cell.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    if (Math.abs(dy) > 2) start.moved = true;
    if (start.moved) set(start.v - dy / 70);
  });
  cell.addEventListener('pointerup', () => {
    // A plain click steps through −1, −0.5, 0, 0.5, 1.
    if (start && !start.moved) set(sim.matrix[i] >= 0.99 ? -1 : Math.floor(sim.matrix[i] * 2 + 1.01) / 2);
    start = null;
  });
  cell.addEventListener('wheel', (e) => {
    e.preventDefault();
    set(sim.matrix[i] - Math.sign(e.deltaY) * 0.05);
  }, { passive: false });
}

buildMatrix();

// ─── Camera controls ────────────────────────────────────────────────────

/** Screen position of an event, in disk units (the unit disk fills the view). */
function eventToDisk(e) {
  if (!renderer) return [2, 2];
  const rect = canvas.getBoundingClientRect();
  const { dpr, cx, cy, h, scale } = renderer.layout(view);
  const x = (e.clientX - rect.left) * dpr, y = h - (e.clientY - rect.top) * dpr;
  return [(x - cx) / scale, (y - cy) / scale];
}

/** Disk position → point in view space, or null if it is off the disk. */
function diskToView([u, v]) {
  if (u * u + v * v >= 0.995 * 0.995) return null;
  return view.klein ? H.fromKlein(u, v) : H.fromPoincare(u, v);
}

function viewToWorld(p) {
  return H.apply(H.inverse(camera.M), p);
}

function stopTour() {
  if (!view.tour) return;
  view.tour = false;
  syncAll();
}

const pointers = new Map();
let drag = null;
let pinch = null;

function stirAt(e, mode) {
  const p = diskToView(eventToDisk(e));
  sim.setStir(p && viewToWorld(p), 0.55, mode === 'push' ? -4 : 3);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  stopTour();
  camera.velocity.speed = 0;
  camera.target = null;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    drag = null;
    sim.setStir(null);
    return;
  }
  const mode = e.shiftKey || e.button === 2 ? 'push' : e.ctrlKey || e.metaKey || e.altKey ? 'pull' : 'fly';
  drag = { mode, last: diskToView(eventToDisk(e)), time: performance.now(), theta: 0, speed: 0 };
  if (mode === 'fly') canvas.classList.add('dragging');
  else stirAt(e, mode);
});

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    view.zoom = Math.min(12, Math.max(0.5, (pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d));
    return;
  }
  if (!drag) return;
  if (drag.mode !== 'fly') { stirAt(e, drag.mode); return; }
  const p = diskToView(eventToDisk(e));
  const now = performance.now();
  if (p && drag.last) {
    const T = H.transvection(drag.last, p);
    camera.transform(T);
    const o = H.apply(T, H.ORIGIN);
    const dt = Math.max((now - drag.time) / 1000, 1 / 240);
    const s = H.dist(H.ORIGIN, o) / dt;
    drag.theta = Math.atan2(o[2], o[1]);
    drag.speed = drag.speed * 0.5 + s * 0.5;
  }
  drag.last = p;
  drag.time = now;
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag?.mode === 'fly' && performance.now() - drag.time < 80) {
    camera.velocity.theta = drag.theta;
    camera.velocity.speed = Math.min(drag.speed, 8);
  }
  if (drag && drag.mode !== 'fly') sim.setStir(null);
  drag = null;
  canvas.classList.remove('dragging');
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener('dblclick', (e) => {
  const p = diskToView(eventToDisk(e));
  if (p) camera.focus(p);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.zoom = Math.min(12, Math.max(0.5, view.zoom * Math.exp(-e.deltaY * 0.0015)));
}, { passive: false });

// ─── Keyboard ───────────────────────────────────────────────────────────

const held = new Set();
const MOVE_KEYS = { ArrowUp: -Math.PI / 2, w: -Math.PI / 2, ArrowDown: Math.PI / 2, s: Math.PI / 2, ArrowLeft: 0, a: 0, ArrowRight: Math.PI, d: Math.PI };

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea') && e.key !== 'Escape') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k in MOVE_KEYS || k === 'q' || k === 'e') { held.add(k); stopTour(); e.preventDefault(); return; }
  const toggleView = (key) => { view[key] = !view[key]; syncAll(); };
  switch (k) {
    case ' ': paused = !paused; toast(paused ? 'Paused' : 'Running'); break;
    case 'n': newUniverse(); break;
    case 'r': sim.scatter(); break;
    case 't': toggleView('tiling'); break;
    case 'c': toggleView('copies'); break;
    case 'k': toggleView('klein'); break;
    case 'g': toggleView('glow'); break;
    case 'p': toggleView('tour'); break;
    case 'h': setPanel(panel.classList.contains('collapsed')); break;
    case 'f': document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); break;
    case '+': case '=': view.zoom = Math.min(12, view.zoom * 1.15); break;
    case '-': view.zoom = Math.max(0.5, view.zoom / 1.15); break;
    case '?': showIntro(); break;
    case 'Escape': hideIntro(); break;
    default: return;
  }
  e.preventDefault();
});
window.addEventListener('keyup', (e) => held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
window.addEventListener('blur', () => held.clear());

// ─── Intro, toast, share, snapshot ──────────────────────────────────────

function showIntro(error) {
  $('intro').hidden = false;
  if (error) {
    $('intro-error').hidden = false;
    $('intro-error').textContent = error;
  }
  $('intro-close').focus();
}

function hideIntro() {
  $('intro').hidden = true;
  try { localStorage.setItem('hpl-intro-seen', '1'); } catch { /* private mode */ }
}

$('intro-close').addEventListener('click', hideIntro);
$('intro').addEventListener('click', (e) => { if (e.target.id === 'intro') hideIntro(); });

let seenIntro = false;
try { seenIntro = localStorage.getItem('hpl-intro-seen') === '1'; } catch { /* private mode */ }
if (!seenIntro && query.get('intro') !== '0') showIntro();

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

async function share() {
  const url = location.origin + location.pathname + writeState(currentState());
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied — it recreates this universe');
  } catch {
    window.prompt('Copy this link:', url);
  }
}

function snapshot() {
  if (!renderer) return;
  renderer.render({ sim, tiles: visibleTiles(), view });
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hyperbolic-life-g${surface.genus}-${sim.seed}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

// ─── Main loop ──────────────────────────────────────────────────────────

const stats = { fps: 0, simMs: 0, drawn: 0, tiles: 0 };
let last = performance.now();
let frames = 0, statTime = last, tourClock = 0, tourHeading = Math.random() * Math.PI * 2;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (!paused && speed > 0) {
    const t0 = performance.now();
    for (let i = 0; i < speed; i++) sim.step();
    stats.simMs = stats.simMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  for (const k of held) {
    if (k in MOVE_KEYS) camera.glide(MOVE_KEYS[k], dt * 1.2);
    else camera.rotate((k === 'q' ? 1 : -1) * dt * 1.2);
  }
  if (view.tour) {
    tourClock += dt;
    tourHeading += dt * 0.12 * Math.sin(tourClock * 0.21);
    camera.glide(tourHeading, dt * view.tourSpeed);
  }
  camera.update(dt);

  if (renderer) {
    const tiles = visibleTiles();
    const r = renderer.render({ sim, tiles, view });
    stats.drawn = r.drawn;
    stats.tiles = tiles.length;
  }

  if (sim.rulesVersion !== paintedVersion && now - (frame.lastPaint || 0) > 200) {
    paintMatrix();
    frame.lastPaint = now;
  }

  frames++;
  if (now - statTime > 500) {
    stats.fps = (frames * 1000) / (now - statTime);
    frames = 0;
    statTime = now;
    $('hud').textContent =
      `${stats.fps.toFixed(0)} fps · sim ${stats.simMs.toFixed(1)} ms · t ${sim.time.toFixed(0)} s\n` +
      `${sim.count.toLocaleString()} particles · ${sim.ghostCount.toLocaleString()} ghosts · ` +
      `${stats.tiles} copies · ${(stats.drawn / 1000).toFixed(0)}k drawn${paused ? ' · paused' : ''}`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Console API for tinkerers: try `hpl.sim.params.force = 25` or `hpl.H.dist(...)`.
window.hpl = {
  H, sim, camera, view, Surface, PRESETS,
  get surface() { return surface; },
  setGenus, newUniverse,
  /** Draw a frame right now (useful before reading the canvas, e.g. for recordings). */
  renderNow: () => renderer?.render({ sim, tiles: visibleTiles(), view }),
  set speed(v) { speed = v; syncAll(); },
  get speed() { return speed; },
};
