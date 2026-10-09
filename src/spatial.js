/**
 * Spatial index for the hyperbolic plane: a "binary tiling" of the upper
 * half-plane.
 *
 * A uniform grid fails in hyperbolic space — in the Poincaré disk, cells near
 * the rim would hold thousands of times more area than cells in the middle.
 * Instead, map points to the upper half-plane (X, Y) and cut it into rows
 * [e^{kL}, e^{(k+1)L}) whose cells are W·e^{kL} wide. In the half-plane metric
 * ds = |dw| / Y every such cell has roughly the same hyperbolic size, no
 * matter how far it is from the origin.
 *
 * Queries are exact thanks to a nice fact: a hyperbolic circle of radius r
 * centred at (X₀, Y₀) is a Euclidean circle with centre (X₀, Y₀·cosh r) and
 * radius Y₀·sinh r. So its bounding box is
 *     X ∈ X₀ ± Y₀·sinh r,   Y ∈ [Y₀·e^{-r}, Y₀·e^{r}].
 */

const KEY_ROW = 65536;
const KEY_ROW_BIAS = 4096;
const KEY_COL_BIAS = 32768;
const INDEX_BITS = 1048576; // 2^20 — max particles + ghosts per build

export class HorocycleGrid {
  constructor() {
    this.capacity = 0;
    this.cells = new Map();
  }

  _ensure(n) {
    if (n <= this.capacity) return;
    const cap = Math.max(n, Math.ceil(this.capacity * 1.5), 1024);
    if (cap > INDEX_BITS) throw new RangeError('too many points for the spatial index');
    this.capacity = cap;
    this.sortKeys = new Float64Array(cap);
    this.order = new Uint32Array(cap);
    this.runStart = new Uint32Array(cap);
    this.runEnd = new Uint32Array(cap);
  }

  /**
   * Index `count` hyperboloid points given as parallel arrays.
   * @param {number} cell target hyperbolic cell size (use the query radius)
   */
  build(T, X, Y, count, cell) {
    this._ensure(count);
    this.L = cell;
    this.W = cell;
    this.count = count;
    const { sortKeys, order, runStart, runEnd, cells } = this;
    const invL = 1 / cell;

    for (let i = 0; i < count; i++) {
      const hy = 1 / (T[i] - X[i]);
      const hx = -Y[i] * hy;
      const row = Math.floor(Math.log(hy) * invL);
      const col = Math.floor(hx / (cell * Math.exp(row * cell)));
      const key = (row + KEY_ROW_BIAS) * KEY_ROW + (col + KEY_COL_BIAS);
      sortKeys[i] = key * INDEX_BITS + i;
    }
    const view = sortKeys.subarray(0, count);
    view.sort();

    cells.clear();
    let runs = 0;
    let prevKey = -1;
    for (let s = 0; s < count; s++) {
      const v = view[s];
      const key = Math.floor(v / INDEX_BITS);
      order[s] = v - key * INDEX_BITS;
      if (key !== prevKey) {
        if (runs > 0) runEnd[runs - 1] = s;
        runStart[runs] = s;
        cells.set(key, runs);
        runs++;
        prevKey = key;
      }
    }
    if (runs > 0) runEnd[runs - 1] = count;
  }

  /**
   * Write the index of every point that could be within distance r of
   * (t, x, y) into `out` and return how many there are. This is a superset:
   * callers still check the exact distance.
   */
  query(t, x, y, r, out) {
    const { L, W, cells, order, runStart, runEnd } = this;
    const Y0 = 1 / (t - x);
    const X0 = -y * Y0;
    const halfWidth = Y0 * Math.sinh(r);
    const lnY = Math.log(Y0);
    const rowMin = Math.floor((lnY - r) / L);
    const rowMax = Math.floor((lnY + r) / L);
    let n = 0;
    for (let row = rowMin; row <= rowMax; row++) {
      const w = W * Math.exp(row * L);
      const c0 = Math.floor((X0 - halfWidth) / w);
      const c1 = Math.floor((X0 + halfWidth) / w);
      const base = (row + KEY_ROW_BIAS) * KEY_ROW + KEY_COL_BIAS;
      for (let col = c0; col <= c1; col++) {
        const run = cells.get(base + col);
        if (run === undefined) continue;
        for (let s = runStart[run], e = runEnd[run]; s < e; s++) out[n++] = order[s];
      }
    }
    return n;
  }
}
