/**
 * Game orchestration: the fixed-step loop, level flow, and the events the UI
 * layer listens to.
 */

import { LEVELS, BONUS_LEVEL } from './levels.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Renderer } from '../render/renderer.js';
import { Camera } from '../render/camera.js';
import { Particles } from '../render/particles.js';

const FIXED_DT = 1 / 120;
const MAX_FRAME = 0.25;
const SLOWMO = 0.4;
const DEATH_HOLD = 0.45;
const CLEAR_HOLD = 0.35;

export const BONUS_INDEX = -1;

export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../core/input.js').Input} input
   * @param {import('../core/audio.js').Audio} audio
   * @param {import('../core/storage.js').Save} save
   */
  constructor(canvas, input, audio, save) {
    this.input = input;
    this.audio = audio;
    this.save = save;

    this.renderer = new Renderer(canvas);
    this.camera = new Camera();
    this.particles = new Particles();

    this.state = 'idle';      // idle | playing | dying | cleared | paused
    this.levelIndex = 0;
    this.returnIndex = 0;     // where the easter egg sends you back to
    this.world = null;
    this.player = null;

    this.levelTime = 0;
    this.runTime = 0;
    this.deaths = 0;
    this.runDeaths = 0;
    this.runActive = false;
    this.hold = 0;
    this.clock = 0;
    this.points = 0;
    this._jumpQueued = false;

    /** @type {Record<string, Function[]>} */
    this._handlers = Object.create(null);
    this._raf = 0;
    this._last = 0;
    this._accumulator = 0;
    this._tick = this._tick.bind(this);

    this._onResize = () => this.renderer.resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
  }

  // ------------------------------------------------------------- events

  on(event, fn) {
    (this._handlers[event] ||= []).push(fn);
    return this;
  }

  _emit(event, payload) {
    const list = this._handlers[event];
    if (list) for (const fn of list) fn(payload);
  }

  // -------------------------------------------------------------- flow

  get levelCount() { return LEVELS.length; }

  levelData(index) { return index === BONUS_INDEX ? BONUS_LEVEL : LEVELS[index]; }

  startRun(index = 0) {
    this.runTime = 0;
    this.runDeaths = 0;
    this.runActive = index === 0;
    this.loadLevel(index);
  }

  loadLevel(index) {
    const data = this.levelData(index);
    if (!data) return;
    this.levelIndex = index;
    this.world = new World(data);
    this.player = new Player(this.world);
    this.particles.clear();
    this.camera.reset();
    this.renderer.setLevelSeed(index + 2);
    this.levelTime = 0;
    this.deaths = 0;
    this.points = 0;
    this.hold = 0;
    this._jumpQueued = false;
    this.state = 'playing';
    this.input.releaseAll();

    this.camera.update(0, this.world, this.player, this.renderer.aspect);
    this._emit('level', {
      index,
      title: data.title,
      hint: data.hint,
      total: this.world.coinsTotal,
    });
    this._emitHud();
    this.start();
  }

  retry() {
    this.loadLevel(this.levelIndex);
  }

  /**
   * Death rebuilds the level exactly as the original's `LoadScene(activeScene)`
   * did: points and orbs come back, the timer restarts, the cube is plain again.
   * Anything less can soft-lock a level whose orb you already spent.
   */
  respawn() {
    this.world = new World(this.levelData(this.levelIndex));
    this.player = new Player(this.world);
    this.levelTime = 0;
    this.points = 0;
    this.hold = 0;
    this._jumpQueued = false;
    this.camera.reset();
    this.state = 'playing';
    this.particles.ring(this.player.x, this.player.y, 'rgba(194,227,255,0.8)', 14, 3);
    this._emitHud();
  }

  pause() {
    if (this.state !== 'playing') return false;
    this.state = 'paused';
    this.input.releaseAll();
    this.stop();
    return true;
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.start();
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    this._accumulator = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    if (!this._raf) return;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
  }

  // -------------------------------------------------------------- loop

  _tick(now) {
    this._raf = requestAnimationFrame(this._tick);
    let frame = (now - this._last) / 1000;
    this._last = now;
    if (!isFinite(frame) || frame < 0) frame = 0;
    frame = Math.min(frame, MAX_FRAME);

    const slow = this.input.held.slowmo ? SLOWMO : 1;
    const dt = frame * slow;
    this.clock += frame;

    if (this.state === 'playing' || this.state === 'dying' || this.state === 'cleared') {
      // A jump can be pressed on a frame too short to contain a fixed step
      // (240 Hz displays do this constantly), so hold it until a step sees it.
      if (this.input.pressed.jump) this._jumpQueued = true;

      this._accumulator += dt;
      let steps = 0;
      while (this._accumulator >= FIXED_DT && steps < 8) {
        this._fixedStep(FIXED_DT, steps === 0 && this._jumpQueued);
        if (steps === 0) this._jumpQueued = false;
        this._accumulator -= FIXED_DT;
        steps++;
      }
      if (steps === 8) this._accumulator = 0;
    }

    this.particles.update(dt);
    this.camera.update(frame, this.world, this.player, this.renderer.aspect);
    this.renderer.resize();
    this.renderer.draw(this.world, this.player, this.camera, this.particles, this.clock);
    this.input.endFrame();
  }

  /** @param {boolean} jumpPressed true on exactly one step per buffered press */
  _fixedStep(dt, jumpPressed) {
    if (this.state === 'idle' || this.state === 'paused') return;
    const world = this.world;
    const player = this.player;

    if (this.state === 'dying' || this.state === 'cleared') {
      this.hold -= dt;
      world.update(dt, null);
      if (this.hold <= 0) {
        if (this.state === 'dying') this.respawn();
        else this._finishLevel();
      }
      return;
    }

    this.levelTime += dt;
    if (this.runActive) this.runTime += dt;

    world.update(dt, player);

    const events = player.step(dt, {
      axis: this.input.axis,
      pressed: { jump: jumpPressed },
    });

    if (events.jumped) {
      this.audio.play('jump', { rate: 0.94 + Math.random() * 0.12 });
      this.particles.dust(player.x, player.y - player.half, 0.9);
    }
    if (events.landed > 0) {
      this.particles.dust(player.x, player.y - player.half, Math.min(2, events.landed / 9));
      this.camera.kick(Math.min(0.25, events.landed / 90));
    }
    if (player.boosted && player.grounded && Math.abs(player.vx) > 6) {
      this.particles.trail(player.x - player.facing * 0.3, player.y - player.half * 0.4,
        'rgba(255,150,110,0.7)');
    }

    // A plank giving way under a heavy cube is the big beat of Level 6.
    for (const s of world.solids) {
      if (s.brittle && s.gone && !s.announced) {
        s.announced = true;
        this.audio.play('death', { rate: 0.55, gain: 0.5 });
        this.camera.kick(0.55);
        this.particles.burst(s.box.x, s.box.y, '#eef8ff', 20, 6);
        this.particles.burst(s.box.x, s.box.y, '#ff9a7a', 10, 4);
      }
    }

    if (player.dead) {
      this._die();
      return;
    }

    this._triggers(dt);
  }

  _triggers(dt) {
    const world = this.world;
    const p = this.player;
    const hw = p.half;
    const hh = p.half;

    world.collectCoins(p.x, p.y, hw, hh, (coin) => {
      this.points++;
      this.audio.play('point', { rate: 1 + Math.min(6, this.points) * 0.04 });
      this.particles.burst(coin.x, coin.y, '#ffea55', 14, 5.5);
      this._emitHud();
      if (world.coinsLeft === 0 && world.goal) {
        this.particles.ring(world.goal.x, world.goal.y, '#88ff7c', 22, 5);
      }
    });

    world.collectPowerups(p.x, p.y, hw, hh, (pu) => {
      p.applyPowerup(pu.type);
      this.audio.play(pu.type);
      const color = pu.type === 'antigravity' ? '#b48bff'
        : pu.type === 'gravity' ? '#ffb15c'
        : pu.type === 'big' ? '#ff9de0'
        : pu.type === 'small' ? '#6ff2ff' : '#eef8ff';
      this.particles.ring(pu.x, pu.y, color, 20, 4.5);
      this.camera.kick(0.16);
    });

    if (!p.boosted && world.zoneAt(p.x, p.y, hw, hh, 'speed')) {
      p.boosted = true;
      this.camera.kick(0.2);
      this.particles.burst(p.x, p.y, '#ff8a5c', 16, 6);
    }

    if (this.levelIndex !== BONUS_INDEX && world.zoneAt(p.x, p.y, hw, hh, 'easteregg')) {
      this.returnIndex = Math.min(this.levelIndex + 1, LEVELS.length - 1);
      this.save.markEasterEgg();
      this.loadLevel(BONUS_INDEX);
      return;
    }
    if (this.levelIndex === BONUS_INDEX && world.zoneAt(p.x, p.y, hw, hh, 'easter_exit')) {
      this.loadLevel(this.returnIndex);
      return;
    }

    // The gate only opens once every point is collected — the original checked
    // `FindGameObjectsWithTag("point").Length == 0`.
    if (world.goal && world.coinsLeft === 0 && world.atGoal(p.x, p.y, hw, hh)) {
      this.state = 'cleared';
      this.hold = CLEAR_HOLD;
      this.particles.burst(p.x, p.y, '#88ff7c', 26, 8);
      this.camera.kick(0.3);
    }
  }

  _die() {
    this.state = 'dying';
    this.hold = DEATH_HOLD;
    this.deaths++;
    this.runDeaths++;
    this.audio.play('death');
    this.camera.kick(0.75);
    this.particles.burst(this.player.x, this.player.y, '#c2e3ff', 22, 7);
    this.particles.burst(this.player.x, this.player.y, '#ff6b7f', 12, 4);
  }

  _finishLevel() {
    const index = this.levelIndex;
    const time = this.levelTime;
    this.stop();

    if (index === BONUS_INDEX) {
      this.loadLevel(this.returnIndex);
      return;
    }

    const best = this.save.recordLevel(index, time);
    this.save.unlock(index + 1);

    const isLast = index >= LEVELS.length - 1;
    if (isLast) {
      const runTime = this.runTime;
      const bestRun = this.runActive ? this.save.recordRun(runTime) : false;
      this._emit('finish', {
        levelTime: time,
        runTime,
        fullRun: this.runActive,
        newRunBest: bestRun,
        deaths: this.runDeaths,
      });
    } else {
      this._emit('clear', {
        index,
        title: this.levelData(index).title,
        time,
        newBest: best,
        best: this.save.bestFor(index),
        deaths: this.deaths,
      });
    }
    this.state = 'idle';
  }

  nextLevel() {
    if (this.levelIndex + 1 < LEVELS.length) this.loadLevel(this.levelIndex + 1);
  }

  _emitHud() {
    this._emit('hud', {
      index: this.levelIndex,
      title: this.world.title,
      points: this.points,
      total: this.world.coinsTotal,
      deaths: this.deaths,
    });
  }

  get displayTime() { return this.levelTime; }
}
