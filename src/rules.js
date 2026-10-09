/**
 * Interaction rules: an S×S matrix where entry [a][b] says how strongly a
 * particle of species a is pulled towards (+) or pushed from (−) species b.
 * The matrix need not be symmetric — a can chase b while b flees a, which is
 * where most of the life-like behaviour comes from.
 */

export const MAX_SPECIES = 12;

export const PALETTE = [
  [1.0, 0.33, 0.37], [1.0, 0.72, 0.25], [0.98, 0.96, 0.38], [0.36, 0.94, 0.52],
  [0.26, 0.85, 0.98], [0.42, 0.52, 1.0], [0.78, 0.43, 1.0], [1.0, 0.45, 0.82],
  [0.62, 1.0, 0.86], [1.0, 0.6, 0.5], [0.7, 0.8, 0.4], [0.9, 0.9, 0.95],
];

/** Small, fast, seedable PRNG. Same seed → same universe. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idx = (S, a, b) => a * S + b;

export const PRESETS = {
  random(S, rng) {
    const m = new Float32Array(S * S);
    for (let i = 0; i < m.length; i++) m[i] = rng() * 2 - 1;
    return m;
  },
  symmetric(S, rng) {
    const m = new Float32Array(S * S);
    for (let a = 0; a < S; a++) {
      for (let b = a; b < S; b++) m[idx(S,a, b)] = m[idx(S,b, a)] = rng() * 2 - 1;
    }
    return m;
  },
  /** Each species loves itself and follows the next one: long wriggling chains. */
  snakes(S) {
    const m = new Float32Array(S * S);
    for (let a = 0; a < S; a++) {
      m[idx(S,a, a)] = 1;
      m[idx(S,a, (a + 1) % S)] = 0.2;
    }
    return m;
  },
  /** A predator–prey ring: everyone chases the next species and flees the previous. */
  hunt(S) {
    const m = new Float32Array(S * S);
    for (let a = 0; a < S; a++) {
      m[idx(S,a, a)] = 0.6;
      m[idx(S,a, (a + 1) % S)] = 0.9;
      m[idx(S,a, (a + S - 1) % S)] = -0.9;
    }
    return m;
  },
  /** Strong self-attraction, mild mutual repulsion: membranes and cells. */
  cells(S, rng) {
    const m = new Float32Array(S * S);
    for (let a = 0; a < S; a++) {
      for (let b = 0; b < S; b++) m[idx(S,a, b)] = a === b ? 0.9 : -0.1 - 0.4 * rng();
    }
    return m;
  },
};

// Matrices travel in URLs as one letter per entry: 'a' = −1 … 'k' = 0 … 'u' = +1.
const ALPHABET = 'abcdefghijklmnopqrstu';

export function encodeMatrix(m) {
  let s = '';
  for (const v of m) s += ALPHABET[Math.round((Math.max(-1, Math.min(1, v)) + 1) * 10)];
  return s;
}

export function decodeMatrix(str, S) {
  if (typeof str !== 'string' || str.length !== S * S) return null;
  const m = new Float32Array(S * S);
  for (let i = 0; i < m.length; i++) {
    const idx = ALPHABET.indexOf(str[i]);
    if (idx < 0) return null;
    m[i] = idx / 10 - 1;
  }
  return m;
}
