// Runs the computer player off the main thread, so the page keeps moving while it thinks.
import { Engine } from './ai.js';

const engines = new Map();
self.onmessage = (e) => {
  const { id, state, level } = e.data;
  let engine = engines.get(state.n);
  if (!engine) engines.set(state.n, (engine = new Engine(state.n)));
  const result = engine.choose({ ...state, cells: Uint8Array.from(state.cells) }, level);
  self.postMessage({ id, move: result.move });
};
