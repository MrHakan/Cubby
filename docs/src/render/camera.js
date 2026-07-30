/**
 * Camera.
 *
 * The Unity build used one fixed orthographic camera (size 10) per level, which
 * works because every level was authored to fit a 16:9 screen. That framing is
 * kept wherever it still fits — on a phone held upright it cannot, so the view
 * zooms to a readable size and follows the cube instead, clamped to the level.
 */

import { clamp } from '../game/physics.js';

// Framing rules, in world units. The level is shown whole when the screen can
// take it; otherwise these keep the cube big enough to read and the view wide
// enough to see the next platform coming.
const MIN_VIEW_W = 16;   // never show less of the level than this, side to side
const MIN_VIEW_H = 11;   // nor less than this, top to bottom
const MAX_VIEW_H = 26;   // the cube is never smaller than 1/26 of the screen
const MARGIN = 1.6;

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.viewH = 20;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this._settled = false;
  }

  reset() {
    this.shake = 0;
    this._settled = false;
  }

  kick(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  update(dt, world, player, aspect) {
    const b = world.bounds;
    const levelW = b.maxX - b.minX + MARGIN * 2;
    const levelH = b.maxY - b.minY + MARGIN * 2;

    // What it would take to show everything, versus the least we will settle for.
    const fitH = Math.max(levelH, levelW / aspect);
    const needH = Math.max(MIN_VIEW_H, MIN_VIEW_W / aspect);
    // On a tall, narrow screen `needH` can exceed the usual cap; showing enough
    // of the level wins over keeping the cube large.
    this.viewH = clamp(fitH, needH, Math.max(needH, MAX_VIEW_H));

    const viewW = this.viewH * aspect;
    const centerX = (b.minX + b.maxX) / 2;
    const centerY = (b.minY + b.maxY) / 2;

    // Look ahead a little in the direction of travel; it reads better when the
    // view is tight enough that the level scrolls.
    let targetX = player ? player.x + clamp(player.vx * 0.16, -2.2, 2.2) : centerX;
    let targetY = player ? player.y + 0.8 : centerY;

    if (viewW >= levelW) {
      targetX = centerX;
    } else {
      const halfW = viewW / 2;
      targetX = clamp(targetX, b.minX - MARGIN + halfW, b.maxX + MARGIN - halfW);
    }

    if (this.viewH >= levelH) {
      targetY = centerY;
    } else {
      const halfH = this.viewH / 2;
      targetY = clamp(targetY, b.minY - MARGIN + halfH, b.maxY + MARGIN - halfH);
    }

    if (!this._settled) {
      this.x = targetX;
      this.y = targetY;
      this._settled = true;
    } else {
      const k = 1 - Math.exp(-9 * dt);
      this.x += (targetX - this.x) * k;
      this.y += (targetY - this.y) * k;
    }

    if (this.shake > 0.001) {
      this.shake = Math.max(0, this.shake - dt * 2.6);
      const a = this.shake * this.shake * 0.9;
      this.shakeX = (Math.random() * 2 - 1) * a;
      this.shakeY = (Math.random() * 2 - 1) * a;
    } else {
      this.shakeX = this.shakeY = 0;
    }
  }

  /** Pixels per world unit for the given canvas height. */
  scaleFor(canvasHeight) {
    return canvasHeight / this.viewH;
  }

  /** Set up a y-up world transform on the context. */
  apply(ctx, width, height) {
    const s = this.scaleFor(height);
    ctx.setTransform(s, 0, 0, -s, width / 2, height / 2);
    ctx.translate(-(this.x + this.shakeX), -(this.y + this.shakeY));
    return s;
  }
}
