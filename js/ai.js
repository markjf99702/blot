// The computer player: alpha-beta search over drops and folds, deepening until its time runs out.

import { EMPTY, RED, BLUE, MUD, WET, KOMI, other, foldPairs, creases } from './rules.js';

export const LEVELS = {
  easy: { depth: 1, ms: 200, slack: 2 },
  normal: { depth: 2, ms: 600, slack: 0.5 },
  hard: { depth: 7, ms: 1500, slack: 0 },
};

// Zobrist keys over the six states a square can be in (blank, red, blue, mud, wet red, wet blue).
const STATE_INDEX = [0, 1, 2, 3, -1, 4, 5, -1];

class TimeUp extends Error {}

export class Engine {
  constructor(n) {
    this.n = n;
    this.folds = creases(n).map((f) => ({ ...f, pairs: foldPairs(n, f.axis, f.line) }));
    let seed = 0x2545f491 ^ n;
    const rnd = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return (seed >>> 0) & 0x3ffffff;
    };
    this.zLo = Int32Array.from({ length: n * n * 6 }, rnd);
    this.zHi = Int32Array.from({ length: n * n * 6 }, rnd);
    this.sideLo = rnd(); this.sideHi = rnd();
    this.tt = new Map();
  }

  hash(cells, p) {
    let lo = 0, hi = 0;
    for (let i = 0; i < cells.length; i++) {
      const s = STATE_INDEX[cells[i]];
      if (s > 0) { lo ^= this.zLo[i * 6 + s]; hi ^= this.zHi[i * 6 + s]; }
    }
    if (p === BLUE) { lo ^= this.sideLo; hi ^= this.sideHi; }
    return hi * 0x4000000 + lo;
  }

  // Squares p's fold along these pairs would change (each is worth one to p).
  gain(cells, pairs, p) {
    const w = p | WET;
    let g = 0;
    for (let k = 0; k < pairs.length; k++) {
      const a = cells[pairs[k][0]], b = cells[pairs[k][1]];
      if (a === w) { if (b === EMPTY || (b & WET && b !== w)) g++; }
      else if (b === w) { if (a === EMPTY || (a & WET)) g++; }
    }
    return g;
  }

  bestFold(cells, p) {
    let best = -1;
    for (const f of this.folds) {
      const g = this.gain(cells, f.pairs, p);
      if (g > best) best = g;
    }
    return best;
  }

  // Score from p's side, counting Blue's point.
  diff(cells, p) {
    let d = 0;
    for (let i = 0; i < cells.length; i++) {
      const k = cells[i] & 3;
      if (k === RED) d++; else if (k === BLUE) d--;
    }
    d -= KOMI;
    return p === RED ? d : -d;
  }

  // Leaf value for the side to move: the paper as it stands, plus the better of dropping or its best fold.
  evaluate(cells, p, wet) {
    let best = 0.5;
    if (wet) best = Math.max(best, this.bestFold(cells, p));
    return this.diff(cells, p) + best;
  }

  search(cells, p, depth, alpha, beta) {
    if ((++this.nodes & 1023) === 0 && performance.now() > this.deadline) throw new TimeUp();
    let empty = false, wet = false;
    const w = p | WET;
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === EMPTY) empty = true; else if (cells[i] === w) wet = true;
    }
    if (!empty) {
      const d = this.diff(cells, p);
      return d > 0 ? 100 + d : d < 0 ? -100 + d : 0;
    }
    if (depth <= 0) return this.evaluate(cells, p, wet);

    const key = this.hash(cells, p);
    const hit = this.tt.get(key);
    if (hit && hit.depth >= depth) {
      if (hit.flag === 0) return hit.value;
      if (hit.flag === 1 && hit.value >= beta) return hit.value;
      if (hit.flag === -1 && hit.value <= alpha) return hit.value;
    }

    const moves = this.ordered(cells, p, wet, hit ? hit.move : null);
    const a0 = alpha;
    let best = -Infinity, bestMove = moves[0];
    const saved = new Uint8Array(cells.length);
    for (const m of moves) {
      let v;
      if (m.type === 'drop') {
        cells[m.at] = w;
        v = -this.search(cells, other(p), depth - 1, -beta, -alpha);
        cells[m.at] = EMPTY;
      } else {
        saved.set(cells);
        applyFold(cells, m.pairs, p);
        v = -this.search(cells, other(p), depth - 1, -beta, -alpha);
        cells.set(saved);
      }
      if (v > best) { best = v; bestMove = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    if (this.tt.size > 300000) this.tt.clear();
    this.tt.set(key, { depth, value: best, flag: best <= a0 ? -1 : best >= beta ? 1 : 0, move: keyOf(bestMove) });
    return best;
  }

  ordered(cells, p, wet, first) {
    const scored = [];
    if (wet) for (const f of this.folds) scored.push([this.gain(cells, f.pairs, p) - 0.4, f]);
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== EMPTY) continue;
      cells[i] = p | WET;
      const threat = this.bestFold(cells, p);
      cells[i] = EMPTY;
      scored.push([threat * 0.3 + this.jitter[i], { type: 'drop', at: i }]);
    }
    if (first) for (const s of scored) if (keyOf(s[1]) === first) s[0] = 1e9;
    scored.sort((x, y) => y[0] - x[0]);
    return scored.map((s) => s[1]);
  }

  // Picks a move for the side to move. Returns { move, depth, value }.
  choose(state, level = 'normal', rnd = Math.random) {
    const cfg = LEVELS[level] || LEVELS.normal;
    const cells = state.cells.slice();
    const p = state.turn;
    this.jitter = Array.from({ length: cells.length }, () => rnd() * 0.2);
    this.tt.clear();
    this.nodes = 0;
    this.deadline = performance.now() + cfg.ms;
    let wet = false;
    for (let i = 0; i < cells.length; i++) if (cells[i] === (p | WET)) wet = true;
    let root = this.ordered(cells, p, wet, null);
    let scores = null, done = 0;
    for (let depth = 1; depth <= cfg.depth; depth++) {
      const next = [];
      try {
        for (const m of root) {
          if (m.type === 'drop') cells[m.at] = p | WET; else applyFold(cells, m.pairs, p);
          next.push(-this.search(cells, other(p), depth - 1, -Infinity, Infinity));
          cells.set(state.cells);
        }
      } catch (e) {
        if (!(e instanceof TimeUp)) throw e;
        cells.set(state.cells);
        if (scores) break;
        // Not even one full pass: fall back on the cheap ordering.
        scores = root.map((_, i) => -i);
        break;
      }
      const order = root.map((m, i) => [next[i], m]).sort((x, y) => y[0] - x[0]);
      root = order.map((o) => o[1]);
      scores = order.map((o) => o[0]);
      done = depth;
      if (Math.abs(scores[0]) >= 100) break; // the result is settled
    }
    const top = scores[0];
    // A weaker player picks among the near-best moves, but never a fold that changes nothing.
    let pool = root.filter((m, i) => scores[i] >= top - cfg.slack &&
      (m.type === 'drop' || i === 0 || this.gain(state.cells, m.pairs, p) > 0));
    if (!pool.length) pool = [root[0]];
    const pick = pool[Math.floor(rnd() * pool.length)] || root[0];
    const move = pick.type === 'drop' ? { type: 'drop', at: pick.at } : { type: 'fold', axis: pick.axis, line: pick.line };
    return { move, depth: done, value: top, nodes: this.nodes };
  }
}

function applyFold(cells, pairs, p) {
  const w = p | WET;
  for (let k = 0; k < pairs.length; k++) {
    const a = pairs[k][0], b = pairs[k][1];
    const va = cells[a], vb = cells[b];
    if (va === w) { if (vb === EMPTY) cells[b] = p; else if (vb & WET && vb !== w) cells[b] = MUD; }
    else if (vb === w) { if (va === EMPTY) cells[a] = p; else if (va & WET) cells[a] = MUD; }
  }
  for (let i = 0; i < cells.length; i++) if (cells[i] === w) cells[i] = p;
}

function keyOf(m) {
  return m.type === 'drop' ? 'd' + m.at : m.axis + m.line;
}
