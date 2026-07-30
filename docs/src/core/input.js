/**
 * Keyboard + touch input.
 *
 * The original read `Input.GetAxis("Horizontal")` and three separate jump keys.
 * Here the same intents are collected into a tiny state object that the player
 * polls once per fixed step, plus edge-triggered actions for menu keys.
 */

const KEY_MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  KeyR: 'restart',
  KeyV: 'slowmo',
};

/** Keys the browser would otherwise scroll the page with. */
const SWALLOW = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

export class Input {
  constructor(target = window) {
    /** Continuous state, true while the control is engaged. */
    this.held = Object.create(null);
    /** Set once on the frame a control goes down; cleared by `endFrame()`. */
    this.pressed = Object.create(null);

    this._touch = Object.create(null);
    this._listeners = [];

    this._on(target, 'keydown', (e) => {
      if (SWALLOW.has(e.code)) e.preventDefault();
      const action = KEY_MAP[e.code];
      if (!action || e.repeat) return;
      this.held[action] = true;
      this.pressed[action] = true;
    });

    this._on(target, 'keyup', (e) => {
      const action = KEY_MAP[e.code];
      if (!action) return;
      this.held[action] = false;
    });

    // Losing focus mid-jump would otherwise leave a key stuck down.
    this._on(window, 'blur', () => this.releaseAll());
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  /** Wire the on-screen pads. Multi-touch safe: each pad tracks its own id. */
  attachTouch(root) {
    for (const pad of root.querySelectorAll('[data-key]')) {
      const action = pad.dataset.key;
      const down = (e) => {
        e.preventDefault();
        pad.classList.add('held');
        if (!this._touch[action]) this.pressed[action] = true;
        this._touch[action] = true;
        this.held[action] = true;
      };
      const up = (e) => {
        e.preventDefault();
        pad.classList.remove('held');
        this._touch[action] = false;
        this.held[action] = false;
      };
      this._on(pad, 'pointerdown', down);
      this._on(pad, 'pointerup', up);
      this._on(pad, 'pointercancel', up);
      this._on(pad, 'pointerleave', up);
      this._on(pad, 'contextmenu', (e) => e.preventDefault());
    }
  }

  get axis() {
    return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
  }

  endFrame() {
    for (const k in this.pressed) this.pressed[k] = false;
  }

  releaseAll() {
    for (const k in this.held) this.held[k] = false;
    for (const k in this._touch) this._touch[k] = false;
  }

  destroy() {
    for (const [t, type, fn, opts] of this._listeners) t.removeEventListener(type, fn, opts);
    this._listeners.length = 0;
  }
}
