import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/hyperbolic.js';
import { Surface } from '../src/surface.js';
import { Simulation, kernel } from '../src/sim.js';
import { PRESETS, decodeMatrix, encodeMatrix, mulberry32 } from '../src/rules.js';

test('kernel repels up close, follows the rule further out, vanishes beyond the radius', () => {
  assert.equal(kernel(0, 1, 0.3), -1);
  assert.ok(kernel(0.1, 1, 0.3) < 0);
  assert.ok(Math.abs(kernel(0.65, 0.7, 0.3) - 0.7) < 1e-12);
  assert.ok(kernel(0.65, -0.7, 0.3) < 0);
  assert.equal(kernel(1.2, 1, 0.3), 0);
});

test('particles stay on the surface: on the hyperboloid, inside the polygon, velocities tangent', () => {
  const surface = new Surface(2);
  const sim = new Simulation(surface, { params: { count: 600 }, seed: 3 });
  for (let s = 0; s < 150; s++) sim.step();
  for (let i = 0; i < sim.count; i++) {
    const p = [sim.pt[i], sim.px[i], sim.py[i]];
    const v = [sim.vt[i], sim.vx[i], sim.vy[i]];
    assert.ok(Math.abs(H.mdot(p, p) + 1) < 1e-9);
    assert.ok(surface.contains(p, 1e-9), `particle ${i} escaped`);
    assert.ok(Math.abs(H.mdot(p, v)) < 1e-9);
  }
  assert.ok(sim.ghostCount > 0, 'particles near the edges should have ghosts');
});

test('the same seed gives the same universe', () => {
  const run = () => {
    const sim = new Simulation(new Surface(2), { params: { count: 300 }, seed: 42 });
    for (let s = 0; s < 40; s++) sim.step();
    return Array.from(sim.px);
  };
  assert.deepEqual(run(), run());
});

test('a particle drifting off one side reappears through the opposite side', () => {
  const surface = new Surface(2);
  const sim = new Simulation(surface, { params: { count: 1, friction: 1e9, force: 0 }, seed: 1 });
  // Start just inside side 0 moving outward along the x axis.
  const p = H.fromPolar(0, surface.inradius - 0.01);
  [sim.pt[0], sim.px[0], sim.py[0]] = p;
  const v = H.projectTangent(p, [0, 1, 0]);
  const speed = 1 / H.tangentNorm(v);
  [sim.vt[0], sim.vx[0], sim.vy[0]] = v.map((c) => c * speed);
  for (let s = 0; s < 3; s++) sim.step();
  assert.ok(sim.px[0] < 0, `expected to re-enter near side 4, got x = ${sim.px[0]}`);
  assert.ok(surface.contains([sim.pt[0], sim.px[0], sim.py[0]]));
});

test('two particles across a glued edge feel each other', () => {
  const surface = new Surface(2);
  const sim = new Simulation(surface, { params: { count: 2, species: 1, friction: 1e9 }, seed: 1, matrix: new Float32Array([1]) });
  const d = surface.inradius;
  // One just inside side 0, one just inside the opposite side: 0.2 apart on the surface.
  const a = H.fromPolar(0, d - 0.1), b = H.fromPolar(Math.PI, d - 0.1);
  [sim.pt[0], sim.px[0], sim.py[0]] = a;
  [sim.pt[1], sim.px[1], sim.py[1]] = b;
  sim.step();
  assert.ok(sim.vx[0] > 0, 'particle near side 0 should be pulled outward, towards its neighbour');
  assert.ok(sim.vx[1] < 0, 'particle near side 4 should be pulled outward too');
});

test('changing count and species keeps the simulation valid', () => {
  const sim = new Simulation(new Surface(3), { params: { count: 200 }, seed: 9 });
  sim.setCount(500);
  sim.setSpecies(9);
  sim.setRadius(0.5);
  for (let s = 0; s < 10; s++) sim.step();
  assert.equal(sim.count, 500);
  assert.ok(Array.from(sim.type).every((t) => t < 9));
  sim.setCount(100);
  sim.setSpecies(3);
  sim.step();
  assert.ok(Array.from(sim.type).every((t) => t < 3));
});

test('rule matrices survive a round trip through a URL', () => {
  const m = PRESETS.random(7, mulberry32(1));
  const decoded = decodeMatrix(encodeMatrix(m), 7);
  m.forEach((v, i) => assert.ok(Math.abs(v - decoded[i]) <= 0.05 + 1e-6));
  assert.equal(decodeMatrix('xyz', 7), null);
});
