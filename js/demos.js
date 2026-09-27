// The little moving examples in How to play. Each one sets up a 4 × 4 sheet, plays a move or two, and starts over.

import { RED, BLUE, WET, play, foldChanges } from './rules.js';
import { Board, mirrorLook } from './board.js';

const n = 4;
const W = WET;
const DEMOS = {
  drop: {
    setup: { 3: BLUE, 12: RED, 14: BLUE },
    script: [['wait', 700], ['drop', 5, RED], ['wait', 900], ['drop', 10, BLUE], ['wait', 1800]],
  },
  fold: {
    setup: { 4: RED | W, 9: RED | W, 2: BLUE, 15: BLUE | W },
    script: [['wait', 700], ['preview', 'v', 2, RED], ['wait', 1500], ['fold', 'v', 2, RED], ['wait', 2200]],
  },
  mud: {
    setup: { 1: RED | W, 2: BLUE | W, 9: RED | W, 10: BLUE, 12: RED | W },
    script: [['wait', 700], ['preview', 'v', 2, RED], ['wait', 1600], ['fold', 'v', 2, RED], ['wait', 2400]],
  },
  reach: {
    setup: { 4: RED | W, 11: RED | W, 13: BLUE },
    script: [['wait', 700], ['preview', 'v', 1, RED], ['wait', 1700], ['fold', 'v', 1, RED], ['wait', 2200]],
  },
};

let running = [];

function setupView(d) {
  const cells = Array(n * n).fill(0), looks = Array(n * n).fill(null);
  for (const [i, v] of Object.entries(d.setup)) {
    cells[i] = v;
    looks[i] = { seed: 300 + i * 13 + v, fx: i % 2 === 1, fy: false };
  }
  return { cells, looks, marks: [], turn: RED };
}

async function run(host, d, token) {
  const board = new Board(host, { n });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  while (!token.stop) {
    let view = setupView(d);
    board.render(view, {});
    for (const [what, ...args] of d.script) {
      if (token.stop) return;
      if (what === 'wait') await sleep(args[0]);
      else if (what === 'drop') {
        const [at, p] = args;
        const cells = view.cells.slice(); cells[at] = p | WET;
        const looks = view.looks.slice(); looks[at] = { seed: 500 + at, fx: false, fy: false };
        view = { ...view, cells, looks, turn: p };
        board.render(view, { last: at });
        board.pop(at);
      } else if (what === 'preview') {
        const [axis, line, p] = args;
        const changes = foldChanges(Uint8Array.from(view.cells), n, axis, line, p);
        board.render(view, { preview: { axis, line, changes, player: p } });
      } else if (what === 'fold') {
        const [axis, line, p] = args;
        const { state, changes } = play({ n, cells: Uint8Array.from(view.cells), turn: p, ply: 0, history: [] }, { type: 'fold', axis, line });
        const looks = view.looks.slice();
        for (const c of changes) looks[c.at] = c.kind === 'mud' ? { seed: 700 + c.at } : mirrorLook(view.looks[c.from], axis);
        const after = { cells: Array.from(state.cells), looks, marks: [{ axis, line }], turn: p };
        await board.fold({ axis, line }, view, after, p);
        view = after;
      }
    }
  }
}

export function startDemos(root) {
  stopDemos();
  for (const host of root.querySelectorAll('[data-demo]')) {
    const token = { stop: false };
    running.push(token);
    run(host, DEMOS[host.dataset.demo], token);
  }
}

export function stopDemos() {
  for (const t of running) t.stop = true;
  running = [];
}
