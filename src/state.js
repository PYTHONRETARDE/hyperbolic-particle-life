/**
 * Shareable state: everything needed to recreate a universe lives in the URL
 * hash, e.g.  #g=2&n=2400&s=6&r=0.32&seed=1234&m=kqd…
 */

import { decodeMatrix, encodeMatrix } from './rules.js';

const FIELDS = {
  g: ['genus', 'int'],
  n: ['count', 'int'],
  s: ['species', 'int'],
  r: ['radius', 'num'],
  f: ['force', 'num'],
  fr: ['friction', 'num'],
  b: ['beta', 'num'],
  mu: ['mutation', 'num'],
  seed: ['seed', 'int'],
};

const LIMITS = {
  genus: [2, 4], count: [50, 12000], species: [1, 12], radius: [0.05, 1.2],
  force: [0, 60], friction: [0.005, 2], beta: [0.05, 0.9], mutation: [0, 2], seed: [0, 2 ** 32 - 1],
};

export function readState(hash = location.hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const state = {};
  for (const [key, [name, kind]] of Object.entries(FIELDS)) {
    if (!p.has(key)) continue;
    const v = kind === 'int' ? parseInt(p.get(key), 10) : parseFloat(p.get(key));
    if (!Number.isFinite(v)) continue;
    const [lo, hi] = LIMITS[name];
    state[name] = Math.min(hi, Math.max(lo, v));
  }
  if (p.has('m') && state.species) {
    const m = decodeMatrix(p.get('m'), state.species);
    if (m) state.matrix = m;
  }
  return state;
}

export function writeState(state) {
  const p = new URLSearchParams();
  for (const [key, [name]] of Object.entries(FIELDS)) {
    const v = state[name];
    if (v === undefined) continue;
    p.set(key, Number.isInteger(v) ? String(v) : String(+v.toFixed(4)));
  }
  if (state.matrix) p.set('m', encodeMatrix(state.matrix));
  return '#' + p.toString();
}
