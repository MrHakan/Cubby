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
