// The rules and the computer player:  node --test test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  EMPTY, RED, BLUE, MUD, WET, newGame, play, legalMoves, isOver, score, leader, facing, foldPairs, foldChanges,
} from '../js/rules.js';
import { Engine } from '../js/ai.js';

const n = 6;
const at = (r, c) => r * n + c;
// Seeded dice for the computer. Math.imul keeps the multiply exact; a plain * loses the low bits past 2^53
// and the numbers repeat after a few hundred.
function dice(seed) {
  return () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
}
function position(cellsByIndex, turn = RED) {
  const s = newGame(n);
  for (const [i, v] of Object.entries(cellsByIndex)) s.cells[i] = v;
  s.turn = turn;
  return s;
}

test('a drop puts wet ink on a blank square and passes the turn', () => {
  const { state } = play(newGame(n), { type: 'drop', at: at(2, 3) });
  assert.equal(state.cells[at(2, 3)], RED | WET);
  assert.equal(state.turn, BLUE);
  assert.throws(() => play(state, { type: 'drop', at: at(2, 3) }), /Illegal/);
});

test('you can only fold when you have wet ink of your own', () => {
  const blueWet = position({ [at(0, 0)]: BLUE | WET }, RED);
  assert.ok(!legalMoves(blueWet).some((m) => m.type === 'fold'));
  const redWet = position({ [at(0, 0)]: RED | WET }, RED);
  assert.equal(legalMoves(redWet).filter((m) => m.type === 'fold').length, 2 * (n - 1));
});

test('squares face each other across a crease', () => {
  assert.equal(facing(n, 'v', 3, at(1, 0)), at(1, 5));
  assert.equal(facing(n, 'v', 1, at(1, 0)), at(1, 1));
  assert.equal(facing(n, 'v', 1, at(1, 3)), -1); // too far from the crease
  assert.equal(facing(n, 'h', 2, at(0, 4)), at(3, 4));
  assert.equal(foldPairs(n, 'v', 3).length, n * 3);
  assert.equal(foldPairs(n, 'v', 1).length, n);
});

test('a fold prints your wet ink onto blank paper, in both directions, then dries it', () => {
  const s = position({ [at(1, 0)]: RED | WET, [at(4, 5)]: RED | WET });
  const { state, changes } = play(s, { type: 'fold', axis: 'v', line: 3 });
  assert.equal(state.cells[at(1, 5)], RED);
  assert.equal(state.cells[at(4, 0)], RED);
  assert.equal(state.cells[at(1, 0)], RED, 'the original dries');
  assert.equal(state.cells[at(4, 5)], RED);
  assert.deepEqual(changes.map((c) => c.kind), ['print', 'print']);
});

test('your wet ink smears the other wet ink into mud, and leaves dry ink alone', () => {
  const s = position({
    [at(0, 2)]: RED | WET, [at(0, 3)]: BLUE | WET, // wet against wet: mud
    [at(1, 2)]: RED | WET, [at(1, 3)]: BLUE, // wet against dry: nothing
    [at(2, 2)]: RED | WET, [at(2, 3)]: RED, // against your own: nothing
    [at(3, 2)]: RED | WET, [at(3, 3)]: MUD, // against mud: nothing
  });
  const { state, changes } = play(s, { type: 'fold', axis: 'v', line: 3 });
  assert.equal(state.cells[at(0, 3)], MUD);
  assert.equal(state.cells[at(0, 2)], RED);
  assert.equal(state.cells[at(1, 3)], BLUE);
  assert.equal(state.cells[at(3, 3)], MUD);
  assert.equal(changes.length, 1);
});

test("the other player's wet ink doesn't print and stays wet", () => {
  const s = position({ [at(1, 0)]: BLUE | WET, [at(2, 0)]: RED | WET });
  const { state } = play(s, { type: 'fold', axis: 'v', line: 3 });
  assert.equal(state.cells[at(1, 5)], EMPTY);
  assert.equal(state.cells[at(1, 0)], BLUE | WET);
  assert.equal(state.cells[at(2, 5)], RED);
});

test('a short fold only reaches as far as its smaller side', () => {
  const s = position({ [at(0, 0)]: RED | WET, [at(0, 3)]: RED | WET });
  const changes = foldChanges(s.cells, n, 'v', 1, RED);
  assert.deepEqual(changes.map((c) => c.at), [at(0, 1)]);
});

test('the game ends when no blank paper is left, and Blue wins a tie', () => {
  const s = newGame(n);
  for (let i = 0; i < n * n; i++) s.cells[i] = i < 18 ? RED : BLUE | (i % 2 ? WET : 0);
  assert.ok(isOver(s));
  assert.deepEqual(legalMoves(s), []);
  const sc = score(s.cells);
  assert.equal(sc[RED], 18);
  assert.equal(sc[BLUE], 18);
  assert.equal(leader(s.cells), BLUE);
  s.cells[35] = RED;
  assert.equal(leader(s.cells), RED);
});

test('the computer folds first when the other side is about to smear its wet ink', () => {
  // Four wet blots each, facing each other across the middle: whoever folds there smears the other four.
  const s = position({
    [at(0, 0)]: RED | WET, [at(1, 0)]: RED | WET, [at(2, 0)]: RED | WET, [at(3, 0)]: RED | WET,
    [at(0, 5)]: BLUE | WET, [at(1, 5)]: BLUE | WET, [at(2, 5)]: BLUE | WET, [at(3, 5)]: BLUE | WET,
  });
  const { move } = new Engine(n).choose(s, 'normal', () => 0.5);
  assert.equal(move.type, 'fold');
  const { changes } = play(s, move);
  assert.ok(changes.length >= 4, `it only printed ${changes.length}`);
});

// A whole sheet, one string per row: 0 blank, 1 red, 2 blue, 3 mud, 5 wet red, 6 wet blue.
function sheet(rows, turn) {
  const s = newGame(n);
  s.cells = Uint8Array.from(rows.join(''), Number);
  s.turn = turn;
  return s;
}

test("the computer doesn't fold for nothing at the end of a game it has lost", () => {
  // One blank left, Red 16 to Blue 17, Red to move. Dropping there, or the fold that prints onto it, ends
  // the game level, and Blue wins a tie. A fold that printed nothing put the loss past what Easy could
  // see, so Easy made that fold every time and handed Blue the last blank as well.
  const oneLeft = sheet(['111231', '205111', '221131', '222222', '222211', '111222'], RED);
  // Normal did the same with two blanks left: Blue 15 to Red 19, Blue to move.
  const twoLeft = sheet(['226112', '121221', '221111', '220112', '021111', '221111'], BLUE);
  const rnd = dice(11);
  const engine = new Engine(n);
  for (const s of [oneLeft, twoLeft]) {
    for (const level of ['easy', 'normal', 'hard']) {
      for (let k = 0; k < 5; k++) {
        const { move } = engine.choose(s, level, rnd);
        if (move.type === 'fold') assert.ok(play(s, move).changes.length > 0, `${level} folded for nothing`);
      }
    }
  }
});

test('in whole games, Easy and Normal never fold for nothing', () => {
  // Before the fix, about one game in seven on Easy and one in four on Normal ended with one.
  const rnd = dice(5);
  const engine = new Engine(n);
  for (const level of ['easy', 'normal']) {
    for (let g = 0; g < 15; g++) {
      let s = newGame(n);
      while (!isOver(s)) {
        const { move } = engine.choose(s, level, rnd);
        const { state, changes } = play(s, move);
        if (move.type === 'fold') assert.ok(changes.length > 0, `${level}, game ${g + 1}: a fold for nothing at ply ${s.ply}`);
        s = state;
      }
    }
  }
});

test('Normal still beats Easy most of the time', () => {
  // Normal takes slightly worse moves on purpose. If it ever took too many, it would be no better than Easy.
  const rnd = dice(17);
  const engine = new Engine(n);
  let normalWins = 0;
  for (let g = 0; g < 20; g++) {
    for (const side of [RED, BLUE]) {
      let s = newGame(n);
      while (!isOver(s)) s = play(s, engine.choose(s, s.turn === side ? 'normal' : 'easy', rnd).move).state;
      if (leader(s.cells) === side) normalWins++;
    }
  }
  assert.ok(normalWins >= 24, `Normal beat Easy in only ${normalWins} of 40 games`);
});

test('every level plays a legal game to the end', () => {
  const rnd = dice(3);
  const engine = new Engine(n);
  for (const level of ['easy', 'normal']) {
    let s = newGame(n);
    while (!isOver(s)) s = play(s, engine.choose(s, level, rnd).move).state;
    assert.equal(s.cells.filter((v) => v === EMPTY).length, 0);
  }
});

test('the simulator plays a different game every time', () => {
  // Its dice used to repeat after a few hundred numbers: these 100 games were 45 games, some many times over.
  const sim = fileURLToPath(new URL('../tools/sim.mjs', import.meta.url));
  const out = execFileSync(process.execPath, [sim, '100', '6', 'easy', 'easy', '3']).toString();
  assert.match(out, /100 games \(100 different\)/, out);
});

test("the simulator doesn't take a misspelt player for Normal", () => {
  const sim = fileURLToPath(new URL('../tools/sim.mjs', import.meta.url));
  assert.throws(() => execFileSync(process.execPath, [sim, '1', '6', 'greedy', 'normal'], { stdio: 'pipe' }), /No player called greedy/);
});
