// The rules of Blot, with no drawing in them.
//
// The paper is an n × n grid. Each square holds one byte:
//   0 blank · 1 red · 2 blue · 3 mud, plus WET (4) on a red or blue blot that hasn't dried.
// Red moves first. On your turn you either drop a blot of your ink on a blank square, or, if you have
// wet ink, fold the paper along a crease. Folding presses each square against the one facing it across
// the crease. Your wet ink prints onto blank paper and smears the other player's wet ink into mud; dry
// ink is set and nothing changes it. Then your ink dries. When no blank paper is left, the game ends.

export const EMPTY = 0, RED = 1, BLUE = 2, MUD = 3, WET = 4;

// Blue moves second, so Blue starts a point up.
export const KOMI = 1;

export const other = (p) => 3 - p;

export function newGame(n = 6) {
  return { n, cells: new Uint8Array(n * n), turn: RED, ply: 0, history: [] };
}

// Every crease on an n × n sheet: vertical creases sit between columns (line k runs along the left
// edge of column k), horizontal ones between rows.
export function creases(n) {
  const out = [];
  for (let k = 1; k < n; k++) out.push({ type: 'fold', axis: 'v', line: k });
  for (let k = 1; k < n; k++) out.push({ type: 'fold', axis: 'h', line: k });
  return out;
}

// The squares a crease presses together, as [a, b] with a on the left or top side.
const pairCache = new Map();
export function foldPairs(n, axis, line) {
  const key = n + axis + line;
  let pairs = pairCache.get(key);
  if (pairs) return pairs;
  pairs = [];
  const reach = Math.min(line, n - line);
  for (let d = 0; d < reach; d++) {
    const a = line - 1 - d, b = line + d;
    for (let t = 0; t < n; t++) {
      if (axis === 'v') pairs.push([t * n + a, t * n + b]);
      else pairs.push([a * n + t, b * n + t]);
    }
  }
  pairCache.set(key, pairs);
  return pairs;
}

// The square facing i across a crease, or -1 if the fold doesn't reach it.
export function facing(n, axis, line, i) {
  const r = Math.floor(i / n), c = i % n;
  if (axis === 'v') {
    const m = 2 * line - 1 - c;
    return m >= 0 && m < n ? r * n + m : -1;
  }
  const m = 2 * line - 1 - r;
  return m >= 0 && m < n ? m * n + c : -1;
}

// What player p's fold does to square `to` when it is pressed against `from`.
// Returns the new ink, or -1 if nothing changes.
export function pressed(to, from, p) {
  if (from !== (p | WET)) return -1; // only the folder's wet ink prints
  const t = to & 3;
  if (t === EMPTY) return p;
  if (t === p || t === MUD) return -1;
  return to & WET ? MUD : -1; // the other ink: smeared if wet, set if dry
}

// The changes player p's fold would make, without making them: a list of
// { at, from, was, now, kind: 'print' | 'mud' }.
export function foldChanges(cells, n, axis, line, p) {
  const out = [];
  for (const [a, b] of foldPairs(n, axis, line)) {
    const na = pressed(cells[a], cells[b], p), nb = pressed(cells[b], cells[a], p);
    if (na >= 0) out.push({ at: a, from: b, was: cells[a], now: na, kind: na === MUD ? 'mud' : 'print' });
    if (nb >= 0) out.push({ at: b, from: a, was: cells[b], now: nb, kind: nb === MUD ? 'mud' : 'print' });
  }
  return out;
}

export function hasWet(cells, p) {
  for (let i = 0; i < cells.length; i++) if (cells[i] === (p | WET)) return true;
  return false;
}

export function blanks(cells) {
  let k = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === EMPTY) k++;
  return k;
}

export function isOver(state) {
  return blanks(state.cells) === 0;
}

export function legalMoves(state) {
  const { cells, n, turn } = state;
  if (isOver(state)) return [];
  const moves = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] === EMPTY) moves.push({ type: 'drop', at: i });
  if (hasWet(cells, turn)) moves.push(...creases(n));
  return moves;
}

export function isLegal(state, move) {
  if (!move || isOver(state)) return false;
  if (move.type === 'drop') {
    return Number.isInteger(move.at) && move.at >= 0 && move.at < state.cells.length &&
      state.cells[move.at] === EMPTY;
  }
  if (move.type === 'fold') {
    return hasWet(state.cells, state.turn) && (move.axis === 'v' || move.axis === 'h') &&
      Number.isInteger(move.line) && move.line >= 1 && move.line < state.n;
  }
  return false;
}

// Plays a move and returns { state, changes }. The old state is left alone.
export function play(state, move) {
  if (!isLegal(state, move)) throw new Error('Illegal move ' + JSON.stringify(move));
  const p = state.turn;
  const cells = state.cells.slice();
  let changes;
  if (move.type === 'drop') {
    cells[move.at] = p | WET;
    changes = [{ at: move.at, from: -1, was: EMPTY, now: p, kind: 'drop' }];
  } else {
    changes = foldChanges(cells, state.n, move.axis, move.line, p);
    for (const c of changes) cells[c.at] = c.now;
    for (let i = 0; i < cells.length; i++) if (cells[i] === (p | WET)) cells[i] = p; // your ink dries
  }
  const { type, at, axis, line } = move;
  const next = {
    n: state.n,
    cells,
    turn: other(p),
    ply: state.ply + 1,
    history: state.history.concat([type === 'drop' ? { type, at, by: p } : { type, axis, line, by: p }]),
  };
  return { state: next, changes };
}

// Squares each side holds, with Blue's point for going second added to `total`.
export function score(cells) {
  let r = 0, b = 0, m = 0;
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i] & 3;
    if (k === RED) r++;
    else if (k === BLUE) b++;
    else if (k === MUD) m++;
  }
  return { [RED]: r, [BLUE]: b, mud: m, total: { [RED]: r, [BLUE]: b + KOMI } };
}

// Who is ahead counting Blue's point, or 0 for level.
export function leader(cells) {
  const { total } = score(cells);
  return total[RED] > total[BLUE] ? RED : total[BLUE] > total[RED] ? BLUE : 0;
}
