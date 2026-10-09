/**
 * Hyperboloid model of the hyperbolic plane H².
 *
 * Points live on the upper sheet of  -t² + x² + y² = -1  (t > 0) inside
 * Minkowski space R^{2,1}. Points and tangent vectors are plain [t, x, y]
 * arrays; isometries are 3×3 Lorentz matrices stored row-major in a
 * Float64Array(9).
 *
 * Why the hyperboloid and not the Poincaré disk? Every isometry is a linear
 * map, geodesics are intersections with planes through the origin, and
 * nothing blows up near the "edge of the universe". The disk is only used
 * for drawing.
 */

const { cosh, sinh, acosh, sqrt, cos, sin } = Math;

export const ORIGIN = Object.freeze([1, 0, 0]);

/** Minkowski inner product ⟨a, b⟩ = -a₀b₀ + a₁b₁ + a₂b₂. */
export function mdot(a, b) {
  return -a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Hyperbolic distance: cosh d(a, b) = -⟨a, b⟩. */
export function dist(a, b) {
  const c = -mdot(a, b);
  return c > 1 ? acosh(c) : 0;
}

/** Lift (x, y) back onto the hyperboloid by solving for t. */
export function lift(x, y) {
  return [sqrt(1 + x * x + y * y), x, y];
}

/** Snap a point that drifted numerically back onto the hyperboloid. */
export function normalizePoint(p) {
  return lift(p[1], p[2]);
}

/** The point at distance r from the origin in direction theta. */
export function fromPolar(theta, r) {
  const s = sinh(r);
  return [cosh(r), s * cos(theta), s * sin(theta)];
}

/** Remove the component of v normal to the hyperboloid at p. */
export function projectTangent(p, v) {
  const k = mdot(p, v);
  return [v[0] + k * p[0], v[1] + k * p[1], v[2] + k * p[2]];
}

/** Length of a tangent vector (tangent vectors are spacelike). */
export function tangentNorm(v) {
  return sqrt(Math.max(0, mdot(v, v)));
}

/** Follow the geodesic leaving p with initial velocity v for unit time. */
export function expMap(p, v) {
  const n = tangentNorm(v);
  if (n < 1e-12) return [p[0] + v[0], p[1] + v[1], p[2] + v[2]];
  const c = cosh(n), s = sinh(n) / n;
  return [c * p[0] + s * v[0], c * p[1] + s * v[1], c * p[2] + s * v[2]];
}

/** Inverse of expMap: the tangent vector at p pointing at q with length d(p, q). */
export function logMap(p, q) {
  const c = -mdot(p, q);
  if (c <= 1 + 1e-15) return [0, 0, 0];
  const k = acosh(c) / sqrt(c * c - 1);
  return [(q[0] - c * p[0]) * k, (q[1] - c * p[1]) * k, (q[2] - c * p[2]) * k];
}

/** Parallel-transport tangent vector w from p to q along the joining geodesic. */
export function parallelTransport(p, q, w) {
  const k = mdot(q, w) / (1 - mdot(p, q));
  return [w[0] + k * (p[0] + q[0]), w[1] + k * (p[1] + q[1]), w[2] + k * (p[2] + q[2])];
}

/** Point at fraction s ∈ [0, 1] along the geodesic from a to b. */
export function geodesicLerp(a, b, s) {
  const d = dist(a, b);
  if (d < 1e-12) return [a[0], a[1], a[2]];
  const wa = sinh((1 - s) * d) / sinh(d), wb = sinh(s * d) / sinh(d);
  return [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]];
}

// ─── Models used for drawing ──────────────────────────────────────────────

export function toPoincare(p) {
  const s = 1 / (1 + p[0]);
  return [p[1] * s, p[2] * s];
}

export function fromPoincare(u, v) {
  const r2 = u * u + v * v;
  const s = 1 / (1 - r2);
  return [(1 + r2) * s, 2 * u * s, 2 * v * s];
}

export function toKlein(p) {
  return [p[1] / p[0], p[2] / p[0]];
}

export function fromKlein(u, v) {
  const s = 1 / sqrt(1 - u * u - v * v);
  return [s, u * s, v * s];
}

/** Upper half-plane coordinates (X, Y), Y > 0. Used by the spatial index. */
export function toHalfPlane(p) {
  const s = 1 / (p[0] - p[1]);
  return [-p[2] * s, s];
}

// ─── Isometries (Lorentz matrices) ────────────────────────────────────────

export function identity() {
  return new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

export function mul(A, B) {
  const C = new Float64Array(9);
  for (let i = 0; i < 3; i++) {
    const a0 = A[i * 3], a1 = A[i * 3 + 1], a2 = A[i * 3 + 2];
    C[i * 3] = a0 * B[0] + a1 * B[3] + a2 * B[6];
    C[i * 3 + 1] = a0 * B[1] + a1 * B[4] + a2 * B[7];
    C[i * 3 + 2] = a0 * B[2] + a1 * B[5] + a2 * B[8];
  }
  return C;
}

export function apply(M, p) {
  return [
    M[0] * p[0] + M[1] * p[1] + M[2] * p[2],
    M[3] * p[0] + M[4] * p[1] + M[5] * p[2],
    M[6] * p[0] + M[7] * p[1] + M[8] * p[2],
  ];
}

/** Lorentz matrices satisfy MᵀJM = J, so M⁻¹ = J Mᵀ J — no division needed. */
export function inverse(M) {
  return new Float64Array([M[0], -M[3], -M[6], -M[1], M[4], M[7], -M[2], M[5], M[8]]);
}

/** Rotation by theta about the origin. */
export function rotation(theta) {
  const c = cos(theta), s = sin(theta);
  return new Float64Array([1, 0, 0, 0, c, -s, 0, s, c]);
}

/** Hyperbolic translation by distance d along the +x axis (a Lorentz boost). */
export function boost(d) {
  const c = cosh(d), s = sinh(d);
  return new Float64Array([c, s, 0, s, c, 0, 0, 0, 1]);
}

/** Translation by distance d along the geodesic through the origin at angle theta. */
export function translation(theta, d) {
  return mul(rotation(theta), mul(boost(d), rotation(-theta)));
}

/** Half-turn about p: σ_p(x) = -x - 2⟨p, x⟩p. */
export function pointReflection(p) {
  const jp = [-p[0], p[1], p[2]];
  const M = new Float64Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) M[i * 3 + j] = (i === j ? -1 : 0) - 2 * p[i] * jp[j];
  }
  return M;
}

/**
 * The translation that slides a to b along the geodesic joining them.
 * It is the product of two half-turns: about a, then about the midpoint.
 */
export function transvection(a, b) {
  const s = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const k = 1 / sqrt(-mdot(s, s));
  const m = [s[0] * k, s[1] * k, s[2] * k];
  return mul(pointReflection(m), pointReflection(a));
}

/**
 * Pull a matrix that accumulated floating-point drift back onto the Lorentz
 * group with Minkowski Gram–Schmidt on its columns.
 */
export function renormalize(M) {
  const col = (j) => [M[j], M[3 + j], M[6 + j]];
  let c0 = col(0), c1 = col(1), c2 = col(2);
  c0 = scale(c0, 1 / sqrt(-mdot(c0, c0)));
  c1 = axpy(mdot(c1, c0), c0, c1);
  c1 = scale(c1, 1 / sqrt(mdot(c1, c1)));
  c2 = axpy(-mdot(c2, c1), c1, axpy(mdot(c2, c0), c0, c2));
  c2 = scale(c2, 1 / sqrt(mdot(c2, c2)));
  return new Float64Array([c0[0], c1[0], c2[0], c0[1], c1[1], c2[1], c0[2], c1[2], c2[2]]);
}

function scale(v, k) {
  return [v[0] * k, v[1] * k, v[2] * k];
}

function axpy(a, x, y) {
  return [a * x[0] + y[0], a * x[1] + y[1], a * x[2] + y[2]];
}
