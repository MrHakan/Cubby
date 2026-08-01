/**
 * Canvas renderer.
 *
 * Everything is drawn procedurally in world units — no sprite sheet — so the
 * game stays crisp on any display and the whole build is a handful of text
 * files. The palette follows the original: pale-blue cube, white platforms,
 * yellow points, green gate, deep teal background.
 */

const COLORS = {
  bgTop: '#071219',
  bgBottom: '#0e2a36',
  grid: 'rgba(111, 242, 255, 0.045)',
  star: 'rgba(180, 232, 245, 0.55)',
  ground: '#eef8ff',
  groundEdge: 'rgba(111, 242, 255, 0.55)',
  wall: '#8fa9b6',
  wallStripe: 'rgba(214, 240, 250, 0.35)',
  point: '#ffea55',
  pointGlow: 'rgba(255, 234, 85, 0.45)',
  gate: '#88ff7c',
  gateLocked: '#3d6a52',
  cubby: '#c2e3ff',
  cubbyEdge: '#ffffff',
  eye: '#0a1c26',
  boost: 'rgba(255, 122, 89, 0.5)',
  spring: '#8affc4',
  conveyor: '#ffd27a',
  blink: '#b48bff',
  spike: '#ff6b7f',
};

const POWERUP_STYLE = {
  small: { color: '#6ff2ff', label: 'S' },
  normal: { color: '#eef8ff', label: 'N' },
  big: { color: '#ff9de0', label: 'B' },
  antigravity: { color: '#b48bff', label: '↑' },
  gravity: { color: '#ffb15c', label: '↓' },
};

/** Deterministic per-level star field, so the sky doesn't reshuffle on retry. */
function makeStars(seed, count = 130) {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: rnd() * 2 - 1,
    y: rnd() * 2 - 1,
    r: 0.4 + rnd() * 1.4,
    depth: 0.15 + rnd() * 0.5,
    twinkle: rnd() * Math.PI * 2,
  }));
}

/** Blend two #rrggbb colours, t in 0..1. */
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift) => {
    const va = (pa >> shift) & 255;
    const vb = (pb >> shift) & 255;
    return Math.round(va + (vb - va) * t);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Draw text in a y-up world transform without it coming out mirrored. */
function worldText(ctx, text, x, y, size, color, weight = '700') {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.stars = makeStars(1);
    this.resize();
  }

  setLevelSeed(seed) {
    this.stars = makeStars(seed * 2654435761);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    // Cap the backing store on very dense displays; the art is flat colour and
    // 2× is already past the point of visible difference.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.width = w;
    this.height = h;
  }

  get aspect() {
    return this.width / this.height;
  }

  draw(world, player, camera, particles, time) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    this._background(ctx, camera, time);

    camera.apply(ctx, this.width, this.height);
    ctx.lineJoin = 'round';

    this._zones(ctx, world, time);
    this._solids(ctx, world, time);
    this._decor(ctx, world, time);
    this._spikes(ctx, world, time);
    this._goal(ctx, world, time);
    this._coins(ctx, world, time);
    this._powerups(ctx, world, time);
    particles.draw(ctx);
    if (player && !player.dead) this._player(ctx, player, time);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this._vignette(ctx);
  }

  // ---------------------------------------------------------------- layers

  _background(ctx, camera, time) {
    const { width: w, height: h } = this;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, COLORS.bgTop);
    grad.addColorStop(1, COLORS.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Stars drift against the camera at a few different depths.
    ctx.save();
    for (const s of this.stars) {
      const px = ((s.x * 0.5 + 0.5) * w - camera.x * s.depth * 26) % w;
      const py = ((s.y * 0.5 + 0.5) * h + camera.y * s.depth * 26) % h;
      const x = px < 0 ? px + w : px;
      const y = py < 0 ? py + h : py;
      const tw = 0.55 + 0.45 * Math.sin(time * 1.6 + s.twinkle);
      ctx.globalAlpha = tw * s.depth * 1.5;
      ctx.fillStyle = COLORS.star;
      ctx.fillRect(x, y, s.r * this.dpr, s.r * this.dpr);
    }
    ctx.restore();

    // A slow grid, parallaxed behind the level.
    const cell = (h / camera.viewH) * 4;
    if (cell > 12) {
      const ox = (-camera.x * (h / camera.viewH) * 0.35) % cell;
      const oy = (camera.y * (h / camera.viewH) * 0.35) % cell;
      ctx.save();
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = Math.max(1, this.dpr);
      ctx.beginPath();
      for (let x = ox % cell; x < w; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = oy % cell; y < h; y += cell) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.restore();
    }
  }

  _zones(ctx, world, time) {
    for (const z of world.zones) {
      if (z.type === 'speed') {
        ctx.save();
        ctx.globalAlpha = 0.5;
        const g = ctx.createLinearGradient(0, z.y - z.h / 2, 0, z.y + z.h / 2);
        g.addColorStop(0, 'rgba(255, 122, 89, 0)');
        g.addColorStop(1, COLORS.boost);
        ctx.fillStyle = g;
        ctx.fillRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
        ctx.strokeStyle = 'rgba(255, 160, 120, 0.8)';
        ctx.lineWidth = 0.05;
        for (let i = 0; i < 4; i++) {
          const t = ((time * 1.7 + i * 0.25) % 1);
          const x = z.x - z.w / 2 + t * z.w;
          ctx.globalAlpha = 0.55 * Math.sin(t * Math.PI);
          ctx.beginPath();
          ctx.moveTo(x - 0.25, z.y - 0.3);
          ctx.lineTo(x + 0.1, z.y);
          ctx.lineTo(x - 0.25, z.y + 0.3);
          ctx.stroke();
        }
        ctx.restore();
      } else {
        // The easter-egg doors: a faint shimmer, easy to miss on purpose.
        ctx.save();
        ctx.globalAlpha = 0.16 + 0.1 * Math.sin(time * 2);
        ctx.fillStyle = COLORS.cubby;
        ctx.fillRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h);
        ctx.restore();
      }
    }
  }

  _solids(ctx, world, time) {
    for (const s of world.solids) {
      if (s.kind === 'invisible') continue;
      const b = s.box;
      const w = b.hw * 2;
      const h = b.hh * 2;
      const isWall = s.kind === 'wall';

      // A plank under too much weight shudders before it lets go, then falls.
      const strain = s.brittle && !s.gone ? s.brittle.load / s.brittle.creak : 0;
      if (s.gone && s.box.y < world.killY - 6) continue;

      ctx.save();
      if (strain > 0) {
        ctx.translate((Math.random() - 0.5) * strain * 0.14, 0);
      }
      if (s.gone) ctx.globalAlpha = 0.75;
      else if (s.blink) ctx.globalAlpha = s.fade;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      if (s.spring && s.compress > 0) ctx.scale(1 + s.compress * 0.12, 1 - s.compress * 0.4);

      const radius = Math.min(0.14, Math.min(w, h) * 0.35);

      const accent = s.spring ? COLORS.spring
        : s.conveyor ? COLORS.conveyor
        : s.blink ? COLORS.blink
        : null;

      ctx.shadowColor = isWall ? 'rgba(143,169,182,0.55)'
        : strain > 0 ? 'rgba(255,140,110,0.9)'
        : accent ? accent + 'cc' : COLORS.groundEdge;
      ctx.shadowBlur = 14 + strain * 18;
      ctx.fillStyle = isWall ? COLORS.wall
        : strain > 0 ? mix(COLORS.ground, '#ff9a7a', strain)
        : accent ? mix(COLORS.ground, accent, 0.5) : COLORS.ground;
      roundRect(ctx, -b.hw, -b.hh, w, h, radius);
      ctx.fill();
      ctx.shadowBlur = 0;

      if (isWall) {
        // Diagonal hatching marks the surfaces you can climb.
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = COLORS.wallStripe;
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        for (let x = -b.hw - h; x < b.hw + h; x += 0.5) {
          ctx.moveTo(x, -b.hh);
          ctx.lineTo(x + h, b.hh);
        }
        ctx.stroke();
        ctx.restore();
      } else {
        // A brighter lip on top reads as the surface you land on.
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        roundRect(ctx, -b.hw, b.hh - Math.min(0.09, h * 0.3), w, Math.min(0.09, h * 0.3), 0.04);
        ctx.fill();
        ctx.fillStyle = 'rgba(10, 32, 42, 0.28)';
        ctx.fillRect(-b.hw, -b.hh, w, Math.min(0.1, h * 0.3));
      }

      // Anything that moves under you gets an outline, so it reads as special.
      if (s.move || s.pulse || s.brittle) {
        ctx.strokeStyle = strain > 0 ? 'rgba(255, 150, 110, 0.95)' : 'rgba(111, 242, 255, 0.7)';
        ctx.lineWidth = 0.045;
        roundRect(ctx, -b.hw, -b.hh, w, h, radius);
        ctx.stroke();
        ctx.fillStyle = strain > 0 ? 'rgba(255, 150, 110, 0.95)' : 'rgba(111, 242, 255, 0.8)';
        for (const end of [-1, 1]) {
          ctx.fillRect(end * b.hw - 0.05, -b.hh - 0.02, 0.1, h + 0.04);
        }
      }

      // Chevrons pointing the way a belt drags you.
      if (s.conveyor) {
        const dir = Math.sign(s.conveyor.speed) || 1;
        ctx.strokeStyle = 'rgba(10, 32, 42, 0.55)';
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        const step = 0.55;
        const slide = (time * s.conveyor.speed * 0.5) % step;
        for (let x = -b.hw - step; x < b.hw + step; x += step) {
          const px = x + slide * dir;
          if (px < -b.hw + 0.05 || px > b.hw - 0.15) continue;
          ctx.moveTo(px, -b.hh + 0.05);
          ctx.lineTo(px + 0.14 * dir, 0);
          ctx.lineTo(px, b.hh - 0.05);
        }
        ctx.stroke();
      }

      // A spring reads as a coiled pad.
      if (s.spring) {
        ctx.strokeStyle = 'rgba(10, 40, 30, 0.6)';
        ctx.lineWidth = 0.06;
        ctx.beginPath();
        for (let i = -2; i <= 2; i++) {
          const x = (i / 2.4) * b.hw;
          ctx.moveTo(x, -b.hh + 0.04);
          ctx.lineTo(x, b.hh - 0.04);
        }
        ctx.stroke();
      }

      // A blinking platform flashes just before it vanishes.
      if (s.blink && s.warn) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 0.06;
        roundRect(ctx, -b.hw, -b.hh, w, h, radius);
        ctx.stroke();
      }

      // Cracks opening up across a plank that is about to go.
      if (strain > 0.25) {
        ctx.strokeStyle = `rgba(20, 12, 10, ${0.3 + strain * 0.5})`;
        ctx.lineWidth = 0.05 + strain * 0.05;
        ctx.beginPath();
        for (let i = -2; i <= 2; i++) {
          const x = (i / 2.6) * b.hw;
          ctx.moveTo(x, -b.hh);
          ctx.lineTo(x + 0.18 * strain, b.hh);
        }
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  _spikes(ctx, world, time) {
    for (const h of world.spikes) {
      const teeth = Math.max(2, Math.round(h.w / 0.5));
      const up = h.dir !== 'down';
      ctx.save();
      ctx.shadowColor = 'rgba(255,107,127,0.8)';
      ctx.shadowBlur = 12 + Math.sin(time * 3 + h.x) * 4;
      ctx.fillStyle = COLORS.spike;
      ctx.beginPath();
      const x0 = h.x - h.w / 2;
      const base = up ? h.y - h.h / 2 : h.y + h.h / 2;
      const tip = up ? h.y + h.h / 2 : h.y - h.h / 2;
      ctx.moveTo(x0, base);
      for (let i = 0; i < teeth; i++) {
        const a = x0 + (i * h.w) / teeth;
        const b = x0 + ((i + 1) * h.w) / teeth;
        ctx.lineTo((a + b) / 2, tip);
        ctx.lineTo(b, base);
      }
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255, 210, 215, 0.7)';
      ctx.fillRect(x0, base - (up ? 0.06 : -0.06), h.w, 0.06);
      ctx.restore();
    }
  }

  _decor(ctx, world, time) {
    for (const d of world.decor) {
      if (d.type !== 'arrow') continue;
      const dir = d.flip ? -1 : 1;
      const bob = Math.sin(time * 2.2) * 0.18;
      ctx.save();
      ctx.translate(d.x + bob * dir, d.y);
      ctx.scale(dir, 1);
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = COLORS.gate;
      ctx.beginPath();
      ctx.moveTo(-0.5, 0.28);
      ctx.lineTo(0.15, 0.28);
      ctx.lineTo(0.15, 0.62);
      ctx.lineTo(0.85, 0);
      ctx.lineTo(0.15, -0.62);
      ctx.lineTo(0.15, -0.28);
      ctx.lineTo(-0.5, -0.28);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  _goal(ctx, world, time) {
    const g = world.goal;
    if (!g) return;
    const open = world.coinsLeft === 0;
    const w = Math.max(g.w, 0.42);
    const h = g.h;

    ctx.save();
    ctx.translate(g.x, g.y);

    ctx.shadowColor = open ? 'rgba(136,255,124,0.85)' : 'rgba(61,106,82,0.5)';
    ctx.shadowBlur = open ? 26 : 8;
    ctx.fillStyle = open ? COLORS.gate : COLORS.gateLocked;
    roundRect(ctx, -w / 2, -h / 2, w, h, 0.16);
    ctx.fill();
    ctx.shadowBlur = 0;

    if (open) {
      // Energy running up the gate once it unlocks.
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) {
        const t = ((time * 0.85 + i / 3) % 1);
        const y = -h / 2 + t * h;
        ctx.globalAlpha = 0.5 * Math.sin(t * Math.PI);
        ctx.fillRect(-w / 2, y, w, 0.12);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 0.85;
      worldText(ctx, String(world.coinsLeft), 0, 0, 0.62, '#c9f5d8');
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  _coins(ctx, world, time) {
    for (const c of world.coins) {
      if (c.taken) continue;
      const bob = Math.sin(time * 2.4 + c.phase) * 0.12;
      // Never fully edge-on: a point you cannot see is a point you cannot plan for.
      const spin = 0.32 + 0.68 * Math.abs(Math.cos(time * 2.4 + c.phase));
      ctx.save();
      ctx.translate(c.x, c.y + bob);

      ctx.shadowColor = COLORS.pointGlow;
      ctx.shadowBlur = 22;
      ctx.fillStyle = COLORS.point;
      ctx.beginPath();
      ctx.moveTo(0, 0.66);
      ctx.lineTo(0.3 * spin, 0);
      ctx.lineTo(0, -0.66);
      ctx.lineTo(-0.3 * spin, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#fffbe0';
      ctx.beginPath();
      ctx.moveTo(0, 0.44);
      ctx.lineTo(0.12 * spin, 0.03);
      ctx.lineTo(0, -0.16);
      ctx.lineTo(-0.12 * spin, 0.03);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  _powerups(ctx, world, time) {
    for (const p of world.powerups) {
      if (p.taken) continue;
      const style = POWERUP_STYLE[p.type] || POWERUP_STYLE.normal;
      // The original spun these with a 2 s, 720° AnimationClip.
      const angle = (time % 2) * Math.PI;
      const bob = Math.sin(time * 1.8 + p.x) * 0.1;

      ctx.save();
      ctx.translate(p.x, p.y + bob);

      ctx.shadowColor = style.color;
      ctx.shadowBlur = 22;
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = style.color;
      ctx.beginPath();
      ctx.arc(0, 0, 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.rotate(angle);
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 0.08;
      roundRect(ctx, -0.34, -0.34, 0.68, 0.68, 0.12);
      ctx.stroke();
      ctx.rotate(-angle);
      ctx.shadowBlur = 0;

      worldText(ctx, style.label, 0, 0, 0.46, style.color);
      ctx.restore();
    }
  }

  _player(ctx, p, time) {
    const s = p.scale;
    // Squash and stretch, volume-preserving so it never looks like it grew.
    const stretch = 1 + p.squash * 0.16;
    const w = s / stretch;
    const h = s * stretch;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(-p.tilt);

    if (p.boosted) {
      ctx.shadowColor = 'rgba(255,140,100,0.9)';
      ctx.shadowBlur = 26;
    } else {
      ctx.shadowColor = 'rgba(111,242,255,0.7)';
      ctx.shadowBlur = 18;
    }
    ctx.fillStyle = COLORS.cubby;
    roundRect(ctx, -w / 2, -h / 2, w, h, s * 0.18);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = s * 0.035;
    roundRect(ctx, -w / 2, -h / 2, w, h, s * 0.18);
    ctx.stroke();

    // Eyes lead the direction of travel and blink now and then.
    const look = p.facing * s * 0.06 + Math.max(-1, Math.min(1, p.vx / 12)) * s * 0.05;
    const blink = (time % 4.3) < 0.11 ? 0.16 : 1;
    ctx.fillStyle = COLORS.eye;
    const eye = s * 0.15;
    for (const dx of [-s * 0.17, s * 0.17]) {
      roundRect(ctx, dx + look - eye / 2, s * 0.08 - (eye * blink) / 2, eye, eye * blink, eye * 0.3);
      ctx.fill();
    }

    if (p.gravityScale < 0) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#b48bff';
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.78 + Math.sin(time * 5) * 0.03, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  _vignette(ctx) {
    const { width: w, height: h } = this;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}
