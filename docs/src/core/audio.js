/**
 * Sound effects.
 *
 * The clips are the original project's .wav files. They are decoded once into
 * an AudioContext so that overlapping plays (a run of points, a chain of jumps)
 * don't fight over a single <audio> element the way the Unity build's
 * AudioSources effectively did.
 */

const CLIPS = {
  jump: 'assets/audio/jump.wav',
  point: 'assets/audio/pickupCoin.wav',
  death: 'assets/audio/Death.wav',
  small: 'assets/audio/smallPowerup.wav',
  normal: 'assets/audio/normalPowerup.wav',
  big: 'assets/audio/bigPowerup.wav',
  antigravity: 'assets/audio/noGravity.wav',
  gravity: 'assets/audio/Gravity.wav',
};

const GAIN = {
  jump: 0.32, point: 0.45, death: 0.5,
  small: 0.4, normal: 0.4, big: 0.4,
  antigravity: 0.4, gravity: 0.4,
};

const STORAGE_KEY = 'cubby.muted';

export class Audio {
  constructor() {
    this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    this.ctx = null;
    this.master = null;
    this.buffers = Object.create(null);
    this._loading = null;
  }

  /**
   * Browsers only allow audio after a gesture, so this is called from the
   * first click/keypress rather than at start-up.
   */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this._loading;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return Promise.resolve();
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(this.ctx.destination);
    this._loading = Promise.all(
      Object.entries(CLIPS).map(async ([name, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(res.status);
          this.buffers[name] = await this.ctx.decodeAudioData(await res.arrayBuffer());
        } catch {
          // A missing clip should never take the game down with it.
          this.buffers[name] = null;
        }
      })
    );
    return this._loading;
  }

  /**
   * Synthesised one-shots for the mechanics the original never had, so the new
   * levels get their own voice without shipping more audio files.
   *
   * @param {object} spec
   * @param {'sine'|'square'|'sawtooth'|'triangle'} spec.wave
   * @param {number} spec.from   starting frequency in Hz
   * @param {number} spec.to     ending frequency in Hz
   * @param {number} spec.dur    seconds
   * @param {number} spec.gain   peak gain
   */
  tone({ wave = 'square', from = 440, to = 440, dur = 0.12, gain = 0.2, delay = 0 }) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    const env = this.ctx.createGain();
    // Fast attack, exponential tail — reads as a chiptune blip.
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Filtered noise burst, for crumbling and landings. */
  noise({ dur = 0.18, gain = 0.18, from = 1800, to = 200, delay = 0 } = {}) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t0);
  }

  /** Named synthesised effects. */
  sfx(name) {
    switch (name) {
      case 'spring':
        this.tone({ wave: 'square', from: 320, to: 1180, dur: 0.16, gain: 0.22 });
        this.tone({ wave: 'sine', from: 640, to: 2200, dur: 0.14, gain: 0.1, delay: 0.01 });
        break;
      case 'crumble':
        this.noise({ dur: 0.3, gain: 0.2, from: 1400, to: 120 });
        this.tone({ wave: 'triangle', from: 220, to: 60, dur: 0.28, gain: 0.12 });
        break;
      case 'spike':
        this.tone({ wave: 'sawtooth', from: 380, to: 70, dur: 0.3, gain: 0.24 });
        this.noise({ dur: 0.2, gain: 0.16, from: 3000, to: 400 });
        break;
      case 'blink':
        this.tone({ wave: 'sine', from: 900, to: 1500, dur: 0.07, gain: 0.06 });
        break;
      case 'unlock':
        [523, 659, 784, 1047].forEach((f, i) =>
          this.tone({ wave: 'square', from: f, to: f, dur: 0.13, gain: 0.13, delay: i * 0.07 }));
        break;
      case 'clear':
        [659, 784, 988, 1319].forEach((f, i) =>
          this.tone({ wave: 'square', from: f, to: f * 1.01, dur: 0.2, gain: 0.16, delay: i * 0.09 }));
        break;
      case 'select':
        this.tone({ wave: 'square', from: 880, to: 1320, dur: 0.06, gain: 0.08 });
        break;
      default:
        break;
    }
  }

  play(name, { rate = 1, gain = 1 } = {}) {
    if (this.muted || !this.ctx) return;
    const buffer = this.buffers[name];
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const vol = this.ctx.createGain();
    vol.gain.value = (GAIN[name] ?? 0.4) * gain;
    src.connect(vol).connect(this.master);
    src.start();
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.01);
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }
}
