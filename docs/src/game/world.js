/**
 * Runtime level state.
 *
 * Builds the mutable world from the static data in `levels.js` and advances the
 * animated pieces the original drove with Unity AnimationClips:
 *
 *   - `move`   → xmove.anim, a 2 s cosine sweep along x (Level 7's shuttle)
 *   - `pulse`  → MovingRectangle.anim, a scale.x pulse (Level 4's platforms)
 *   - `brittle` → the Rigidbody2D plank in Level 6, which only a heavy cube breaks
 */

import { makeBox, setBoxAngle, boxExtents, aabbOverlap } from './physics.js';

const TAU = Math.PI * 2;

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

    this.solids = data.solids.map((s) => {
      const solid = {
        kind: s.kind,
        base: s,
        box: makeBox(s.x, s.y, s.w, s.h, s.angle || 0),
        vx: 0,
        vy: 0,
        move: s.move || null,
        pulse: s.pulse || null,
        brittle: null,
        gone: false,
      };
      if (s.brittle) {
        // Holds a normal cube indefinitely; a heavy one breaks through.
        solid.brittle = {
          holds: s.brittle.holds,
          creak: s.brittle.creak,
          load: 0,
          sag: 0,
          fallTime: 0,
          spin: 0,
        };
        solid.kind = 'ground';
      }
      return solid;
    });

    this.coins = data.coins.map((c, i) => ({ x: c.x, y: c.y, taken: false, phase: i * 0.7 }));
    this.powerups = data.powerups.map((p) => ({ ...p, taken: false }));
    this.zones = data.zones.map((z) => ({ ...z }));
    this.decor = (data.decor || []).map((d) => ({ ...d }));
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
      const reach = s.move ? s.move.amp : 0;
      add(s.box.x, s.box.y, e.x + reach, e.y);
    }
    for (const c of this.coins) add(c.x, c.y, 0.6, 0.9);
    for (const p of this.powerups) add(p.x, p.y, 0.8, 0.8);
    if (this.goal) add(this.goal.x, this.goal.y, this.goal.w, this.goal.h / 2);
    add(this.spawn.x, this.spawn.y, 1.2, 1.6);
    if (!isFinite(minX)) return { minX: -18, minY: -10, maxX: 18, maxY: 10 };
    return { minX, minY, maxX, maxY };
  }

  /**
   * @param {number} dt   seconds since the previous step
   * @param {?object} rider  the player, whose weight loads the brittle plank
   */
  update(dt, rider) {
    this.time += dt;

    for (const s of this.solids) {
      const before = { x: s.box.x, y: s.box.y };

      if (s.move) {
        const { center, amp, period } = s.move;
        s.box.x = center + amp * Math.cos((TAU * this.time) / period);
      }

      if (s.pulse) {
        const { from, to, period } = s.pulse;
        // 4 → 0.746 → 4 with eased keys, looping.
        const u = (this.time % period) / period;
        const k = u < 0.548 ? smooth(u / 0.548) : 1 - smooth((u - 0.548) / 0.452);
        s.box.hw = (from + (to - from) * k) / 2;
      }

      if (s.brittle) {
        this._stepBrittle(s, dt, rider);
      }

      if (dt > 0) {
        s.vx = (s.box.x - before.x) / dt;
        s.vy = (s.box.y - before.y) / dt;
      }
    }

    for (const c of this.coins) c.phase += dt;
  }

  /**
   * The Level 6 plank.
   *
   * It is a plain, rigid platform for a small or normal cube — it does not
   * shift at all. Only a cube heavier than `holds` (the B orb takes you to
   * mass 4) loads it: it sags and creaks for `creak` seconds, then gives way
   * and drops out of the level, which is the level's whole point.
   */
  _stepBrittle(s, dt, rider) {
    if (dt <= 0) return;
    const b = s.brittle;

    if (s.gone) {
      // Already broken: tumble away. It stopped colliding the moment it went.
      b.fallTime += dt;
      b.spin += 60 * dt;
      s.box.y = s.base.y - 0.5 * 13.734 * b.fallTime * b.fallTime;
      setBoxAngle(s.box, (s.base.angle || 0) + b.spin * b.fallTime);
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
    b.sag = 0.12 * (b.load / b.creak);
    s.box.y = s.base.y - b.sag;
  }

  /** Coins overlapping the player's box; the caller decides what to do with them. */
  collectCoins(px, py, hw, hh, onTake) {
    for (const c of this.coins) {
      if (c.taken) continue;
      if (aabbOverlap(px, py, hw, hh, c.x, c.y, 0.3, 0.4)) {
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
