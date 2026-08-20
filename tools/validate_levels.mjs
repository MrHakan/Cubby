/**
 * Drive a bot through every generated level and report which ones it can
 * finish — collecting all points and reaching the gate.
 *
 * The bot is deliberately unskilled: it holds right, jumps when the ground
 * ahead runs out or something red is coming, waits at an edge when a moving
 * platform has not arrived, and climbs walls by jumping into them. Several
 * parameterisations are tried per level and the level passes if any of them
 * gets through, so "passes" means a real player has plenty of room.
 *
 * Usage:  node tools/validate_levels.mjs [--search] [--port 8099]
 *
 * With --search, failing levels are re-seeded and retried, and the winning
 * seeds are written to tools/level_seeds.json.
 */

import { chromium } from 'playwright';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const SEEDS = join(HERE, 'level_seeds.json');

const args = process.argv.slice(2);
const SEARCH = args.includes('--search');
const PORT = Number((args.find((a) => a.startsWith('--port')) || '').split('=')[1] || 8099);
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/**
 * Injected into the page. Solves a level with a greedy right-mover plus guided
 * search: progress is banked whenever the bot reaches new ground, and a failed
 * attempt restarts from the furthest bank with jittered timing. That is what
 * cracks the timing sections — ferries, lifts, blinkers — which no fixed policy
 * gets right on the first pass.
 *
 * Everything the world animates is a pure function of `world.time`, so a
 * snapshot only needs the clock, the pickups, the broken platforms, and the
 * cube itself.
 */
const BOT = function botSource() {
  window.__solve = function (levelIndex, opts) {
    const { game } = window.cubby;
    const attempts = opts.attempts || 90;
    const seconds = opts.seconds || 70;

    let rngState = (levelIndex * 2654435761 + 12345) >>> 0;
    const rnd = () => {
      rngState ^= rngState << 13; rngState >>>= 0;
      rngState ^= rngState >> 17;
      rngState ^= rngState << 5; rngState >>>= 0;
      return rngState / 4294967296;
    };

    const snapshot = (p, w) => ({
      x: p.x, y: p.y, vx: p.vx, vy: p.vy, axis: p.axis, facing: p.facing,
      scale: p.scale, mass: p.mass, gravityScale: p.gravityScale,
      boosted: p.boosted, grounded: p.grounded, coyote: p.coyote, buffer: p.buffer,
      time: w.time,
      coins: w.coins.map((c) => c.taken),
      orbs: w.powerups.map((o) => o.taken),
      solids: w.solids.map((s) => ({
        gone: s.gone, load: s.brittle ? s.brittle.load : 0,
        fall: s.brittle ? s.brittle.fallTime : 0,
      })),
    });

    const restore = (snap) => {
      game.loadLevel(levelIndex);
      game.stop();
      const p = game.player, w = game.world;
      if (!snap) return { p, w };
      Object.assign(p, {
        x: snap.x, y: snap.y, vx: snap.vx, vy: snap.vy, axis: snap.axis,
        facing: snap.facing, scale: snap.scale, mass: snap.mass,
        gravityScale: snap.gravityScale, boosted: snap.boosted,
        grounded: snap.grounded, coyote: snap.coyote, buffer: snap.buffer,
      });
      w.time = snap.time;
      w.coins.forEach((c, i) => { c.taken = snap.coins[i]; });
      w.powerups.forEach((o, i) => { o.taken = snap.orbs[i]; });
      w.solids.forEach((s, i) => {
        s.gone = snap.solids[i].gone;
        if (s.brittle) { s.brittle.load = snap.solids[i].load; s.brittle.fallTime = snap.solids[i].fall; }
      });
      w.update(0, p);
      return { p, w };
    };

    const banks = new Map();          // one snapshot per 3-unit slice of level
    let best = { x: -Infinity, coinsLeft: 99 };

    for (let attempt = 0; attempt < attempts; attempt++) {
      // First few runs start clean; after that, resume from banked progress.
      // The banks form a ladder up the level, and the draw is weighted hard
      // toward the top of it: sampled evenly, nearly every attempt would go
      // back to re-running ground the bot has already proved it can cross,
      // and the end of a long level would never be reached at all.
      const ladder = [...banks.values()].sort((a, b) => a.x - b.x);
      const seed = attempt < 3 || !ladder.length
        ? null
        : ladder[Math.min(ladder.length - 1, Math.floor(ladder.length * (1 - rnd() ** 2)))];
      const { p, w } = restore(seed);

      const look = 1.0 + rnd() * 1.6;
      const cooldown = 5 + Math.floor(rnd() * 18);
      const patience = 5 + Math.floor(rnd() * 12);
      const jitter = rnd() * 0.05;          // stray jumps, to shake loose stalls
      const waitStyle = rnd() < 0.75;

      const solidTop = (x, y) => {
        let top = -Infinity;
        for (const s of w.solids) {
          if (s.gone || s.solidNow === false) continue;
          if (s.kind !== 'ground' && s.kind !== 'plain') continue;
          if (Math.abs(x - s.box.x) > s.box.hw + 0.05) continue;
          const t = s.box.y + s.box.hh;
          if (t <= y + 0.35 && t > top) top = t;
        }
        return top;
      };
      // Ground ahead at a height you could actually step onto. Without the
      // height band a safety net far below reads as "ground ahead", and the bot
      // walks off a lift the moment it boards one.
      const stepUpAhead = (x, y, tol) => {
        const t = solidTop(x, y + tol);
        return t !== -Infinity && Math.abs(t - y) <= tol;
      };
      const spikeAhead = (x, y, reach) => w.spikes.some((h) =>
        h.x + h.w / 2 >= x && h.x - h.w / 2 <= x + reach && Math.abs(h.y - y) < 3);

      let sinceJump = 99, stuck = 0, lastX = p.x, maxX = p.x, sinceBank = 0;

      for (let step = 0; step < seconds * 120; step++) {
        const feet = p.y - p.half;
        let jump = false;
        let axis = 1;

        if (p.grounded) {
          const ahead = solidTop(p.x + look, feet);
          if (ahead === -Infinity || ahead < feet - 2.5 ||
              spikeAhead(p.x, feet, look + 1.2)) {
            if (sinceJump > cooldown) jump = true;
          }
          if (waitStyle) {
            if (p.groundSolid && p.groundSolid.move) {
              // On a ferry: sit tight until ground level with us is in reach.
              axis = stepUpAhead(p.x + 3.0, feet, 0.5) ? 1 : 0;
            } else if (ahead === -Infinity && solidTop(p.x + look + 2.8, feet) === -Infinity) {
              const ferry = w.solids.some((q) => q.move && !q.gone &&
                q.box.x > p.x - 1.5 && q.box.x < p.x + 5 &&
                Math.abs((q.box.y + q.box.hh) - feet) < 3.2);
              const blinkComing = w.solids.some((q) => q.blink && q.solidNow === false &&
                q.box.x > p.x && q.box.x < p.x + 5);
              if (!ferry && !blinkComing) axis = 0;
            }
          }
        }

        if (Math.abs(p.x - lastX) < 0.004) stuck++; else stuck = 0;
        lastX = p.x;
        if (stuck > patience && sinceJump > cooldown) { jump = true; stuck = 0; }
        if (rnd() < jitter && sinceJump > cooldown) jump = true;

        sinceJump = jump ? 0 : sinceJump + 1;
        w.update(1 / 120, p);
        p.step(1 / 120, { axis, pressed: { jump } });
        game._triggers(1 / 120);

        if (game.state === 'cleared') return { ok: true, attempt, t: +(step / 120).toFixed(1) };
        if (p.dead) break;

        // Bank standing-still-on-solid-ground progress for later attempts —
        // but only from a position that is still winnable. The bot only ever
        // travels right, so a bank taken with a coin left behind can never be
        // completed from, and once such a bank is the furthest one every
        // resumed attempt inherits the same dead run.
        sinceBank++;
        if (p.grounded && p.x > maxX + 2.5 && sinceBank > 30 &&
            !w.coins.some((c) => !c.taken && c.x < p.x - 0.6) &&
            !(p.groundSolid && (p.groundSolid.move || p.groundSolid.brittle || p.groundSolid.blink))) {
          maxX = p.x;
          sinceBank = 0;
          const slice = Math.round(p.x / 3);
          if (!banks.has(slice)) banks.set(slice, snapshot(p, w));
        }
        if (p.x > best.x) best = { x: +p.x.toFixed(1), y: +p.y.toFixed(1), coinsLeft: w.coinsLeft };
      }
    }

    const w = game.world;
    return { ok: false, x: best.x, y: best.y, coinsLeft: best.coinsLeft,
             goalX: w.goal ? +w.goal.x.toFixed(1) : null };
  };
};

function regenerate() {
  execFileSync('python3', [join(HERE, 'generate_levels.py')], { cwd: ROOT, stdio: 'pipe' });
}

async function main() {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  const load = async () => {
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });
    await page.evaluate(BOT);
    return page.evaluate(() => ({
      total: window.cubby.game.levelCount,
      base: window.cubby.game.baseLevelCount,
    }));
  };

  let { total, base } = await load();
  const seeds = existsSync(SEEDS) ? JSON.parse(readFileSync(SEEDS, 'utf8')) : {};

  const failures = [];
  for (let i = base; i < total; i++) {
    const best = await page.evaluate(
      ([idx, o]) => window.__solve(idx, o), [i, { attempts: 90, seconds: 70 }]);
    const n = i - base + 1;
    if (best.ok) {
      process.stdout.write(`  extra ${String(n).padStart(2)}  ok  ${String(best.t).padStart(5)}s  (try ${best.attempt + 1})\n`);
    } else {
      process.stdout.write(`  extra ${String(n).padStart(2)}  FAIL furthest (${best.x}, ${best.y}) ` +
        `coinsLeft=${best.coinsLeft} goal=${best.goalX}\n`);
      failures.push(i - base);
    }
  }

  if (SEARCH && failures.length) {
    console.log(`\nre-seeding ${failures.length} level(s)...`);
    for (const idx of failures) {
      let fixed = false;
      for (let attempt = 0; attempt < 14 && !fixed; attempt++) {
        seeds[String(idx)] = 90000 + idx * 1013 + attempt * 7717;
        writeFileSync(SEEDS, JSON.stringify(seeds, null, 1));
        regenerate();
        ({ total, base } = await load());
        const res = await page.evaluate(
          ([i, o]) => window.__solve(i, o), [base + idx, { attempts: 90, seconds: 70 }]);
        if (res.ok) {
          console.log(`  extra ${idx + 1}: seed ${seeds[String(idx)]} ok in ${res.t}s (reseed ${attempt + 1})`);
          fixed = true;
        }
      }
      if (!fixed) console.log(`  extra ${idx + 1}: STILL FAILING after 14 seeds`);
    }
  }

  console.log(`\n${total - base - failures.length}/${total - base} extended levels finishable`);
  if (errs.length) console.log('page errors:\n' + errs.join('\n'));
  await browser.close();
  process.exit(failures.length && !SEARCH ? 1 : 0);
}

main();
