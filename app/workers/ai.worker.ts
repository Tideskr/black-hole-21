/// <reference lib="webworker" />

import createEngine, { type BlackHoleModule } from '../../engine/dist/black_hole_engine.js';
import type { AiRequest, AiResponse } from './protocol';

let enginePromise: Promise<BlackHoleModule> | null = null;

function getEngine() {
  enginePromise ??= createEngine().then((engine) => {
    engine._set_random_seed((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0);
    return engine;
  });
  return enginePromise;
}

self.onmessage = async (event: MessageEvent<AiRequest>) => {
  const request = event.data;
  const response: AiResponse = { id: request.id, ok: false };
  try {
    const engine = await getEngine();
    const pointer = engine._malloc(21);
    try {
      engine.HEAP8.set(Int8Array.from(request.board), pointer);
      const exact = request.kind === 'exactBestMove' || request.board.filter((value) => value === 0).length <= 10;
      const move = exact
        ? engine._exact_best_move(pointer, request.player)
        : engine._strong_best_move(pointer, request.player, request.budgetMs ?? 2000);
      if (move < 0 || move >= 21 || request.board[move] !== 0) throw new Error('The search engine returned an illegal move');
      Object.assign(response, {
        ok: true,
        move,
        value: engine._get_last_value(),
        nodes: engine._get_last_nodes(),
        cutoffs: engine._get_last_cutoffs(),
        iterations: engine._get_last_iterations(),
        estimate: engine._get_last_estimate(),
        engineMode: exact ? 'exact' : 'mcts',
      });
    } finally {
      engine._free(pointer);
    }
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }
  self.postMessage(response);
};

export {};
