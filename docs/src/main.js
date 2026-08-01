/**
 * Entry point: screens, HUD, and the wiring between the DOM and the game.
 */

import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { Save, formatTime } from './core/storage.js';
import { Game, BONUS_INDEX } from './game/game.js';
import { LEVELS } from './game/levels.js';
import { EXTRA_LEVELS } from './game/extra_levels.js';

const ALL_LEVELS = [...LEVELS, ...EXTRA_LEVELS];

const $ = (sel) => document.querySelector(sel);

const canvas = $('#game');
const hud = $('#hud');
const hudLevel = $('#hud-level');
const hudPoints = $('#hud-points');
const hudTime = $('#hud-time');
const hudHint = $('#hud-hint');
const touch = $('#touch');
const pauseBtn = $('#pause-btn');

const SCREENS = {
  title: $('#screen-title'),
  levels: $('#screen-levels'),
  how: $('#screen-how'),
  pause: $('#screen-pause'),
  clear: $('#screen-clear'),
  finish: $('#screen-finish'),
};

const input = new Input();
const audio = new Audio();
const save = new Save();
const game = new Game(canvas, input, audio, save);

let current = 'title';
let previousScreen = 'title';
let hintTimer = 0;

// Hybrid laptops report coarse pointers too, so start from the device hint and
// let a real touch confirm it.
let touchControls = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', touchControls);
window.addEventListener('touchstart', () => {
  if (touchControls) return;
  touchControls = true;
  document.body.classList.add('touch');
  if (current === null) touch.hidden = false;
}, { passive: true, once: true });

// ---------------------------------------------------------------- screens

function show(name) {
  for (const [key, el] of Object.entries(SCREENS)) el.hidden = key !== name;
  const inGame = name === null;
  hud.hidden = !inGame;
  pauseBtn.hidden = !inGame;
  touch.hidden = !(inGame && touchControls);
  current = name;
  if (name === 'levels') renderLevelGrid();
  if (name === 'title') renderTitleProgress();
}

function renderTitleProgress() {
  const cleared = save.clearedCount();
  const parts = [];
  if (cleared > 0) parts.push(`${cleared}/${ALL_LEVELS.length} levels cleared`);
  if (save.bestRun != null) parts.push(`best run ${formatTime(save.bestRun)}`);
  if (save.foundEasterEgg) parts.push('easter egg found');
  $('#title-progress').textContent = parts.length ? parts.join(' · ') : 'No runs yet';
}

/** 59 levels in one flat grid is a wall, so they are grouped into chapters. */
const CHAPTERS = [
  { name: 'The Original Nine', note: 'Converted from the Unity project', from: 0, to: LEVELS.length },
  { name: 'New Ground', note: 'One new idea at a time', from: LEVELS.length, to: LEVELS.length + 13 },
  { name: 'Combinations', note: 'Two at once', from: LEVELS.length + 13, to: LEVELS.length + 30 },
  { name: 'The Long Way', note: 'Everything, tighter', from: LEVELS.length + 30, to: ALL_LEVELS.length },
];

function renderLevelGrid() {
  const host = $('#level-grid');
  host.innerHTML = '';
  for (const ch of CHAPTERS) {
    const done = Array.from({ length: ch.to - ch.from }, (_, k) => ch.from + k)
      .filter((i) => save.bestFor(i) != null).length;
    const head = document.createElement('div');
    head.className = 'chapter';
    head.innerHTML = `<h3></h3><span class="chapter-note"></span>` +
      `<span class="chapter-count">${done}/${ch.to - ch.from}</span>`;
    head.querySelector('h3').textContent = ch.name;
    head.querySelector('.chapter-note').textContent = ch.note;
    host.append(head);

    const grid = document.createElement('div');
    grid.className = 'level-grid';
    for (let i = ch.from; i < ch.to; i++) {
      const level = ALL_LEVELS[i];
      const unlocked = save.isUnlocked(i);
      const best = save.bestFor(i);
      const card = document.createElement('button');
      card.className = 'level-card' + (best != null ? ' cleared' : '');
      card.disabled = !unlocked;
      card.innerHTML =
        `<span class="num">${i + 1}</span>` +
        `<span class="name"></span>` +
        `<span class="best">${best != null ? formatTime(best) : '—'}</span>`;
      card.querySelector('.name').textContent = unlocked ? level.title : 'Locked';
      card.addEventListener('click', () => {
        audio.unlock();
        audio.sfx('select');
        show(null);
        game.startRun(i);
      });
      grid.append(card);
    }
    host.append(grid);
  }
}

// -------------------------------------------------------------------- HUD

function updateHud(info) {
  const label = info.index === BONUS_INDEX ? '???' : `Level ${info.index + 1}`;
  hudLevel.textContent = `${label} — ${info.title}`;
  hudPoints.textContent = `${info.points} / ${info.total} points`;
  if (info.deaths > 0) hudPoints.title = `${info.deaths} deaths`;
  hudPoints.classList.remove('flash');
  void hudPoints.offsetWidth; // restart the CSS animation
  if (info.points > 0) hudPoints.classList.add('flash');
}

function tickHud() {
  if (current === null && game.world) hudTime.textContent = formatTime(game.displayTime);
  if (hintTimer > 0) {
    hintTimer -= 1 / 60;
    if (hintTimer <= 0) hudHint.classList.remove('show');
  }
  requestAnimationFrame(tickHud);
}

// ------------------------------------------------------------ game events

game.on('level', (info) => {
  updateHud({ ...info, points: 0, deaths: 0 });
  hudTime.textContent = '0:00.00';
  hudHint.textContent = info.hint || '';
  if (info.hint) {
    hudHint.classList.add('show');
    hintTimer = 5;
  } else {
    hudHint.classList.remove('show');
  }
});

game.on('hud', updateHud);

game.on('clear', (info) => {
  $('#clear-title').textContent = `${info.title} clear`;
  $('#clear-time').textContent = formatTime(info.time);
  const bits = [];
  if (info.newBest) bits.push('New best time!');
  else if (info.best != null) bits.push(`Best ${formatTime(info.best)}`);
  if (info.deaths > 0) bits.push(`${info.deaths} death${info.deaths > 1 ? 's' : ''}`);
  $('#clear-best').textContent = bits.join(' · ');
  show('clear');
});

game.on('finish', (info) => {
  const label = info.fullRun ? 'Full run' : 'Final level';
  $('#finish-time').textContent = formatTime(info.fullRun ? info.runTime : info.levelTime);
  const bits = [label];
  if (info.newRunBest) bits.push('new best run!');
  else if (info.fullRun && save.bestRun != null) bits.push(`best ${formatTime(save.bestRun)}`);
  if (info.deaths > 0) bits.push(`${info.deaths} death${info.deaths > 1 ? 's' : ''}`);
  $('#finish-note').textContent = bits.join(' · ');
  show('finish');
});

// -------------------------------------------------------------- actions

const ACTIONS = {
  play() {
    const resume = save.unlocked > 1 && save.unlocked <= ALL_LEVELS.length;
    show(null);
    game.startRun(resume ? save.unlocked - 1 : 0);
  },
  levels() { show('levels'); },
  how() { previousScreen = current; show('how'); },
  back() { show(previousScreen === 'how' ? 'title' : previousScreen); },
  title() { game.stop(); show('title'); },
  pause() { if (game.pause()) { updateMuteLabel(); show('pause'); } },
  resume() { show(null); game.resume(); },
  retry() { show(null); game.retry(); },
  next() { show(null); game.nextLevel(); },
  mute() { audio.toggleMute(); updateMuteLabel(); },
  wipe() {
    if (!confirm('Erase all progress and best times?')) return;
    save.wipe();
    renderLevelGrid();
    renderTitleProgress();
  },
};

function updateMuteLabel() {
  const btn = SCREENS.pause.querySelector('[data-action="mute"]');
  if (btn) btn.textContent = `Sound: ${audio.muted ? 'off' : 'on'}`;
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (!fn) return;
  audio.unlock();
  fn();
});

// ---------------------------------------------------------- global keys

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (current === null) ACTIONS.pause();
    else if (current === 'pause') ACTIONS.resume();
    return;
  }
  if (e.code === 'KeyM') { audio.unlock(); audio.toggleMute(); updateMuteLabel(); return; }
  if (current === null && e.code === 'KeyR' && !e.repeat) { game.retry(); return; }
  if (current === 'title' && e.code === 'Enter') { audio.unlock(); ACTIONS.play(); }
});

// Pausing when the tab is hidden avoids a huge catch-up step on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && current === null) ACTIONS.pause();
});

// -------------------------------------------------------------- start up

input.attachTouch(touch);
show('title');
tickHud();

// Handy from the devtools console, and what the smoke test drives.
window.cubby = { game, save, audio, input, LEVELS: ALL_LEVELS };

// One frame of the first level renders behind the title screen so the page
// never shows an empty black box.
game.loadLevel(0);
game.stop();
game.renderer.resize();
game.renderer.draw(game.world, game.player, game.camera, game.particles, 0);
