/**
 * WebGL2 renderer.
 *
 * The particle buffer is uploaded once per frame in hyperboloid coordinates.
 * It is then drawn once per visible tile of the tiling, each time with a
 * different 3×3 Lorentz matrix (camera · tile) as the only uniform that
 * changes. The vertex shader projects to the Poincaré (or Klein) disk and
 * shrinks each particle by the conformal factor, so copies of the universe
 * near the rim come out tiny — that is the hyperbolic geometry, not a
 * perspective effect.
 */

import { PALETTE } from './rules.js';

const PROJECT = /* glsl */ `
uniform int u_klein;
vec2 project(vec3 q, out float shrink) {
  if (u_klein == 1) {
    vec2 z = q.yz / q.x;
    shrink = 2.0 * pow(max(1.0 - dot(z, z), 0.0), 0.75);
    return z;
  }
  vec2 z = q.yz / (1.0 + q.x);
  shrink = max(1.0 - dot(z, z), 0.0);
  return z;
}`;

const POINT_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_particle; // t, x, y, species
uniform mat3 u_view;
uniform vec2 u_res;
uniform vec2 u_center; // disk centre, px from bottom-left
uniform float u_scale;  // disk radius, px
uniform float u_size;   // particle radius, hyperbolic units
uniform vec3 u_colors[12];
out vec3 v_color;
out float v_alpha;
out float v_px;
${PROJECT}
void main() {
  float shrink;
  vec2 z = project(u_view * a_particle.xyz, shrink);
  float px = u_size * shrink * u_scale; // diameter in px
  gl_Position = vec4((u_center + z * u_scale) / u_res * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = max(px, 1.0);
  v_px = px;
  v_alpha = px < 1.0 ? px * px : 1.0; // sub-pixel particles fade by area
  v_color = u_colors[int(a_particle.w + 0.5)];
  if (px < 0.2) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const POINT_FS = /* glsl */ `#version 300 es
precision mediump float;
in vec3 v_color;
in float v_alpha;
in float v_px;
uniform float u_opacity;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float soft = 1.0 - smoothstep(0.55, 1.0, sqrt(r2));
  float edge = mix(1.0, soft, clamp(v_px - 2.0, 0.0, 1.0));
  vec3 col = mix(v_color, vec3(1.0), 0.4 * (1.0 - r2) * (1.0 - r2));
  float a = edge * v_alpha * u_opacity;
  o = vec4(col * a, a);
}`;

const LINE_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
uniform mat3 u_view;
uniform vec2 u_res;
uniform vec2 u_center; // disk centre, px from bottom-left
uniform float u_scale;
out float v_fade;
${PROJECT}
void main() {
  float shrink;
  vec2 z = project(u_view * a_pos, shrink);
  v_fade = shrink;
  gl_Position = vec4((u_center + z * u_scale) / u_res * 2.0 - 1.0, 0.0, 1.0);
}`;

const LINE_FS = /* glsl */ `#version 300 es
precision mediump float;
in float v_fade;
uniform vec4 u_color;
out vec4 o;
void main() {
  float a = u_color.a * clamp(v_fade * 4.0, 0.0, 1.0);
  o = vec4(u_color.rgb * a, a);
}`;

const BG_VS = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const BG_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 u_center;
uniform float u_scale;
out vec4 o;
void main() {
  vec2 z = (gl_FragCoord.xy - u_center) / u_scale;
  float r = length(z);
  float aa = fwidth(r);
  vec3 inside = mix(vec3(0.040, 0.046, 0.085), vec3(0.012, 0.014, 0.035), r * r);
  vec3 outside = vec3(0.006, 0.007, 0.016);
  vec3 col = mix(inside, outside, smoothstep(1.0 - aa, 1.0 + aa, r));
  col += vec3(0.25, 0.35, 0.8) * exp(-abs(r - 1.0) / (aa * 3.0)) * 0.35;
  o = vec4(col, 1.0);
}`;

function compile(gl, vs, fs) {
  const program = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    gl.attachShader(program, s);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const uniforms = {};
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(program, i).name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

/** Sample the polygon's sides as geodesic line segments (pairs for gl.LINES). */
function polygonLines(surface, sides, samples = 24) {
  const out = [];
  const n = surface.sides;
  for (const k of sides) {
    const a = surface.vertices[(k + n - 1) % n], b = surface.vertices[k];
    const d = Math.acosh(-(-a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const point = (s) => {
      const wa = Math.sinh((1 - s) * d) / Math.sinh(d), wb = Math.sinh(s * d) / Math.sinh(d);
      return [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]];
    };
    for (let i = 0; i < samples; i++) out.push(...point(i / samples), ...point((i + 1) / samples));
  }
  return new Float32Array(out);
}

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.points = compile(gl, POINT_VS, POINT_FS);
    this.lines = compile(gl, LINE_VS, LINE_FS);
    this.bg = compile(gl, BG_VS, BG_FS);

    this.particleVao = gl.createVertexArray();
    this.particleBuf = gl.createBuffer();
    gl.bindVertexArray(this.particleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);

    this.lineVao = gl.createVertexArray();
    this.lineBuf = gl.createBuffer();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);

    this.colors = new Float32Array(PALETTE.flat());
    this.packed = new Float32Array(0);
    this.view32 = new Float32Array(9);
    this.surface = null;
  }

  setSurface(surface) {
    const gl = this.gl;
    const n = surface.sides;
    const half = polygonLines(surface, Array.from({ length: n / 2 }, (_, k) => k));
    const all = polygonLines(surface, Array.from({ length: n }, (_, k) => k));
    const data = new Float32Array(half.length + all.length);
    data.set(half);
    data.set(all, half.length);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.halfLineCount = half.length / 3;
    this.allLineStart = half.length / 3;
    this.allLineCount = all.length / 3;
    this.surface = surface;
  }

  /**
   * Canvas size, disk centre and disk radius, all in device pixels.
   * `view.offset` shifts the disk sideways (CSS px) to make room for the panel.
   */
  layout(view) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr), h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const offset = (view.offset || 0) * dpr;
    const scale = (view.zoom * Math.min(w - Math.abs(offset) * 2, h)) / 2 * 0.97;
    return { w, h, dpr, cx: w / 2 + offset, cy: h / 2, scale };
  }

  /**
   * @param {object} f
   * @param {import('./sim.js').Simulation} f.sim
   * @param {{matrix: Float64Array, distance: number}[]} f.tiles visible tiles, view matrices already composed
   * @param {object} f.view display options
   */
  render({ sim, tiles, view }) {
    const gl = this.gl;
    const { w, h, cx, cy, scale } = this.layout(view);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);

    // Background disk.
    gl.disable(gl.BLEND);
    gl.useProgram(this.bg.program);
    gl.uniform2f(this.bg.uniforms.u_center, cx, cy);
    gl.uniform1f(this.bg.uniforms.u_scale, scale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const klein = view.klein ? 1 : 0;

    // Tiling.
    if (view.tiling) {
      const L = this.lines;
      gl.useProgram(L.program);
      gl.bindVertexArray(this.lineVao);
      gl.uniform2f(L.uniforms.u_res, w, h);
      gl.uniform2f(L.uniforms.u_center, cx, cy);
      gl.uniform1f(L.uniforms.u_scale, scale);
      gl.uniform1i(L.uniforms.u_klein, klein);
      gl.uniform4f(L.uniforms.u_color, 0.45, 0.55, 1.0, 0.22);
      for (const tile of tiles) {
        this._setView(L.uniforms.u_view, tile.matrix);
        gl.drawArrays(gl.LINES, 0, this.halfLineCount);
      }
      if (tiles.length) {
        const home = tiles.find((t) => t.home);
        if (home) {
          this._setView(L.uniforms.u_view, home.matrix);
          gl.uniform4f(L.uniforms.u_color, 0.6, 0.75, 1.0, 0.55);
          gl.drawArrays(gl.LINES, this.allLineStart, this.allLineCount);
        }
      }
    }

    // Particles, once per tile.
    const n = sim.count;
    if (this.packed.length < n * 4) this.packed = new Float32Array(n * 4);
    sim.pack(this.packed);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.packed.subarray(0, n * 4), gl.STREAM_DRAW);

    const P = this.points;
    gl.useProgram(P.program);
    gl.bindVertexArray(this.particleVao);
    gl.uniform2f(P.uniforms.u_res, w, h);
    gl.uniform2f(P.uniforms.u_center, cx, cy);
    gl.uniform1f(P.uniforms.u_scale, scale);
    gl.uniform1f(P.uniforms.u_size, view.size);
    gl.uniform1i(P.uniforms.u_klein, klein);
    gl.uniform3fv(P.uniforms.u_colors, this.colors);
    gl.uniform1f(P.uniforms.u_opacity, view.glow ? 0.55 : 1);
    if (view.glow) gl.blendFunc(gl.ONE, gl.ONE);

    let drawn = 0;
    for (const tile of tiles) {
      if (!view.copies && !tile.home) continue;
      // Far-away copies are tiny; a random subset of the particles looks the same.
      const lod = tile.distance < 3.5 ? 1 : Math.max(0.04, Math.exp(-(tile.distance - 3.5) * view.lodFalloff));
      const count = Math.ceil(n * lod);
      this._setView(P.uniforms.u_view, tile.matrix);
      gl.drawArrays(gl.POINTS, 0, count);
      drawn += count;
    }
    gl.bindVertexArray(null);
    return { drawn, scale };
  }

  _setView(loc, M) {
    const v = this.view32;
    for (let i = 0; i < 9; i++) v[i] = M[i];
    // Our matrices are row-major; WebGL2 can transpose on upload.
    this.gl.uniformMatrix3fv(loc, true, v);
  }
}
