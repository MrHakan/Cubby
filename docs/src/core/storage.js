/**
 * Progress + best times, kept in localStorage.
 *
 * Everything degrades to an in-memory object if storage is unavailable
 * (private browsing, blocked third-party storage in an iframe, and so on).
 */

const KEY = 'cubby.save.v1';

const EMPTY = { unlocked: 1, best: {}, bestRun: null, foundEasterEgg: false };

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    return {
      unlocked: Number(parsed.unlocked) || 1,
      best: parsed.best && typeof parsed.best === 'object' ? parsed.best : {},
      bestRun: typeof parsed.bestRun === 'number' ? parsed.bestRun : null,
      foundEasterEgg: !!parsed.foundEasterEgg,
    };
  } catch {
    return { ...EMPTY };
  }
}

export class Save {
  constructor() {
    this.data = read();
  }

  _flush() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage full or blocked — the session still plays fine */
    }
  }

  get unlocked() { return this.data.unlocked; }

  isUnlocked(index) { return index < this.data.unlocked; }

  unlock(index) {
    if (index + 1 > this.data.unlocked) {
      this.data.unlocked = index + 1;
      this._flush();
    }
  }

  bestFor(index) { return this.data.best[index] ?? null; }

  /** Returns true when `seconds` is a new personal best for that level. */
  recordLevel(index, seconds) {
    const prev = this.data.best[index];
    const improved = prev == null || seconds < prev;
    if (improved) {
      this.data.best[index] = seconds;
      this._flush();
    }
    return improved;
  }

  get bestRun() { return this.data.bestRun; }

  recordRun(seconds) {
    const improved = this.data.bestRun == null || seconds < this.data.bestRun;
    if (improved) {
      this.data.bestRun = seconds;
      this._flush();
    }
    return improved;
  }

  get foundEasterEgg() { return this.data.foundEasterEgg; }

  markEasterEgg() {
    if (!this.data.foundEasterEgg) {
      this.data.foundEasterEgg = true;
      this._flush();
    }
  }

  clearedCount() { return Object.keys(this.data.best).length; }

  wipe() {
    this.data = { ...EMPTY, best: {} };
    this._flush();
  }
}

export function formatTime(seconds) {
  if (seconds == null || !isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
