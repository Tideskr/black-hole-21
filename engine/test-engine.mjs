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
    if (actual !== expected || board[move] !== 0) throw new Error(`WASM 对照失败：sample=${sample}, expected=${expected}, actual=${actual}, move=${move}`);
  }

  const scoreBoard = Array(21).fill(-1);
  scoreBoard[0] = 0; scoreBoard[1] = -3; scoreBoard[2] = 5;
  engine.HEAP8.set(Int8Array.from(scoreBoard), pointer);
  if (engine._score_diff(pointer) !== 2) throw new Error('C 计分符号错误');

  const certifiedTail = Array(21).fill(0);
  for (const [cell, value] of [[1,-1],[2,1],[3,-2],[4,2],[20,-3],[5,3],[21,-4],[6,4]]) certifiedTail[cell - 1] = value;
  engine.HEAP8.set(Int8Array.from(certifiedTail), pointer);
  engine._exact_best_move(pointer, -1);
  if (engine._get_last_value() !== 102) throw new Error(`已知证书残局应为先手胜 102，实际为 ${engine._get_last_value()}`);

  // 线上反馈的双人残局：后手仅有格 2/5 两种选择，格 2 可逼和，格 5 会输。
  const localDrawBoard = [-1, 0, -10, 9, 0, -9, 6, 8, -8, -7, 2, 5, 7, -6, -4, 1, 3, 4, -5, -3, -2];
  engine.HEAP8.set(Int8Array.from(localDrawBoard), pointer);
  const localBestMove = engine._exact_best_move(pointer, 1);
  if (localBestMove !== 1 || engine._get_last_value() !== 0) {
    throw new Error(`双人残局应由后手下格 2 逼和，实际 move=${localBestMove + 1}, value=${engine._get_last_value()}`);
  }
  console.log('C/WASM 引擎通过 12 个随机残局与终局符号对照。');
} finally {
  engine._free(pointer);
}
