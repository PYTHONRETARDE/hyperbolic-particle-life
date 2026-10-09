import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/hyperbolic.js';
import { Surface } from '../src/surface.js';
import { mulberry32 } from '../src/rules.js';

const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

for (const genus of [2, 3, 4]) {
  const S = new Surface(genus);
  const n = S.sides;

  test(`genus ${genus}: corners sit on the side lines and corner angles are 2π/${n}`, () => {
    for (let k = 0; k < n; k++) {
      const v = S.vertices[k];
      const side = (k + 1) % n; // vertex k joins side k and side k+1
      for (const s of [k, side]) {
        const N = S.normals.subarray(3 * s, 3 * s + 3);
        close(-N[0] * v[0] + N[1] * v[1] + N[2] * v[2], 0, 1e-9);
      }
      const prev = S.vertices[(k + n - 1) % n], next = S.vertices[(k + 1) % n];
      const a = H.logMap(v, prev), b = H.logMap(v, next);
      const angle = Math.acos(H.mdot(a, b) / (H.tangentNorm(a) * H.tangentNorm(b)));
      close(angle, (2 * Math.PI) / n, 1e-9);
    }
  });

  test(`genus ${genus}: generator k maps the opposite side onto side k`, () => {
    for (let k = 0; k < n; k++) {
      const g = S.generators[k];
      const o = S.opposite(k);
      // Opposite side runs from vertex o−1 to vertex o; side k from vertex k−1 to k.
      // The translation keeps the orientation: vertex o−1 lands on vertex k, o on k−1.
      const a = H.apply(g, S.vertices[(o + n - 1) % n]);
      const b = H.apply(g, S.vertices[o]);
      const ends = [S.vertices[(k + n - 1) % n], S.vertices[k]];
      // acosh near 1 only resolves distances to ~√ε, hence the loose tolerance.
      const hit = (p) => ends.some((q) => H.dist(p, q) < 1e-5);
      assert.ok(hit(a) && hit(b), `side ${o} should land on side ${k}`);
      close(H.dist(a, b), H.dist(...ends), 1e-9);
      assert.ok(H.mul(g, S.generators[o]).every((v, i) => Math.abs(v - H.identity()[i]) < 1e-9));
    }
  });

  test(`genus ${genus}: tiles never overlap and fill area at the right rate`, () => {
    const radius = 2 * S.inradius + 2;
    const tiles = S.tilesWithin(radius);
    for (let i = 0; i < tiles.length; i++) {
      for (let j = 0; j < i; j++) {
        const d = H.dist(tiles[i].center, tiles[j].center);
        assert.ok(d > 2 * S.inradius - 1e-6, `tile centres ${i},${j} too close: ${d}`);
      }
    }
    // Each tile has area 4π(g−1); the ball has area 2π(cosh r − 1).
    // Tiles centred in the ball cover roughly the ball, give or take its rim.
    const expected = (2 * Math.PI * (Math.cosh(radius) - 1)) / S.area;
    assert.ok(tiles.length > expected * 0.3 && tiles.length < expected * 3, `${tiles.length} vs ~${expected}`);
  });

  test(`genus ${genus}: reduce() lands every point inside the polygon by an isometry`, () => {
    const rng = mulberry32(genus * 101);
    for (let k = 0; k < 200; k++) {
      const p = H.fromPolar(rng() * 2 * Math.PI, rng() * 9);
      const { point, matrix } = S.reduce(p);
      assert.ok(S.contains(point, 1e-9), 'reduced point must be inside');
      const back = H.apply(matrix, p);
      close(H.dist(back, point), 0, 1e-5 * Math.cosh(9));
    }
  });
}

test('genus 2 is the Bolza surface: systole 2·arccosh(1+√2)', () => {
  const S = new Surface(2);
  close(Math.cosh(S.inradius), 1 + Math.SQRT2, 1e-12);
  close(S.area, 4 * Math.PI);
});

test('rejects genus below 2', () => {
  assert.throws(() => new Surface(1), RangeError);
});
