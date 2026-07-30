/**
 * Collision primitives.
 *
 * The Unity original used BoxCollider2D on every platform, and many of those
 * boxes are rotated (Level 2 is nothing but slopes, Level 9 has 165° and 210°
 * ramps). So solids are oriented boxes and the player is an axis-aligned box,
 * resolved with a separating-axis test.
 */

/** An oriented box. `hw`/`hh` are half extents in the box's own frame. */
export function makeBox(x, y, w, h, angleDeg = 0) {
  const a = (angleDeg * Math.PI) / 180;
  return {
    x, y,
    hw: Math.abs(w) / 2,
    hh: Math.abs(h) / 2,
    angle: a,
    cos: Math.cos(a),
    sin: Math.sin(a),
  };
}

export function setBoxAngle(box, angleDeg) {
  box.angle = (angleDeg * Math.PI) / 180;
  box.cos = Math.cos(box.angle);
  box.sin = Math.sin(box.angle);
}

/** Radius of an oriented box projected onto the unit axis (nx, ny). */
function obbRadius(box, nx, ny) {
  const { cos, sin, hw, hh } = box;
  return hw * Math.abs(cos * nx + sin * ny) + hh * Math.abs(-sin * nx + cos * ny);
}

/** Half-width of the world-space AABB that contains an oriented box. */
export function boxExtents(box) {
  return {
    x: obbRadius(box, 1, 0),
    y: obbRadius(box, 0, 1),
  };
}

/**
 * Minimum translation vector that pushes the axis-aligned box `a`
 * (centre ax/ay, half extents ahw/ahh) out of the oriented box `b`.
 * Returns null when they are not overlapping.
 */
export function resolveAabbObb(ax, ay, ahw, ahh, b) {
  const dx = ax - b.x;
  const dy = ay - b.y;

  // Four candidate axes: the world axes plus the box's own two.
  const axes = [
    [1, 0],
    [0, 1],
    [b.cos, b.sin],
    [-b.sin, b.cos],
  ];

  let bestOverlap = Infinity;
  let nx = 0;
  let ny = 0;

  for (const [x, y] of axes) {
    const ra = ahw * Math.abs(x) + ahh * Math.abs(y);
    const rb = obbRadius(b, x, y);
    const dist = dx * x + dy * y;
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return null;
    if (overlap < bestOverlap) {
      bestOverlap = overlap;
      // Point the normal away from the solid, toward the moving box.
      const sign = dist < 0 ? -1 : 1;
      nx = x * sign;
      ny = y * sign;
    }
  }

  return { nx, ny, depth: bestOverlap };
}

/** Cheap axis-aligned overlap test, used for triggers and broad phase. */
export function aabbOverlap(ax, ay, ahw, ahh, bx, by, bhw, bhh) {
  return Math.abs(ax - bx) <= ahw + bhw && Math.abs(ay - by) <= ahh + bhh;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function approach(current, target, maxDelta) {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
}
