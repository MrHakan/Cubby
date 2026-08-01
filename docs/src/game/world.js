/**
 * Runtime level state.
 *
 * Builds the mutable world from the static data in `levels.js` and advances
 * everything that moves. Three of these came out of the original Unity
 * AnimationClips; the rest were added for the extended level set.
 *
 *   - `move`     → a cosine sweep along x or y (Level 7's shuttle, and lifts)
 *   - `pulse`    → a width pulse (Level 4's shrinking platforms)
 *   - `brittle`  → gives way under load. `holds: 1` is Level 6's heavy-only
 *                  plank; `holds: 0` is a crumbling tile anyone breaks.
 *   - `blink`    → phases in and out on a cycle
 *   - `spring`   → launches whatever lands on it
 *   - `conveyor` → drags whatever stands on it
 *
 * Hazards (`spikes`) kill on contact.
 */

import { makeBox, setBoxAngle, boxExtents, aabbOverlap } from './physics.js';

const TAU = Math.PI * 2;
const GRAVITY = 13.734; // 9.81 * the player's 1.4 gravity scale

/** Hermite blend with flat tangents — matches Unity's default auto keyframes. */
function smooth(t) {
  return t * t * (3 - 2 * t);
}

export class World {
  constructor(data) {
    this.data = data;
    this.name = data.name;
    this.title = data.title || data.name;
    this.hint = data.hint || '';
    this.killY = data.killY;
    this.time = 0;
    this.shakeRequest = 0;

    this.solids = data.solids.map((s) => {
      const solid = {
        kind: s.kind,
        base: s,
        box: makeBox(s.x, s.y, s.w, s.h, s.angle || 0),
        vx: 0,
        vy: 0,
        move: s.move || null,
        pulse: s.pulse || null,
        blink: s.blink || null,
        spring: s.spring || null,
        conveyor: s.conveyor || null,
        brittle: null,
        gone: false,
        solidNow: true,
        fade: 1,
        compress: 0,
      };
      if (s.brittle) {
        solid.brittle = {
          holds: s.brittle.holds,
          creak: s.brittle.creak,
          respawn: s.brittle.respawn || 0,
          load: 0,
          fallTime: 0,
          regrow: 0,
        };
        solid.kind = 'ground';
      }
      return solid;
    });

    this.coins = data.coins.map((c, i) => ({ x: c.x, y: c.y, taken: false, phase: i * 0.7 }));
    this.powerups = data.powerups.map((p) => ({ ...p, taken: false }));
    this.zones = data.zones.map((z) => ({ ...z }));
    this.decor = (data.decor || []).map((d) => ({ ...d }));
    this.spikes = (data.spikes || []).map((h) => ({ ...h }));
    this.goal = data.goal
      ? { ...data.goal, box: makeBox(data.goal.x, data.goal.y, data.goal.w, data.goal.h) }
      : null;
    this.spawn = { x: data.spawn[0], y: data.spawn[1] };

    this.bounds = this._computeBounds();
    this.update(0, null);
  }

  get coinsLeft() {
    return this.coins.reduce((n, c) => n + (c.taken ? 0 : 1), 0);
  }

  get coinsTotal() {
    return this.coins.length;
  }

  _computeBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y, hw = 0, hh = 0) => {
      minX = Math.min(minX, x - hw);
      maxX = Math.max(maxX, x + hw);
      minY = Math.min(minY, y - hh);
      maxY = Math.max(maxY, y + hh);
    };
    for (const s of this.solids) {
      if (s.kind === 'invisible') continue;
      const e = boxExtents(s.box);
      // A sweeping platform must not drag the camera around, so use its span.
      const reachX = s.move && s.move.axis !== 'y' ? s.move.amp : 0;
      const reachY = s.move && s.move.axis === 'y' ? s.move.amp : 0;
      add(s.box.x, s.box.y, e.x + reachX, e.y + reachY);
    }
    for (const c of this.coins) add(c.x, c.y, 0.6, 0.9);
    for (const p of this.powerups) add(p.x, p.y, 0.8, 0.8);
    for (const h of this.spikes) add(h.x, h.y, h.w / 2, h.h / 2);
    if (this.goal) add(this.goal.x, this.goal.y, this.goal.w, this.goal.h / 2);
    add(this.spawn.x, this.spawn.y, 1.2, 1.6);
    if (!isFinite(minX)) return { minX: -18, minY: -10, maxX: 18, maxY: 10 };
    return { minX, minY, maxX, maxY };
  }

  /**
   * @param {number} dt   seconds since the previous step
   * @param {?object} rider  the player, whose weight loads brittle platforms
   */
  update(dt, rider) {
    this.time += dt;

    for (const s of this.solids) {
      const beforeX = s.box.x;
      const beforeY = s.box.y;

      if (s.move) {
        const { axis, center, amp, period, phase = 0 } = s.move;
        const v = center + amp * Math.cos(TAU * (this.time / period + phase));
        if (axis === 'y') s.box.y = v;
        else s.box.x = v;
      }

      if (s.pulse) {
        const { from, to, period } = s.pulse;
        // 4 → 0.746 → 4 with eased keys, looping.
        const u = (this.time % period) / period;
        const k = u < 0.548 ? smooth(u / 0.548) : 1 - smooth((u - 0.548) / 0.452);
        s.box.hw = (from + (to - from) * k) / 2;
      }

      if (s.blink) {
        const { period, on, phase = 0 } = s.blink;
        const u = (this.time / period + phase) % 1;
        const wasSolid = s.solidNow;
        s.solidNow = u < on / period;
        // Never wink out from under a cube that is standing on it — that reads
        // as the game cheating. It waits for the next cycle instead.
        if (wasSolid && !s.solidNow && rider && rider.groundSolid === s) {
          s.solidNow = true;
        }
        const edge = Math.min(u, Math.abs(u - on / period)) * period;
        s.fade = s.solidNow ? 1 : 0.18 + 0.1 * Math.sin(this.time * 6);
        s.warn = s.solidNow && edge < 0.45;
      }

      if (s.brittle) this._stepBrittle(s, dt, rider);

      if (s.spring) {
        s.compress = Math.max(0, s.compress - dt * 5);
      }

      if (dt > 0) {
        s.vx = (s.box.x - beforeX) / dt;
        s.vy = (s.box.y - beforeY) / dt;
      }
    }

    for (const c of this.coins) c.phase += dt;
  }

  /**
   * A platform that gives way under load.
   *
   * `holds: 1` is Level 6's plank — rigid under a small or normal cube, broken
   * only by a heavy one. `holds: 0` is a crumbling tile that anyone breaks.
   * With `respawn` set it grows back after that many seconds.
   */
  _stepBrittle(s, dt, rider) {
    if (dt <= 0) return;
    const b = s.brittle;

    if (s.gone) {
      b.fallTime += dt;
      s.box.y = s.base.y - 0.5 * GRAVITY * b.fallTime * b.fallTime;
      setBoxAngle(s.box, (s.base.angle || 0) + 90 * b.fallTime);
      if (b.respawn && b.fallTime >= b.respawn) {
        // Only come back once nothing is standing where it will reappear.
        const clear = !rider || !aabbOverlap(rider.x, rider.y, rider.half, rider.half,
          s.base.x, s.base.y, s.base.w / 2 + 0.1, s.base.h / 2 + 0.1);
        if (clear) {
          s.gone = false;
          s.announced = false;
          b.load = 0;
          b.fallTime = 0;
          s.box.x = s.base.x;
          s.box.y = s.base.y;
          setBoxAngle(s.box, s.base.angle || 0);
        }
      }
      return;
    }

    const loaded = rider && rider.groundSolid === s && rider.mass > b.holds;
    if (loaded) {
      b.load += dt;
      if (b.load >= b.creak) {
        s.gone = true;
        b.load = b.creak;
        return;
      }
    } else {
      b.load = Math.max(0, b.load - dt * 2);
    }

    // Barely visible give — enough to telegraph, far too little to wedge on.
    s.box.y = s.base.y - 0.12 * (b.load / b.creak);
  }

  /** Coins overlapping the player's box; the caller decides what to do with them. */
  collectCoins(px, py, hw, hh, onTake) {
    for (const c of this.coins) {
      if (c.taken) continue;
      // Tall pickup box: a point on your path is collected whether you walk
      // through it or clear it at the top of a jump. The original's Point was
      // a 0.5 x 1.5 ellipse, so this is also closer to how it looked.
      if (aabbOverlap(px, py, hw, hh, c.x, c.y, 0.34, 0.72)) {
        c.taken = true;
        onTake(c);
      }
    }
  }

  collectPowerups(px, py, hw, hh, onTake) {
    for (const p of this.powerups) {
      if (p.taken) continue;
      if (aabbOverlap(px, py, hw, hh, p.x, p.y, 0.45, 0.45)) {
        p.taken = true;
        onTake(p);
      }
    }
  }

  /** Any hazard the player is touching. Spikes use a slightly forgiving box. */
  spikeAt(px, py, hw, hh) {
    for (const h of this.spikes) {
      if (aabbOverlap(px, py, hw, hh, h.x, h.y, h.w / 2 - 0.08, h.h / 2 - 0.08)) return h;
    }
    return null;
  }

  zoneAt(px, py, hw, hh, type) {
    for (const z of this.zones) {
      if (z.type !== type) continue;
      if (aabbOverlap(px, py, hw, hh, z.x, z.y, z.w / 2, z.h / 2)) return z;
    }
    return null;
  }

  atGoal(px, py, hw, hh) {
    if (!this.goal) return false;
    return aabbOverlap(px, py, hw, hh, this.goal.x, this.goal.y, this.goal.w / 2, this.goal.h / 2);
  }
}
