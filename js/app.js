// The page: the menu, a game in progress, the computer's turns, saving, and the how-to-play sheet.

import {
  RED, BLUE, WET, EMPTY, newGame, play, isOver, score, leader, hasWet, foldChanges,
} from './rules.js';
import { Engine } from './ai.js';
import { Board, mirrorLook } from './board.js';
import { newSeed } from './blots.js';
import { drawLogo } from './logo.js';
import { startDemos, stopDemos } from './demos.js';

const KEY = 'blot.v1';
const N = 6;
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Saving ----------

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* private window or blocked storage */ }
  return {};
}
const saved = load();
const prefs = { level: 'normal', side: RED, ...(saved.prefs || {}) };
const record = saved.record || {};
let game = saved.game && saved.game.now && saved.game.n === N ? saved.game : null;

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ prefs, record, game })); } catch { /* ignore */ }
}

// ---------- Game state ----------
// A snapshot: { cells: [...], turn, ply, history, looks, last }. `looks` holds each blot's shape.

function fresh(mode, level, human) {
  const s = newGame(N);
  return {
    mode, level, human, n: N,
    id: Date.now(),
    past: [],
    now: { cells: Array.from(s.cells), turn: s.turn, ply: 0, history: [], looks: Array(N * N).fill(null), last: -1 },
    over: false,
    recorded: false,
  };
}

const stateOf = (snap) => ({ n: N, cells: Uint8Array.from(snap.cells), turn: snap.turn, ply: snap.ply, history: snap.history });
const viewOf = (snap) => ({
  cells: snap.cells, looks: snap.looks, turn: snap.turn,
  marks: snap.history.filter((m) => m.type === 'fold'),
});

// The computer thinks in a worker when it can, and on the page when it can't.
let engine = null;
let worker = null;
let asked = 0;
const waiting = new Map();
try {
  const src = window.BLOT_WORKER_SRC;
  worker = src
    ? new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
    : new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { waiting.get(e.data.id)?.(e.data.move); waiting.delete(e.data.id); };
  worker.onerror = () => { worker = null; for (const [, done] of waiting) done(null); waiting.clear(); };
} catch { worker = null; }

async function think(snap, level) {
  const state = { n: N, cells: Array.from(snap.cells), turn: snap.turn, ply: snap.ply, history: [] };
  if (worker) {
    const id = ++asked;
    const move = await new Promise((resolve) => {
      waiting.set(id, resolve);
      worker.postMessage({ id, state, level });
    });
    if (move) return move;
  }
  engine ||= new Engine(N);
  return engine.choose({ ...state, cells: Uint8Array.from(state.cells) }, level).move;
}
let board = null;
let pending = null;   // the crease being previewed { axis, line }
let hover = null;     // a crease the mouse is over
let busy = false;     // a move is animating or the computer is thinking
let thinking = false;
let showOver = true;
let turnToken = 0;    // bumped when you leave or start a game, so a computer move still on its way is dropped

function resetTurn() {
  turnToken++;
  busy = false;
  thinking = false;
}

function isHumanTurn() {
  if (!game || game.over) return false;
  return game.mode === 'two' || game.now.turn === game.human;
}

function names() {
  if (game.mode === 'ai') {
    return game.human === RED ? { [RED]: 'You', [BLUE]: 'Computer' } : { [RED]: 'Computer', [BLUE]: 'You' };
  }
  return { [RED]: 'Red', [BLUE]: 'Blue' };
}

// ---------- Screens ----------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

function openMenu() {
  pending = null;
  hover = null;
  if (thinking) resetTurn();
  show('menu');
  $('resume').hidden = !(game && !game.over);
  paintChoices();
  paintRecord();
}

function paintChoices() {
  for (const b of $('levels').querySelectorAll('button')) b.setAttribute('aria-checked', b.dataset.level === prefs.level);
  for (const b of $('sides').querySelectorAll('button')) b.setAttribute('aria-checked', +b.dataset.side === prefs.side);
}

function paintRecord() {
  const parts = [];
  for (const lv of ['easy', 'normal', 'hard']) {
    const r = record[lv];
    if (!r) continue;
    parts.push(`${lv[0].toUpperCase() + lv.slice(1)}: ${r.w} won, ${r.l} lost`);
  }
  $('record').textContent = parts.join(' · ');
}

function startGame(mode) {
  resetTurn();
  game = mode === 'ai' ? fresh('ai', prefs.level, prefs.side) : fresh('two', null, null);
  save();
  openGame();
  // The first time, show how it works before anyone has to guess.
  let seen = true;
  try { seen = !!localStorage.getItem(KEY + '.seenRules'); } catch { /* ignore */ }
  if (!seen) openRules();
}

function openGame() {
  show('play');
  pending = null;
  hover = null;
  showOver = true;
  if (!board) {
    board = new Board($('board'), {
      n: N,
      label: 'The paper, six squares by six',
      onCell,
      onTab,
      onTabHover: (axis, line) => { hover = axis ? { axis, line } : null; paint(); },
    });
  }
  paint();
  maybeComputer();
}

// ---------- Drawing the game ----------

function foldPreview(crease, snap = game.now) {
  const changes = foldChanges(Uint8Array.from(snap.cells), N, crease.axis, crease.line, snap.turn);
  return { ...crease, changes, player: snap.turn };
}

function paint() {
  if (!game || !board) return;
  const snap = game.now;
  const human = isHumanTurn();
  const canFold = human && !busy && hasWet(snap.cells, snap.turn);
  const shown = pending || (canFold ? hover : null);
  const preview = shown && canFold ? foldPreview(shown) : null;
  board.render(viewOf(snap), { preview, canFold, locked: !human || busy, last: snap.last });

  const sc = score(snap.cells);
  const nm = names();
  $('nameRed').textContent = nm[RED];
  $('nameBlue').textContent = nm[BLUE];
  $('numRed').textContent = sc[RED];
  $('numBlue').textContent = sc[BLUE];
  const wet = (p) => snap.cells.filter((v) => v === (p | WET)).length;
  $('wetRed').textContent = wet(RED) ? `${wet(RED)} wet` : '';
  $('wetBlue').textContent = wet(BLUE) ? `${wet(BLUE)} wet` : '';
  $('scoreRed').classList.toggle('turn', !game.over && snap.turn === RED);
  $('scoreBlue').classList.toggle('turn', !game.over && snap.turn === BLUE);

  if (game.over) paintOver(sc);
  const status = $('status');
  status.classList.toggle('thinking', thinking);
  status.innerHTML = statusText(snap, preview);

  $('undo').hidden = game.over || !!pending;
  $('undo').disabled = busy || !canUndo();
  $('cancelFold').hidden = !pending;
  $('foldBtn').hidden = !pending;
  if (pending && preview) $('foldBtn').textContent = preview.changes.length ? `Fold (+${preview.changes.length})` : 'Fold';
  $('againBar').hidden = !game.over || showOver;
  $('over').hidden = !game.over || !showOver;
}

function statusText(snap, preview) {
  if (game.over) return `${$('overTitle').textContent}. No blank paper left.`;
  if (thinking) return 'The computer is thinking';
  if (busy) return '&nbsp;';
  const nm = names();
  const who = game.mode === 'two' ? `<b>${nm[snap.turn]}</b>: ` : 'Your turn: ';
  if (preview && pending) {
    const prints = preview.changes.filter((c) => c.kind === 'print').length;
    const smears = preview.changes.length - prints;
    const bits = [];
    if (prints) bits.push(`prints ${prints} ${prints === 1 ? 'square' : 'squares'}`);
    if (smears) bits.push(`smears ${smears} into mud`);
    if (!bits.length) return 'This fold prints nothing, but it dries your ink.';
    return `This fold ${bits.join(' and ')}. Tap the tab again or press Fold.`;
  }
  if (!isHumanTurn()) return '&nbsp;';
  if (!hasWet(snap.cells, snap.turn)) return `${who}drop a blot on a blank square.`;
  return `${who}drop a blot, or pick a crease to fold.`;
}

function paintOver(sc) {
  const nm = names();
  const winner = leader(game.now.cells);
  $('overTitle').textContent = game.mode === 'ai'
    ? (winner === game.human ? 'You win' : 'The computer wins')
    : `${nm[winner]} wins`;
  const tie = sc[RED] === sc[BLUE] ? ' A tie goes to Blue, for going second.' : '';
  const mud = sc.mud ? ` ${sc.mud} ${sc.mud === 1 ? 'square' : 'squares'} of mud.` : '';
  $('overLine').textContent = `Red ${sc[RED]}, Blue ${sc[BLUE]}.${tie}${mud}`;
}

// ---------- Moves ----------

function canUndo() {
  if (!game || !game.past.length) return false;
  if (game.mode === 'two') return true;
  return game.past.some((s) => s.turn === game.human);
}

function undo() {
  if (busy || !canUndo()) return;
  pending = null;
  if (game.mode === 'two') game.now = game.past.pop();
  else {
    // Back to the last position where it was your turn, before your move.
    let snap = game.past.pop();
    while (snap.turn !== game.human && game.past.length) snap = game.past.pop();
    game.now = snap;
  }
  save();
  paint();
}

function onCell(i) {
  if (!isHumanTurn() || busy) return;
  if (pending) { pending = null; paint(); return; }
  if (game.now.cells[i] !== EMPTY) return;
  move({ type: 'drop', at: i });
}

function onTab(axis, line) {
  if (!isHumanTurn() || busy || !hasWet(game.now.cells, game.now.turn)) return;
  if (pending && pending.axis === axis && pending.line === line) {
    const p = pending;
    pending = null;
    move({ type: 'fold', axis: p.axis, line: p.line });
    return;
  }
  pending = { axis, line };
  paint();
}

async function move(m) {
  const before = game.now;
  const player = before.turn;
  const { state, changes } = play(stateOf(before), m);
  const looks = before.looks.slice();
  for (const c of changes) {
    if (c.kind === 'drop') looks[c.at] = { seed: newSeed(), fx: Math.random() < 0.5, fy: Math.random() < 0.5 };
    else if (c.kind === 'mud') looks[c.at] = { seed: newSeed(), mud: true };
    else looks[c.at] = mirrorLook(before.looks[c.from] || { seed: c.from + 1 }, m.axis);
  }
  const after = {
    cells: Array.from(state.cells), turn: state.turn, ply: state.ply, history: state.history, looks,
    last: m.type === 'drop' ? m.at : -1,
  };
  const id = game.id;
  game.past.push(before);
  game.now = after;
  if (isOver(state)) game.over = true;
  save();

  busy = true;
  hover = null;
  if (m.type === 'drop') {
    paint();
    board.pop(m.at);
    await wait(200);
  } else {
    paint();
    await board.fold(m, viewOf(before), viewOf(after), player);
  }
  if (!game || game.id !== id) { paint(); return; } // a new game started while this one animated
  busy = false;
  if (game.over) finish();
  paint();
  maybeComputer();
}

function finish() {
  if (game.mode !== 'ai' || game.recorded) return;
  const r = record[game.level] || (record[game.level] = { w: 0, l: 0 });
  if (leader(game.now.cells) === game.human) r.w++; else r.l++;
  game.recorded = true;
  save();
}

async function maybeComputer() {
  if (!game || game.mode !== 'ai' || game.over || busy || game.now.turn === game.human) return;
  const token = turnToken;
  busy = true;
  thinking = true;
  paint();
  await wait(80);
  const t0 = performance.now();
  const m = await think(game.now, game.level);
  await wait(Math.max(0, 700 - (performance.now() - t0)));
  if (token !== turnToken) return;
  thinking = false;
  if (m.type === 'fold') {
    // Show where it's folding before it folds.
    board.render(viewOf(game.now), { preview: foldPreview(m), locked: true, last: -1 });
    $('status').classList.remove('thinking');
    $('status').textContent = 'The computer folds here.';
    await wait(1000);
    if (token !== turnToken) return;
  }
  busy = false;
  await move(m);
}

// ---------- Wiring ----------

$('levels').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  prefs.level = b.dataset.level;
  save();
  paintChoices();
});
$('sides').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  prefs.side = +b.dataset.side;
  save();
  paintChoices();
});
for (const group of [$('levels'), $('sides')]) {
  group.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const bs = [...group.querySelectorAll('button')];
    const i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length];
    next.focus();
    next.click();
  });
}
$('startAi').addEventListener('click', () => startGame('ai'));
$('startTwo').addEventListener('click', () => startGame('two'));
$('resume').addEventListener('click', openGame);
$('toMenu').addEventListener('click', openMenu);
$('undo').addEventListener('click', undo);
$('cancelFold').addEventListener('click', () => { pending = null; paint(); });
$('foldBtn').addEventListener('click', () => {
  if (!pending) return;
  const p = pending;
  pending = null;
  move({ type: 'fold', axis: p.axis, line: p.line });
});
function again() {
  const mode = game.mode;
  if (mode === 'ai') { prefs.level = game.level; prefs.side = game.human; }
  startGame(mode);
}
$('again').addEventListener('click', again);
$('againBar').addEventListener('click', again);
$('overMenu').addEventListener('click', openMenu);
$('overLook').addEventListener('click', () => { showOver = false; paint(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pending) { pending = null; paint(); }
});

const rules = $('rules');
function openRules() {
  rules.showModal();
  startDemos(rules);
  try { localStorage.setItem(KEY + '.seenRules', '1'); } catch { /* ignore */ }
}
rules.addEventListener('close', () => stopDemos());
rules.addEventListener('click', (e) => { if (e.target === rules) rules.close(); });
$('closeRules').addEventListener('click', () => rules.close());
$('rulesLink').addEventListener('click', openRules);
$('helpBtn').addEventListener('click', openRules);

drawLogo($('logo'));

// A test hook: lets the screenshot and test scripts set up positions.
window.blot = {
  get game() { return game; },
  load(snapshot, opts = {}) {
    resetTurn();
    game = fresh(opts.mode || 'two', opts.level || 'normal', opts.human || RED);
    Object.assign(game.now, snapshot);
    game.now.looks = game.now.cells.map((v, i) => (snapshot.looks && snapshot.looks[i]) ||
      (v ? { seed: 1000 + i * 37, fx: i % 3 === 0, fy: i % 5 === 0 } : null));
    save();
    openGame();
  },
  preview(axis, line) { pending = axis ? { axis, line } : null; paint(); },
  play: (m) => move(m),
  as(mode, human) { Object.assign(game, { mode, human, level: 'normal' }); paint(); },
  idle: () => !busy,
};

if (game && !game.over) openGame(); else openMenu();

if (!('single' in document.documentElement.dataset) && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
