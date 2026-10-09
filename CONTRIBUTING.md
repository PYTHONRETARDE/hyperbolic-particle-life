# Contributing

Thanks for wanting to help! This project is small enough to understand in an afternoon, and a deliberately easy place to make your first contribution to a graphics or maths project.

## Getting set up

```bash
git clone https://github.com/PYTHONRETARDE/hyperbolic-particle-life.git
cd hyperbolic-particle-life
npm start        # http://localhost:8080, reloads are instant: there is no build
npm test         # must stay green
```

You only need `npm install` for `npm run record`, which uses headless Chrome to make screenshots and GIFs.

## Ground rules

- **No runtime dependencies and no build step.** Anyone should be able to read the source in the browser's dev tools exactly as it is in the repo.
- **Geometry gets a test.** If you add a formula to `hyperbolic.js`, `surface.js` or `spatial.js`, add a property test in `test/` (see the existing ones: they check invariants on random inputs rather than hand-picked numbers).
- **Hot loops stay allocation-free.** `Simulation.step` runs about 60 times a second over thousands of particles. It works on flat typed arrays on purpose. Run `npm run bench` before and after a performance change and put the numbers in your PR.
- **Explain the maths in comments**, briefly. If it needs more than a few lines, extend [docs/MATH.md](docs/MATH.md).
- Match the existing style: ES modules, 2-space indent, single quotes, small functions.

## Where to start

Look for issues labelled **good first issue**. Some bigger ideas:

| Idea | Difficulty | Notes |
|---|---|---|
| Colour-blind-friendly palette option | easy | `PALETTE` in `rules.js` |
| Save and load favourite universes | easy | the URL hash already serialises everything |
| Flat-torus comparison mode | medium | same kernel, Euclidean geometry, side by side |
| Web Worker for the simulation | medium | keeps the UI smooth on slow machines |
| GPU force computation | hard | WebGL2 transform feedback or WebGPU compute |
| 3D double-torus view | hard | map the octagon onto a genus-2 mesh |

## Pull requests

1. Fork, branch, commit.
2. `npm test` passes.
3. For visual changes, attach a screenshot or GIF (`npm run record -- shot out.png`).
4. Open the PR with a short description of *why*.

By contributing you agree your work is released under the MIT licence.
