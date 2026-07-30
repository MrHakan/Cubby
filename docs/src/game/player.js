/**
 * The cube.
 *
 * Tuning comes straight from the Unity prefab and project settings so the jumps
 * land where they always did:
 *
 *   speed 7 (12 while boosted) · jumpForce 7 · mass 1 · gravityScale 1.4
 *   Physics2D gravity -9.81 · BoxCollider2D 1 × 1 · rotation frozen
 *
 * Coyote time and a jump buffer are new. They only ever make an input that was
 * already going to work land, so no jump the original refused becomes possible.
 */

import { resolveAabbObb, clamp, approach } from './physics.js';

const GRAVITY = 9.81;
const BASE_SPEED = 7;
const BOOST_SPEED = 12;
const JUMP_FORCE = 7;
const NORMAL_GRAVITY_SCALE = 1.4;
const ANTIGRAVITY_SCALE = -0.1;

const COYOTE = 0.09;
const JUMP_BUFFER = 0.1;
const MAX_FALL = 26;
const MAX_STEP = 0.08; // world units per collision sub-step

export const SIZES = {
  small: { scale: 0.5, mass: 0.5 },
  normal: { scale: 1, mass: 1 },
  big: { scale: 2, mass: 4 },
};

export class Player {
  constructor(world) {
    this.world = world;
    this.reset();
  }

  reset() {
    const { spawn } = this.world;
    this.x = spawn.x;
    this.y = spawn.y;
    this.vx = 0;
    this.vy = 0;
    this.axis = 0;
    this.facing = 1;

    this.scale = 1;
    this.mass = 1;
    this.gravityScale = NORMAL_GRAVITY_SCALE;
    this.boosted = false;

    this.grounded = false;
    this.groundSolid = null;
    this.onWall = 0;
    this.coyote = 0;
    this.buffer = 0;

    this.dead = false;
    this.squash = 0;   // >0 stretch on jump, <0 squash on land
    this.wasGrounded = false;
    this.tilt = 0;
  }

  get half() { return this.scale / 2; }
  get speed() { return this.boosted ? BOOST_SPEED : BASE_SPEED; }

  applyPowerup(type) {
    if (type in SIZES) {
      const { scale, mass } = SIZES[type];
      // Grow from the feet up so a size change never buries the cube in a floor.
      this.y += (scale - this.scale) / 2;
      this.scale = scale;
      this.mass = mass;
    } else if (type === 'antigravity') {
      this.gravityScale = ANTIGRAVITY_SCALE;
    } else if (type === 'gravity') {
      this.gravityScale = NORMAL_GRAVITY_SCALE;
    }
  }

  /**
   * One fixed step.
   * @returns {{jumped: boolean, landed: number}} events for sound and particles
   */
  step(dt, input) {
    const events = { jumped: false, landed: 0 };
    if (this.dead) return events;

    // --- horizontal ------------------------------------------------------
    // Unity's GetAxis ramps; this ramps faster so the cube answers the key,
    // but still eases rather than snapping.
    const target = input.axis;
    const rate = target === 0 ? 26 : 34;
    this.axis = approach(this.axis, target, rate * dt);
    if (target !== 0) this.facing = target;
    this.vx = this.axis * this.speed;

    // --- carried by a moving platform ------------------------------------
    if (this.groundSolid && (this.groundSolid.vx || this.groundSolid.vy)) {
      this.x += this.groundSolid.vx * dt;
      this.y += this.groundSolid.vy * dt;
    }

    // --- jump -------------------------------------------------------------
    if (input.pressed.jump) this.buffer = JUMP_BUFFER;
    this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = this.grounded ? COYOTE : Math.max(0, this.coyote - dt);

    // Touching a wall refills the jump every step — this is the original's
    // wall climb, where `extraJump = 1` was reassigned in every Update().
    const canJump = this.coyote > 0 || this.onWall !== 0;
    if (this.buffer > 0 && canJump) {
      this.vy = JUMP_FORCE;
      this.buffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.groundSolid = null;
      this.squash = 1;
      events.jumped = true;
    }

    // --- gravity ----------------------------------------------------------
    this.vy -= GRAVITY * this.gravityScale * dt;
    this.vy = clamp(this.vy, -MAX_FALL, MAX_FALL);

    // --- move + collide ---------------------------------------------------
    this.wasGrounded = this.grounded;
    const fallSpeed = this.vy;
    this._integrate(dt);
    this._probe();

    if (this.grounded && !this.wasGrounded && fallSpeed < -6) {
      events.landed = -fallSpeed;
      this.squash = -1;
    }

    // --- cosmetic ---------------------------------------------------------
    this.squash = approach(this.squash, 0, dt * 5);
    const tiltTarget = this.grounded ? 0 : clamp(this.vx * 0.018, -0.16, 0.16);
    this.tilt += (tiltTarget - this.tilt) * Math.min(1, dt * 8);

    if (this.y < this.world.killY) this.dead = true;

    const b = this.world.bounds;
    if (this.x < b.minX - 14 || this.x > b.maxX + 14 || this.y > b.maxY + 40) this.dead = true;

    return events;
  }

  /** Move in sub-steps small enough that nothing tunnels through a 0.25 thick floor. */
  _integrate(dt) {
    const dist = Math.hypot(this.vx, this.vy) * dt;
    const steps = Math.max(1, Math.min(16, Math.ceil(dist / MAX_STEP)));
    const sub = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.x += this.vx * sub;
      this.y += this.vy * sub;
      this._resolve();
    }
  }

  _resolve() {
    const hw = this.half;
    const hh = this.half;
    // Two passes settle corners where two solids push back at once.
    for (let pass = 0; pass < 2; pass++) {
      let touched = false;
      for (const solid of this.world.solids) {
        const hit = resolveAabbObb(this.x, this.y, hw, hh, solid.box);
        if (!hit) continue;
        touched = true;
        this.x += hit.nx * hit.depth;
        this.y += hit.ny * hit.depth;
        const into = this.vx * hit.nx + this.vy * hit.ny;
        if (into < 0) {
          this.vx -= into * hit.nx;
          this.vy -= into * hit.ny;
        }
      }
      if (!touched) break;
    }
  }

  /**
   * Ground and wall checks.
   *
   * The original used two OverlapCircle probes of radius 0.5 filtered by layer:
   * layer 8 ("zemin") counted as floor, layer 9 ("wall") as climbable. Those
   * layers survive into the level data as the solid's `kind`.
   */
  _probe() {
    const hw = this.half;
    const hh = this.half;
    const skin = 0.06;

    this.grounded = false;
    this.groundSolid = null;
    this.onWall = 0;

    for (const solid of this.world.solids) {
      if (solid.kind === 'ground' || solid.kind === 'plain') {
        const hit = resolveAabbObb(this.x, this.y - skin, hw * 0.92, hh, solid.box);
        if (hit && hit.ny > 0.55) {
          this.grounded = true;
          // Prefer the platform we are most squarely on top of.
          if (!this.groundSolid || hit.depth > 0.02) this.groundSolid = solid;
        }
      }
      if (solid.kind === 'wall') {
        const right = resolveAabbObb(this.x + skin, this.y, hw, hh * 0.9, solid.box);
        if (right && right.nx < -0.55) this.onWall = 1;
        const left = resolveAabbObb(this.x - skin, this.y, hw, hh * 0.9, solid.box);
        if (left && left.nx > 0.55) this.onWall = -1;
      }
    }
  }
}
