/**
 * The camera is a single Lorentz matrix M taking world coordinates to view
 * coordinates; the centre of the screen is the view origin. Moving the camera
 * means composing M with isometries.
 *
 * Because the world repeats under the surface group, we are free to replace
 * M by M·γ for any group element γ without changing the picture. We use that
 * to keep the camera's world position inside the fundamental polygon, so you
 * can fly in one direction forever without numbers ever growing.
 */

import * as H from './hyperbolic.js';

export class Camera {
  constructor(surface) {
    this.surface = surface;
    this.M = H.identity();
    this.zoom = 1;
    this.velocity = { theta: 0, speed: 0 }; // view-space glide after a drag
    this.target = null; // view-space point being brought to the centre
    this._moves = 0;
  }

  setSurface(surface) {
    this.surface = surface;
    this.M = H.identity();
    this.velocity.speed = 0;
    this.target = null;
  }

  /** Camera position in world coordinates. */
  position() {
    return H.apply(H.inverse(this.M), H.ORIGIN);
  }

  /** Apply an isometry in view space — e.g. the translation produced by a drag. */
  transform(T) {
    this.M = H.mul(T, this.M);
    if (++this._moves % 32 === 0) this.M = H.renormalize(this.M);
    const S = this.surface;
    for (let i = 0; i < 16; i++) {
      const c = this.position();
      if (S.excess(c[0], c[1], c[2]) <= 0) break;
      this.M = H.mul(this.M, S.generators[S.lastSide]);
    }
  }

  /** Slide the world so that view point a ends up at view point b. */
  drag(a, b) {
    this.transform(H.transvection(a, b));
  }

  /** Move the world by distance d in view direction theta. */
  glide(theta, d) {
    this.transform(H.translation(theta, d));
  }

  rotate(angle) {
    this.transform(H.rotation(angle));
  }

  /** Start bringing a view-space point smoothly to the centre of the screen. */
  focus(point) {
    this.target = point;
    this.velocity.speed = 0;
  }

  /** Advance glides and focus animations by dt seconds. */
  update(dt) {
    if (this.target) {
      const d = H.dist(this.target, H.ORIGIN);
      if (d < 1e-3) {
        this.target = null;
      } else {
        const next = H.geodesicLerp(this.target, H.ORIGIN, Math.min(1, dt * 6));
        this.transform(H.transvection(this.target, next));
        this.target = next;
      }
    }
    const v = this.velocity;
    if (v.speed > 1e-4) {
      this.glide(v.theta, v.speed * dt);
      v.speed *= Math.pow(0.5, dt / 0.35);
    }
  }
}
