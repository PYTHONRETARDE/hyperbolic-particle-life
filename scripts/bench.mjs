// Headless benchmark of the simulation step: `npm run bench`.
// Handy for checking that an optimisation actually helps.

import { Surface } from '../src/surface.js';
import { Simulation } from '../src/sim.js';

const cases = [
  { genus: 2, count: 1200 },
  { genus: 2, count: 2400 },
  { genus: 2, count: 4800 },
  { genus: 3, count: 4800 },
];

console.log('genus  particles  ms/step  ghosts');
for (const { genus, count } of cases) {
  const sim = new Simulation(new Surface(genus), { params: { count }, seed: 13 });
  for (let i = 0; i < 200; i++) sim.step(); // let structures form; clustering changes the cost
  const steps = 100;
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) sim.step();
  const ms = (performance.now() - t0) / steps;
  console.log(`${String(genus).padStart(5)}  ${String(count).padStart(9)}  ${ms.toFixed(2).padStart(7)}  ${String(sim.ghostCount).padStart(6)}`);
}
