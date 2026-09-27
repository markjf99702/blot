// Plays the computer against itself and prints how the games went.
// node tools/sim.mjs [games] [size] [red level] [blue level] [seed]
import { newGame, play, isOver, score } from '../js/rules.js';
import { Engine } from '../js/ai.js';

const games = +(process.argv[2] || 20), n = +(process.argv[3] || 6);
const level = { 1: process.argv[4] || 'normal', 2: process.argv[5] || 'normal' };
let seed = +(process.argv[6] || 12345);
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const engine = new Engine(n);
const wins = { 1: 0, 2: 0, 0: 0 }, margins = {};
let plies = 0, folds = 0, changed = 0, mud = 0, slowest = 0, depth = 0, moves = 0;
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  let s = newGame(n);
  while (!isOver(s)) {
    const t = performance.now();
    const r = engine.choose(s, level[s.turn], rnd);
    slowest = Math.max(slowest, performance.now() - t);
    depth += r.depth; moves++;
    const res = play(s, r.move);
    if (r.move.type === 'fold') { folds++; changed += res.changes.length; }
    s = res.state;
  }
  const sc = score(s.cells), d = sc.total[1] - sc.total[2];
  margins[d] = (margins[d] || 0) + 1;
  wins[d > 0 ? 1 : d < 0 ? 2 : 0]++;
  plies += s.ply; mud += sc.mud;
}
console.log(`${n}x${n} red=${level[1]} blue=${level[2]}: red ${wins[1]}, blue ${wins[2]}, draws ${wins[0]} | ` +
  `plies ${(plies / games).toFixed(1)}, folds ${(folds / games).toFixed(1)} (avg ${(changed / Math.max(folds, 1)).toFixed(1)} squares), ` +
  `mud ${(mud / games).toFixed(1)} | depth ${(depth / moves).toFixed(1)}, slowest ${slowest.toFixed(0)}ms, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log('margins (red − blue):', Object.entries(margins).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' '));
