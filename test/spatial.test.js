import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/hyperbolic.js';
import { HorocycleGrid } from '../src/spatial.js';
import { mulberry32 } from '../src/rules.js';

test('grid queries find exactly the points a brute-force search finds', () => {
  const rng = mulberry32(5);
  const N = 3000;
  const T = new Float64Array(N), X = new Float64Array(N), Y = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const p = H.fromPolar(rng() * 2 * Math.PI, Math.acosh(1 + rng() * (Math.cosh(3.5) - 1)));
    [T[i], X[i], Y[i]] = p;
  }
  const out = new Uint32Array(N);
  for (const r of [0.15, 0.4, 1.0]) {
    const grid = new HorocycleGrid();
    grid.build(T, X, Y, N, r);
    for (let q = 0; q < 200; q++) {
      const p = [T[q], X[q], Y[q]];
      const n = grid.query(p[0], p[1], p[2], r, out);
      const got = new Set();
      for (let k = 0; k < n; k++) {
        const j = out[k];
        if (H.dist(p, [T[j], X[j], Y[j]]) < r) got.add(j);
      }
      const want = new Set();
      for (let j = 0; j < N; j++) if (H.dist(p, [T[j], X[j], Y[j]]) < r) want.add(j);
      assert.deepEqual([...got].sort(), [...want].sort(), `radius ${r}, query ${q}`);
      assert.equal(new Set(Array.from(out.subarray(0, n))).size, n, 'no duplicates');
    }
  }
});
