/**
 * A closed hyperbolic surface of genus g, built from a regular 4g-gon whose
 * opposite sides are glued together.
 *
 * For g = 2 this is the Bolza surface: a regular octagon with interior angles
 * of 45°, so eight copies meet at every corner and tile the hyperbolic plane
 * (the {8,8} tiling). Walking off one edge of the octagon brings you back in
 * through the opposite edge — like the screen wrap in Asteroids, except the
 * resulting world is a two-holed donut instead of a flat torus.
 *
 * The gluing maps are hyperbolic translations g_k along the perpendicular to
 * side k, of length twice the inradius. They generate the surface's
 * fundamental group, and the images γ·P of the polygon P under that group
 * tile the whole plane.
 */

import { ORIGIN, apply, dist, fromPolar, identity, mul, translation } from './hyperbolic.js';

export class Surface {
  /** @param {number} genus integer ≥ 2 */
  constructor(genus = 2) {
    if (!Number.isInteger(genus) || genus < 2) throw new RangeError('genus must be an integer ≥ 2');
    const n = 4 * genus;
    const cot = 1 / Math.tan(Math.PI / n);

    this.genus = genus;
    this.sides = n;
    /** Distance from the centre to the middle of each side: cosh r = cot(π/n). */
    this.inradius = Math.acosh(cot);
    /** Distance from the centre to each corner: cosh R = cot²(π/n). */
    this.circumradius = Math.acosh(cot * cot);
    /** Gauss–Bonnet: area = 4π(g − 1). */
    this.area = 4 * Math.PI * (genus - 1);

    const d = this.inradius;
    this.generators = [];
    this.vertices = [];
    // Side k lies on the geodesic {p : ⟨n_k, p⟩ = 0}; ⟨n_k, p⟩ = sinh(signed distance).
    this.normals = new Float64Array(3 * n);
    for (let k = 0; k < n; k++) {
      const theta = (2 * Math.PI * k) / n;
      this.generators.push(translation(theta, 2 * d));
      this.vertices.push(fromPolar(((2 * k + 1) * Math.PI) / n, this.circumradius));
      this.normals[3 * k] = Math.sinh(d);
      this.normals[3 * k + 1] = Math.cosh(d) * Math.cos(theta);
      this.normals[3 * k + 2] = Math.cosh(d) * Math.sin(theta);
    }
    this._tileCache = new Map();
  }

  /** Index of the generator that undoes generator k (it glues the opposite side). */
  opposite(k) {
    return (k + this.sides / 2) % this.sides;
  }

  /**
   * Largest sinh(signed distance) from (t, x, y) to any side line, and which
   * side it is. Negative means strictly inside the polygon.
   * Written on raw numbers because the simulation calls it per particle.
   */
  excess(t, x, y) {
    const N = this.normals;
    let best = -Infinity, side = -1;
    for (let k = 0; k < this.sides; k++) {
      const v = -N[3 * k] * t + N[3 * k + 1] * x + N[3 * k + 2] * y;
      if (v > best) { best = v; side = k; }
    }
    this.lastSide = side;
    return best;
  }

  contains(p, eps = 1e-9) {
    return this.excess(p[0], p[1], p[2]) <= eps;
  }

  /**
   * Map a point of the plane into the fundamental polygon.
   * Returns the reduced point and the isometry that did it.
   */
  reduce(p) {
    let M = identity();
    let q = p;
    for (let iter = 0; iter < 64; iter++) {
      if (this.excess(q[0], q[1], q[2]) <= 1e-12) break;
      const g = this.generators[this.opposite(this.lastSide)];
      M = mul(g, M);
      q = apply(g, q);
    }
    return { point: q, matrix: M };
  }

  /**
   * Every tile γ·P whose centre is within `radius` of the origin, sorted by
   * distance. Breadth-first search over edge-adjacent tiles; any tile on the
   * path to a wanted tile has its centre within radius + circumradius, so
   * that is how far the search has to wander.
   * @returns {{matrix: Float64Array, center: number[], distance: number}[]}
   */
  tilesWithin(radius) {
    const key = radius.toFixed(6);
    const cached = this._tileCache.get(key);
    if (cached) return cached;

    const limit = radius + this.circumradius;
    const seen = new Set(['0,0']);
    const out = [];
    let frontier = [{ matrix: identity(), center: [1, 0, 0], distance: 0 }];
    while (frontier.length) {
      const next = [];
      for (const tile of frontier) {
        if (tile.distance <= radius) out.push(tile);
        for (const g of this.generators) {
          const matrix = mul(tile.matrix, g);
          const center = [matrix[0], matrix[3], matrix[6]]; // matrix · ORIGIN
          const distance = dist(center, ORIGIN);
          if (distance > limit) continue;
          const id = `${Math.round(center[1] * 1e5)},${Math.round(center[2] * 1e5)}`;
          if (seen.has(id)) continue;
          seen.add(id);
          next.push({ matrix, center, distance });
        }
      }
      frontier = next;
    }
    out.sort((a, b) => a.distance - b.distance);
    this._tileCache.set(key, out);
    return out;
  }

  /** A random point, uniform by hyperbolic area, inside the fundamental polygon. */
  randomPoint(rng) {
    const R = this.circumradius;
    const coshR1 = Math.cosh(R) - 1;
    for (;;) {
      const r = Math.acosh(1 + rng() * coshR1);
      const p = fromPolar(rng() * 2 * Math.PI, r);
      if (this.contains(p)) return p;
    }
  }
}
