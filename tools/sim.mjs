// Plays the computer against itself, or against a stand-in for a person, and prints how the games went.
// node tools/sim.mjs [games] [size] [red] [blue] [seed]
// Red and Blue are each a level (easy, normal, hard) or one of two stand-ins for a person, which are how
// the levels were checked against something other than themselves:
//   casual   folds whenever a fold changes two squares or more, and otherwise drops anywhere;
//   careful  takes what a move gains, less the best the other side can answer, plus a little for the
//            fold it sets up for itself.
import { newGame, play, isOver, score, leader, legalMoves, foldChanges, creases, hasWet, other, BLUE } from '../js/rules.js';
import { Engine } from '../js/ai.js';

const games = +(process.argv[2] || 20), n = +(process.argv[3] || 6);
const level = { 1: process.argv[4] || 'normal', 2: process.argv[5] || 'normal' };
let seed = +(process.argv[6] || 12345);
// Math.imul keeps the multiply exact. A plain * goes past 2^53 and rounds off the low bits, and then the
// numbers fall into a loop a few hundred long, so a long run kept replaying the same few dozen games.
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
const anyOf = (list) => list[Math.floor(rnd() * list.length)];

// The most squares any fold of p's would change right now.
function biggestFold(cells, p) {
  let most = 0;
  if (hasWet(cells, p)) for (const f of creases(n)) most = Math.max(most, foldChanges(cells, n, f.axis, f.line, p).length);
  return most;
}

const people = {
  casual(s) {
    let pick = null, most = 1;
    if (hasWet(s.cells, s.turn)) {
      for (const f of creases(n)) {
        const k = foldChanges(s.cells, n, f.axis, f.line, s.turn).length;
        if (k > most) { most = k; pick = f; }
      }
    }
    return pick || anyOf(legalMoves(s).filter((m) => m.type === 'drop'));
  },
  careful(s) {
    const p = s.turn;
    let best = -Infinity, pool = [];
    for (const m of legalMoves(s)) {
      const after = play(s, m).state, sc = score(after.cells), d = sc[p] - sc[other(p)];
      const v = isOver(after) ? (d > 0 || (d === 0 && p === BLUE) ? 100 : -100) + d
        : d - Math.max(1, biggestFold(after.cells, other(p))) + 0.25 * biggestFold(after.cells, p);
      if (v > best) { best = v; pool = [m]; } else if (v === best) pool.push(m);
    }
    return anyOf(pool);
  },
};

const engine = new Engine(n);
const wins = { 1: 0, 2: 0, 0: 0 }, margins = {}, different = new Set();
let plies = 0, folds = 0, changed = 0, mud = 0, slowest = 0, depth = 0, moves = 0;
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  let s = newGame(n);
  while (!isOver(s)) {
    let move;
    if (people[level[s.turn]]) move = people[level[s.turn]](s);
    else {
      const t = performance.now();
      const r = engine.choose(s, level[s.turn], rnd);
      slowest = Math.max(slowest, performance.now() - t);
      depth += r.depth; moves++;
      move = r.move;
    }
    const res = play(s, move);
    if (move.type === 'fold') { folds++; changed += res.changes.length; }
    s = res.state;
  }
  const sc = score(s.cells), d = sc[1] - sc[2];
  margins[d] = (margins[d] || 0) + 1;
  wins[leader(s.cells)]++;
  plies += s.ply; mud += sc.mud;
  different.add(s.history.map((m) => (m.type === 'drop' ? m.at : m.axis + m.line)).join());
}
console.log(`${n}x${n} red=${level[1]} blue=${level[2]}, ${games} games (${different.size} different): ` +
  `red ${wins[1]}, blue ${wins[2]} (ties go to blue, ${margins[0] || 0} of them) | ` +
  `plies ${(plies / games).toFixed(1)}, folds ${(folds / games).toFixed(1)} (avg ${(changed / Math.max(folds, 1)).toFixed(1)} squares), ` +
  `mud ${(mud / games).toFixed(1)} | depth ${(depth / Math.max(moves, 1)).toFixed(1)}, slowest ${slowest.toFixed(0)}ms, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('margins (red − blue):', Object.entries(margins).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' '));
