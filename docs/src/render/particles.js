/**
 * A small pooled particle system — dust, sparks and debris in world units.
 */

const MAX = 420;

export class Particles {
  constructor() {
    this.pool = Array.from({ length: MAX }, () => ({
      alive: false, x: 0, y: 0, vx: 0, vy: 0,
      life: 0, maxLife: 1, size: 0.1, drag: 2, gravity: 0,
      color: '#fff', shape: 'square', spin: 0, angle: 0,
    }));
    this.cursor = 0;
  }

  clear() {
    for (const p of this.pool) p.alive = false;
  }

  _take() {
    // Round-robin: the oldest slot gets recycled when we run out.
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[(this.cursor + i) % MAX];
      if (!p.alive) {
        this.cursor = (this.cursor + i + 1) % MAX;
        return p;
      }
    }
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    return p;
  }

  emit(count, fn) {
    for (let i = 0; i < count; i++) {
      const p = this._take();
      p.alive = true;
      p.drag = 2;
      p.gravity = 0;
      p.shape = 'square';
      p.spin = 0;
      p.angle = 0;
      fn(p, i, count);
      p.maxLife = p.life;
    }
  }

  burst(x, y, color, count = 12, power = 5) {
    this.emit(count, (p, i) => {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const v = power * (0.45 + Math.random() * 0.75);
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.life = 0.32 + Math.random() * 0.4;
      p.size = 0.07 + Math.random() * 0.11;
      p.color = color;
      p.gravity = -5;
      p.drag = 2.6;
      p.spin = (Math.random() - 0.5) * 14;
    });
  }

  dust(x, y, strength = 1, color = 'rgba(190,225,240,0.75)') {
    this.emit(Math.round(4 + strength * 4), (p) => {
      p.x = x + (Math.random() - 0.5) * 0.7;
      p.y = y;
      p.vx = (Math.random() - 0.5) * 3.4 * strength;
      p.vy = Math.random() * 1.7 * strength;
      p.life = 0.24 + Math.random() * 0.26;
      p.size = 0.06 + Math.random() * 0.09;
      p.color = color;
      p.drag = 5;
      p.gravity = -2;
    });
  }

  trail(x, y, color) {
    this.emit(1, (p) => {
      p.x = x + (Math.random() - 0.5) * 0.35;
      p.y = y + (Math.random() - 0.5) * 0.35;
      p.vx = (Math.random() - 0.5) * 0.7;
      p.vy = (Math.random() - 0.5) * 0.7;
      p.life = 0.3 + Math.random() * 0.2;
      p.size = 0.07 + Math.random() * 0.07;
      p.color = color;
      p.drag = 3.5;
    });
  }

  ring(x, y, color, count = 18, radius = 4) {
    this.emit(count, (p, i) => {
      const a = (i / count) * Math.PI * 2;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * radius;
      p.vy = Math.sin(a) * radius;
      p.life = 0.45;
      p.size = 0.09;
      p.color = color;
      p.drag = 4.5;
    });
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
    }
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = Math.min(1, t * 1.5);
      ctx.fillStyle = p.color;
      const s = p.size * (0.35 + t * 0.65);
      if (p.angle) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.restore();
      } else {
        ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
      }
    }
    ctx.restore();
  }
}
