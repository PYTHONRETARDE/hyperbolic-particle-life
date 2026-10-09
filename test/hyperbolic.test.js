import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/hyperbolic.js';
import { mulberry32 } from '../src/rules.js';

const close = (a, b, eps = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const closeVec = (a, b, eps = 1e-9) => a.forEach((v, i) => close(v, b[i], eps, `[${i}]`));

function randomPoint(rng, maxR = 3) {
  return H.fromPolar(rng() * 2 * Math.PI, rng() * maxR);
}

function randomTangent(rng, p, scale = 1) {
  return H.projectTangent(p, [(rng() - 0.5) * scale, (rng() - 0.5) * scale, (rng() - 0.5) * scale]);
}

function randomIsometry(rng) {
  return H.mul(H.rotation(rng() * 6.3), H.mul(H.boost(rng() * 3), H.rotation(rng() * 6.3)));
}

test('points from polar coordinates lie on the hyperboloid at the right distance', () => {
  const p = H.fromPolar(1.234, 2.5);
  close(H.mdot(p, p), -1);
  close(H.dist(H.ORIGIN, p), 2.5);
});

test('Lorentz matrices preserve the Minkowski form and invert via J·Mᵀ·J', () => {
  const rng = mulberry32(7);
  for (let k = 0; k < 50; k++) {
    const M = randomIsometry(rng);
    const a = randomPoint(rng), b = randomPoint(rng);
    close(H.mdot(H.apply(M, a), H.apply(M, b)), H.mdot(a, b), 1e-7);
    closeVec(H.mul(M, H.inverse(M)), H.identity(), 1e-9);
  }
});

test('translation moves the origin the requested distance in the requested direction', () => {
  const T = H.translation(0.7, 1.9);
  closeVec(H.apply(T, H.ORIGIN), H.fromPolar(0.7, 1.9));
});

test('exp and log are inverse to each other', () => {
  const rng = mulberry32(11);
  for (let k = 0; k < 50; k++) {
    const p = randomPoint(rng), q = randomPoint(rng);
    const v = H.logMap(p, q);
    close(H.mdot(p, v), 0, 1e-9);
    close(H.tangentNorm(v), H.dist(p, q), 1e-8);
    closeVec(H.expMap(p, v), q, 1e-7);
  }
});

test('parallel transport keeps vectors tangent and preserves their length and angles', () => {
  const rng = mulberry32(13);
  for (let k = 0; k < 50; k++) {
    const p = randomPoint(rng), q = randomPoint(rng);
    const v = randomTangent(rng, p), w = randomTangent(rng, p);
    const v2 = H.parallelTransport(p, q, v), w2 = H.parallelTransport(p, q, w);
    close(H.mdot(q, v2), 0, 1e-8);
    close(H.mdot(v2, w2), H.mdot(v, w), 1e-7);
  }
});

test('transporting the direction of travel gives the arrival direction', () => {
  const p = H.fromPolar(0.3, 1), v = H.projectTangent(p, [0.1, 0.8, -0.4]);
  const q = H.expMap(p, v);
  const arrival = H.parallelTransport(p, q, v);
  // Walking a little further must agree with walking all the way in one go.
  const twice = H.expMap(p, [2 * v[0], 2 * v[1], 2 * v[2]]);
  closeVec(H.expMap(q, arrival), twice, 1e-8);
});

test('transvection slides a onto b and is an isometry', () => {
  const rng = mulberry32(17);
  for (let k = 0; k < 30; k++) {
    const a = randomPoint(rng), b = randomPoint(rng), c = randomPoint(rng);
    const T = H.transvection(a, b);
    closeVec(H.apply(T, a), b, 1e-7);
    close(H.dist(H.apply(T, c), H.apply(T, a)), H.dist(c, a), 1e-6);
  }
});

test('Poincaré, Klein and half-plane coordinates agree with the hyperboloid', () => {
  const rng = mulberry32(19);
  for (let k = 0; k < 50; k++) {
    const p = randomPoint(rng), q = randomPoint(rng);
    closeVec(H.fromPoincare(...H.toPoincare(p)), p, 1e-8);
    closeVec(H.fromKlein(...H.toKlein(p)), p, 1e-8);
    const [X1, Y1] = H.toHalfPlane(p), [X2, Y2] = H.toHalfPlane(q);
    const halfPlaneCosh = 1 + ((X1 - X2) ** 2 + (Y1 - Y2) ** 2) / (2 * Y1 * Y2);
    close(halfPlaneCosh, -H.mdot(p, q), 1e-7 * halfPlaneCosh);
  }
});

test('renormalize repairs a drifted isometry', () => {
  const M = H.translation(1, 2);
  const noisy = M.map((v, i) => v + (i % 2 ? 1e-4 : -1e-4));
  const fixed = H.renormalize(noisy);
  closeVec(H.mul(fixed, H.inverse(fixed)), H.identity(), 1e-12);
  closeVec(fixed, M, 1e-3);
});
