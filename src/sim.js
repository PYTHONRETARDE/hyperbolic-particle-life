/**
 * Particle Life on a closed hyperbolic surface.
 *
 * Every particle lives inside the fundamental polygon P, stored as a point on
 * the hyperboloid with a tangent velocity. One step:
 *
 *   1. Ghosts — particles near the edge of P also exist, as far as their
 *      neighbours are concerned, on the far side of the glued edge. We copy
 *      them through the surface's gluing maps into the tiles around P.
 *   2. Index — real particles + ghosts go into a hyperbolic spatial grid.
 *   3. Forces — for each particle, sum the Particle Life kernel over
 *      neighbours, pointing along the geodesic towards each one.
 *   4. Motion — follow the geodesic (exponential map), parallel-transport the
 *      velocity along with it, and if the particle stepped out of P, glue it
 *      back in through the opposite edge.
 */

import { HorocycleGrid } from './spatial.js';
import { PRESETS, mulberry32 } from './rules.js';

export const DEFAULTS = Object.freeze({
  count: 2400,
  species: 6,
  /** interaction radius, in hyperbolic units (curvature −1) */
  radius: 0.32,
  /** below beta·radius particles always repel — keeps them from collapsing */
  beta: 0.3,
  force: 10,
  /** velocity half-life in seconds */
  friction: 0.04,
  dt: 0.02,
  /** how fast the rules drift on their own (0 = fixed rules) */
  mutation: 0,
});

/** The classic Particle Life force profile, x = distance / radius. */
export function kernel(x, a, beta) {
  if (x < beta) return x / beta - 1;
  if (x < 1) return a * (1 - Math.abs(2 * x - 1 - beta) / (1 - beta));
  return 0;
}

export class Simulation {
  /**
   * @param {import('./surface.js').Surface} surface
   * @param {{params?: object, seed?: number, matrix?: Float32Array}} [options]
   */
  constructor(surface, options = {}) {
    this.surface = surface;
    this.params = { ...DEFAULTS, ...options.params };
    this.rulesVersion = 0;
    this.grid = new HorocycleGrid();
    this.ghostCount = 0;
    this.stir = null;
    this._allocAll(1024);
    this._allocParticles(this.params.count);
    this._refreshNeighbours();
    this.reset(options.seed ?? 1, options.matrix);
  }

  // ─── Setup ────────────────────────────────────────────────────────────

  /**
   * Start over from a seed. The seed always draws a random rule matrix first,
   * even when `matrix` overrides it, so that a (seed, matrix) pair in a
   * shared link reproduces the exact same starting positions.
   */
  reset(seed, matrix) {
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    const drawn = PRESETS.random(this.params.species, this.rng);
    this.matrix = matrix ?? drawn;
    this.rulesVersion++;
    this.time = 0;
    this.steps = 0;
    this.scatter();
  }

  _allocParticles(n) {
    this.count = n;
    this.pt = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.vt = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.type = new Uint8Array(n);
  }

  _allocAll(n) {
    const grow = (Old, Type) => {
      const a = new Type(n);
      if (Old) a.set(Old.subarray(0, Math.min(Old.length, n)));
      return a;
    };
    this.at = grow(this.at, Float64Array);
    this.ax = grow(this.ax, Float64Array);
    this.ay = grow(this.ay, Float64Array);
    this.as = grow(this.as, Uint8Array);
    this.ai = grow(this.ai, Uint32Array);
    this.queryBuf = new Uint32Array(n);
    this.allCapacity = n;
  }

  /** Tiles whose copies of P can come within `radius` of P itself. */
  _refreshNeighbours() {
    const { surface } = this;
    const tiles = surface.tilesWithin(2 * surface.circumradius + this.params.radius);
    const elems = tiles.filter((t) => t.distance > 1e-9);
    this.neighbours = new Float64Array(elems.length * 9);
    elems.forEach((t, e) => this.neighbours.set(t.matrix, e * 9));
  }

  _placeRandom(i) {
    const p = this.surface.randomPoint(this.rng);
    this.pt[i] = p[0];
    this.px[i] = p[1];
    this.py[i] = p[2];
    this.vt[i] = this.vx[i] = this.vy[i] = 0;
    this.type[i] = Math.floor(this.rng() * this.params.species);
  }

  /** Throw every particle somewhere random on the surface. */
  scatter() {
    for (let i = 0; i < this.count; i++) this._placeRandom(i);
  }

  setSurface(surface) {
    this.surface = surface;
    this._refreshNeighbours();
    this.scatter();
  }

  setCount(n) {
    n = Math.max(1, Math.floor(n));
    if (n === this.count) return;
    const old = { pt: this.pt, px: this.px, py: this.py, vt: this.vt, vx: this.vx, vy: this.vy, type: this.type };
    const keep = Math.min(n, this.count);
    this._allocParticles(n);
    for (const k of Object.keys(old)) this[k].set(old[k].subarray(0, keep));
    for (let i = keep; i < n; i++) this._placeRandom(i);
    this.params.count = n;
  }

  setSpecies(S) {
    const old = this.matrix, oldS = this.params.species;
    this.params.species = S;
    const m = PRESETS.random(S, this.rng);
    for (let a = 0; a < Math.min(S, oldS); a++) {
      for (let b = 0; b < Math.min(S, oldS); b++) m[a * S + b] = old[a * oldS + b];
    }
    this.matrix = m;
    this.rulesVersion++;
    for (let i = 0; i < this.count; i++) {
      if (this.type[i] >= S) this.type[i] = Math.floor(this.rng() * S);
    }
  }

  setRadius(r) {
    this.params.radius = r;
    this._refreshNeighbours();
  }

  setMatrix(m) {
    this.matrix = m;
    this.rulesVersion++;
  }

  /**
   * Push (strength < 0) or pull (strength > 0) particles near a point.
   * @param {number[] | null} point any point of the plane, or null to stop
   */
  setStir(point, radius = 0.6, strength = -3) {
    if (!point) { this.stir = null; return; }
    const { surface } = this;
    const q = surface.reduce(point).point;
    const cut = Math.cosh(surface.circumradius + radius);
    const images = [q];
    const E = this.neighbours;
    for (let e = 0; e < E.length; e += 9) {
      const t = E[e] * q[0] + E[e + 1] * q[1] + E[e + 2] * q[2];
      if (t > cut) continue;
      images.push([t, E[e + 3] * q[0] + E[e + 4] * q[1] + E[e + 5] * q[2], E[e + 6] * q[0] + E[e + 7] * q[1] + E[e + 8] * q[2]]);
    }
    this.stir = { images, coshRadius: Math.cosh(radius), radius, strength };
  }

  // ─── Simulation step ──────────────────────────────────────────────────

  step() {
    const { surface, params, neighbours: E } = this;
    const n = this.count;
    const S = params.species, r = params.radius, beta = params.beta, dt = params.dt;
    const { pt, px, py, vt, vx, vy, type } = this;

    // 1. Real particles first, then ghosts across the glued edges.
    if (this.allCapacity < n * 2) this._allocAll(n * 3);
    this.at.set(pt); this.ax.set(px); this.ay.set(py); this.as.set(type);
    for (let i = 0; i < n; i++) this.ai[i] = i;

    let m = n;
    const nearEdge = -Math.sinh(r);
    const cut = Math.cosh(surface.circumradius + r);
    for (let i = 0; i < n; i++) {
      const t = pt[i], x = px[i], y = py[i];
      if (surface.excess(t, x, y) <= nearEdge) continue;
      for (let e = 0; e < E.length; e += 9) {
        const gt = E[e] * t + E[e + 1] * x + E[e + 2] * y;
        if (gt > cut) continue;
        if (m >= this.allCapacity) this._allocAll(Math.ceil(this.allCapacity * 1.5));
        this.at[m] = gt;
        this.ax[m] = E[e + 3] * t + E[e + 4] * x + E[e + 5] * y;
        this.ay[m] = E[e + 6] * t + E[e + 7] * x + E[e + 8] * y;
        this.as[m] = type[i];
        this.ai[m] = i;
        m++;
      }
    }
    this.ghostCount = m - n;
    const { at, ax, ay, as, ai, queryBuf } = this;

    // 2. Spatial index over everything.
    this.grid.build(at, ax, ay, m, r);

    // 3 + 4. Forces, then move. Neighbours are read from the copies in
    // at/ax/ay, so updating pt/px/py in place is safe.
    const M = this.matrix;
    const coshR = Math.cosh(r);
    const accel = r * params.force * dt;
    const damp = Math.pow(0.5, dt / params.friction);
    const maxStep = 0.5 * r;
    const gens = surface.generators;
    const stir = this.stir;

    for (let i = 0; i < n; i++) {
      let t = pt[i], x = px[i], y = py[i];
      const row = type[i] * S;
      let ft = 0, fx = 0, fy = 0;

      const found = this.grid.query(t, x, y, r, queryBuf);
      for (let c = 0; c < found; c++) {
        const j = queryBuf[c];
        if (ai[j] === i) continue;
        const qt = at[j], qx = ax[j], qy = ay[j];
        const ch = t * qt - x * qx - y * qy; // cosh of the distance
        if (ch >= coshR) continue;
        const sh = Math.sqrt(Math.max(ch * ch - 1, 0));
        if (sh < 1e-9) continue;
        const d = Math.log(ch + sh);
        // Unit tangent towards q is (q − cosh(d)·p) / sinh(d).
        const f = kernel(d / r, M[row + as[j]], beta) / sh;
        ft += f * (qt - ch * t);
        fx += f * (qx - ch * x);
        fy += f * (qy - ch * y);
      }

      if (stir) {
        for (const s of stir.images) {
          const ch = t * s[0] - x * s[1] - y * s[2];
          if (ch >= stir.coshRadius) continue;
          const sh = Math.sqrt(Math.max(ch * ch - 1, 0));
          if (sh < 1e-9) continue;
          const d = Math.log(ch + sh);
          const f = (stir.strength * (1 - d / stir.radius)) / sh;
          ft += f * (s[0] - ch * t);
          fx += f * (s[1] - ch * x);
          fy += f * (s[2] - ch * y);
        }
      }

      let wt = vt[i] * damp + ft * accel;
      let wx = vx[i] * damp + fx * accel;
      let wy = vy[i] * damp + fy * accel;

      let len = Math.sqrt(Math.max(0, -wt * wt + wx * wx + wy * wy)) * dt;
      if (len > maxStep) {
        const k = maxStep / len;
        wt *= k; wx *= k; wy *= k;
        len = maxStep;
      }

      if (len > 1e-12) {
        // Exponential map: slide along the geodesic.
        const c = Math.cosh(len), s = (Math.sinh(len) / len) * dt;
        const nt = c * t + s * wt, nx = c * x + s * wx, ny = c * y + s * wy;
        // Parallel transport keeps the velocity pointing "the same way".
        const k = (-nt * wt + nx * wx + ny * wy) / (1 + c);
        wt += k * (t + nt); wx += k * (x + nx); wy += k * (y + ny);
        t = nt; x = nx; y = ny;
      }

      // Scrub floating-point drift: back onto the hyperboloid, back to tangent.
      t = Math.sqrt(1 + x * x + y * y);
      const pv = -t * wt + x * wx + y * wy;
      wt += pv * t; wx += pv * x; wy += pv * y;

      // Left the polygon? Glue back in through the opposite side.
      for (let iter = 0; iter < 8 && surface.excess(t, x, y) > 0; iter++) {
        const g = gens[surface.opposite(surface.lastSide)];
        const x2 = g[3] * t + g[4] * x + g[5] * y;
        const y2 = g[6] * t + g[7] * x + g[8] * y;
        const u2 = g[0] * wt + g[1] * wx + g[2] * wy;
        const v2 = g[3] * wt + g[4] * wx + g[5] * wy;
        const w2 = g[6] * wt + g[7] * wx + g[8] * wy;
        x = x2; y = y2; t = Math.sqrt(1 + x * x + y * y);
        wt = u2; wx = v2; wy = w2;
      }

      pt[i] = t; px[i] = x; py[i] = y;
      vt[i] = wt; vx[i] = wx; vy[i] = wy;
    }

    if (params.mutation > 0) this._mutate(dt);
    this.time += dt;
    this.steps++;
  }

  /** Let the rules wander: a slow random walk on every matrix entry. */
  _mutate(dt) {
    const amount = this.params.mutation * Math.sqrt(dt);
    const m = this.matrix;
    for (let i = 0; i < m.length; i++) {
      m[i] = Math.max(-1, Math.min(1, m[i] + (this.rng() * 2 - 1) * amount));
    }
    this.rulesVersion++;
  }

  /** Interleave positions and species into a GPU-ready buffer (t, x, y, species). */
  pack(out) {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      out[4 * i] = this.pt[i];
      out[4 * i + 1] = this.px[i];
      out[4 * i + 2] = this.py[i];
      out[4 * i + 3] = this.type[i];
    }
    return out;
  }
}
