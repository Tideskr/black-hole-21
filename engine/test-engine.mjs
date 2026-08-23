import createEngine from './dist/black_hole_engine.node.js';

const neighbors = [
  [1,2], [0,2,3,4], [0,1,4,5], [1,4,6,7], [1,2,3,5,7,8], [2,4,8,9],
  [3,7,10,11], [3,4,6,8,11,12], [4,5,7,9,12,13], [5,8,13,14],
  [6,11,15,16], [6,7,10,12,16,17], [7,8,11,13,17,18], [8,9,12,14,18,19],
  [9,13,19,20], [10,16], [10,11,15,17], [11,12,16,18], [12,13,17,19],
  [13,14,18,20], [14,19],
];

function terminalValue(board) {
  const hole = board.indexOf(0);
  const diff = neighbors[hole].reduce((sum, cell) => sum + board[cell], 0);
  return diff > 0 ? 100 + diff : diff < 0 ? -100 + diff : 0;
}
function minimax(board, player) {
  const empty = board.flatMap((value, cell) => value === 0 ? [cell] : []);
  if (empty.length === 1) return terminalValue(board);
  const number = Math.floor((21 - empty.length) / 2) + 1;
  const values = empty.map((cell) => {
    board[cell] = player * number;
    const value = minimax(board, -player);
    board[cell] = 0;
    return value;
  });
  return player === -1 ? Math.max(...values) : Math.min(...values);
}

const engine = await createEngine();
const pointer = engine._malloc(21);
try {
  let seed = 0x21b10c;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
  for (let sample = 0; sample < 12; sample += 1) {
    const cells = Array.from({ length: 21 }, (_, index) => index);
    for (let i = cells.length - 1; i > 0; i -= 1) { const j = random() % (i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    const board = Array(21).fill(0);
    for (let turn = 0; turn < 17; turn += 1) {
      const player = turn % 2 === 0 ? -1 : 1;
      board[cells[turn]] = player * (Math.floor(turn / 2) + 1);
    }
    const player = 1;
    const expected = minimax([...board], player);
    engine.HEAP8.set(Int8Array.from(board), pointer);
    const move = engine._exact_best_move(pointer, player);
    const actual = engine._get_last_value();
    if (actual !== expected || board[move] !== 0) throw new Error(`WASM cross-check failed: sample=${sample}, expected=${expected}, actual=${actual}, move=${move}`);
  }

  const scoreBoard = Array(21).fill(-1);
  scoreBoard[0] = 0; scoreBoard[1] = -3; scoreBoard[2] = 5;
  engine.HEAP8.set(Int8Array.from(scoreBoard), pointer);
  if (engine._score_diff(pointer) !== 2) throw new Error('C score sign is incorrect');

  const certifiedTail = Array(21).fill(0);
  for (const [cell, value] of [[1,-1],[2,1],[3,-2],[4,2],[20,-3],[5,3],[21,-4],[6,4]]) certifiedTail[cell - 1] = value;
  engine.HEAP8.set(Int8Array.from(certifiedTail), pointer);
  engine._exact_best_move(pointer, -1);
  if (engine._get_last_value() !== 102) throw new Error(`Known certificate endgame should be first-player win 102, got ${engine._get_last_value()}`);

  // Reported local endgame: the second player can draw on cell 2 but loses on 5.
  const localDrawBoard = [-1, 0, -10, 9, 0, -9, 6, 8, -8, -7, 2, 5, 7, -6, -4, 1, 3, 4, -5, -3, -2];
  engine.HEAP8.set(Int8Array.from(localDrawBoard), pointer);
  const localBestMove = engine._exact_best_move(pointer, 1);
  if (localBestMove !== 1 || engine._get_last_value() !== 0) {
    throw new Error(`Second player should force a draw on cell 2; got move=${localBestMove + 1}, value=${engine._get_last_value()}`);
  }

  const toleranceBoard = [-1, -3, 2, 3, -4, 4, 0, 0, 0, 0, -5, 0, 0, 0, 0, -2, 0, 0, 0, 5, 1];
  const toleranceCounts = { wins: 0, draws: 0, losses: 0 };
  for (let cell = 0; cell < 21; cell += 1) {
    if (toleranceBoard[cell] !== 0) continue;
    const child = [...toleranceBoard];
    child[cell] = -6;
    engine.HEAP8.set(Int8Array.from(child), pointer);
    engine._exact_best_move(pointer, 1);
    const value = engine._get_last_value();
    if (value > 0) toleranceCounts.wins += 1;
    else if (value === 0) toleranceCounts.draws += 1;
    else toleranceCounts.losses += 1;
  }
  if (toleranceCounts.wins !== 0 || toleranceCounts.draws !== 6 || toleranceCounts.losses !== 5) {
    throw new Error(`Move-tolerance regression failed: ${JSON.stringify(toleranceCounts)}`);
  }

  // Reported human-first prefix: H4=6 forces a win, while H4=2 only draws.
  const humanFirstPrefix = Array(21).fill(0);
  for (const [cell, value] of [[1,-1],[21,1],[16,-2],[20,2],[17,-3],[15,3]]) humanFirstPrefix[cell - 1] = value;
  for (const [h4, expected] of [[6, 101], [2, 0]]) {
    const child = [...humanFirstPrefix];
    child[h4 - 1] = -4;
    engine.HEAP8.set(Int8Array.from(child), pointer);
    engine._exact_best_move(pointer, 1);
    if (engine._get_last_value() !== expected) {
      throw new Error(`Human-first fourth-move regression failed: h4=${h4}, expected=${expected}, actual=${engine._get_last_value()}`);
    }
  }
  console.log('C/WASM engine passed 12 random endgame and terminal-sign cross-checks.');
} finally {
  engine._free(pointer);
}
