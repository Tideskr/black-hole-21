export const FIRST_PLAYER = -1 as const;
export const SECOND_PLAYER = 1 as const;
export type Player = typeof FIRST_PLAYER | typeof SECOND_PLAYER;
export type Board = number[];

export const ROWS = [1, 2, 3, 4, 5, 6] as const;
export const NEIGHBORS: readonly (readonly number[])[] = [
  [1, 2], [0, 2, 3, 4], [0, 1, 4, 5],
  [1, 4, 6, 7], [1, 2, 3, 5, 7, 8], [2, 4, 8, 9],
  [3, 7, 10, 11], [3, 4, 6, 8, 11, 12], [4, 5, 7, 9, 12, 13],
  [5, 8, 13, 14], [6, 11, 15, 16], [6, 7, 10, 12, 16, 17],
  [7, 8, 11, 13, 17, 18], [8, 9, 12, 14, 18, 19], [9, 13, 19, 20],
  [10, 16], [10, 11, 15, 17], [11, 12, 16, 18],
  [12, 13, 17, 19], [13, 14, 18, 20], [14, 19],
];

export interface RuntimeCertificate {
  strategyVersion: 6;
  sha256: string;
  h1: number;
  fullResults: Record<string, {
    h2: number;
    responsesByAi2: Record<string, {
      h3: number;
      h4ByAi3: Record<string, number>;
    }>;
  }>;
  stats: {
    ai1Branches: number;
    ai2Branches: number;
    h4Mappings: number;
    exactCalls: number;
    exactNodes: number;
    proofSeconds: number;
  };
}

export interface ScoreResult {
  hole: number;
  firstSum: number;
  secondSum: number;
  diff: number;
  winner: Player | 0;
}

export function emptyBoard(): Board { return Array(21).fill(0); }
export function placedCount(board: Board): number { return board.reduce((sum, value) => sum + Number(value !== 0), 0); }
export function nextNumber(board: Board): number { return Math.floor(placedCount(board) / 2) + 1; }
export function nextPlayer(board: Board): Player { return placedCount(board) % 2 === 0 ? FIRST_PLAYER : SECOND_PLAYER; }
export function emptyCells(board: Board): number[] { return board.flatMap((value, index) => value === 0 ? [index] : []); }

export function undoKeepCount(sides: readonly string[], localGame: boolean, minimum = 0): number {
  if (sides.length <= minimum) return minimum;
  if (localGame) return Math.max(minimum, sides.length - 1);
  const lastHuman = sides.findLastIndex((side) => side === 'human');
  return lastHuman < 0 ? minimum : Math.max(minimum, lastHuman);
}

export function shouldRecordTrend(localGame: boolean, side: string): boolean {
  return localGame || side === 'ai';
}

export function shouldUseExactEvaluation(board: Board): boolean {
  const remaining = emptyCells(board).length;
  return remaining > 1 && remaining <= 10;
}

export function place(board: Board, cell: number, player: Player): Board {
  if (cell < 0 || cell >= 21 || board[cell] !== 0) throw new Error(`格 ${cell + 1} 不能落子`);
  const result = [...board];
  result[cell] = player * nextNumber(board);
  return result;
}

export function scoreBoard(board: Board): ScoreResult | null {
  const empty = emptyCells(board);
  if (empty.length !== 1) return null;
  const hole = empty[0];
  let firstSum = 0;
  let secondSum = 0;
  for (const neighbor of NEIGHBORS[hole]) {
    const value = board[neighbor];
    if (value < 0) firstSum += -value;
    if (value > 0) secondSum += value;
  }
  const diff = secondSum - firstSum;
  return {
    hole,
    firstSum,
    secondSum,
    diff,
    winner: diff > 0 ? FIRST_PLAYER : diff < 0 ? SECOND_PLAYER : 0,
  };
}

/**
 * 把局面压缩成 0–100 的“优势指数”。它不是胜率：终局使用真实结果，
 * 未搜索局面则衡量所有潜在黑洞周围已经形成的邻和差，并按完成度收缩。
 */
export function advantageIndex(board: Board, perspective: Player): number {
  const terminal = scoreBoard(board);
  if (terminal) {
    if (terminal.winner === 0) return 50;
    const margin = Math.abs(terminal.diff);
    return terminal.winner === perspective ? Math.min(100, 82 + margin * 2) : Math.max(0, 18 - margin * 2);
  }

  const empties = emptyCells(board);
  const placed = placedCount(board);
  const completion = placed / 20;
  let weighted = 0;
  let weights = 0;
  for (const hole of empties) {
    let firstSum = 0;
    let secondSum = 0;
    let occupiedNeighbors = 0;
    for (const neighbor of NEIGHBORS[hole]) {
      const value = board[neighbor];
      if (value < 0) firstSum += -value;
      if (value > 0) secondSum += value;
      if (value !== 0) occupiedNeighbors += 1;
    }
    const firstAdvantage = secondSum - firstSum;
    const oriented = perspective === FIRST_PLAYER ? firstAdvantage : -firstAdvantage;
    const density = occupiedNeighbors / NEIGHBORS[hole].length;
    const weight = 0.35 + density;
    weighted += Math.tanh(oriented / 8) * weight;
    weights += weight;
  }
  const signal = weights ? weighted / weights : 0;
  return Math.round(Math.max(4, Math.min(96, 50 + signal * (18 + completion * 28))));
}

export function outcomeLabel(value: number, aiPlayer: Player): string {
  if (value === 0) return '完美应对下可保和';
  const firstWins = value > 0;
  const aiWins = firstWins === (aiPlayer === FIRST_PLAYER);
  return aiWins ? '完美应对下 AI 可胜' : '此时已无法避免落败';
}

export function certifiedMove(certificate: RuntimeCertificate, humanMoves: ReadonlyMap<number, number>, aiNumber: number): number {
  if (aiNumber === 1) return certificate.h1 - 1;
  const a1 = humanMoves.get(1);
  if (!a1) throw new Error('证书查询缺少对手第 1 手');
  const branch = certificate.fullResults[String(a1)];
  if (!branch) throw new Error(`证书中没有 A1=${a1}`);
  if (aiNumber === 2) return branch.h2 - 1;
  const a2 = humanMoves.get(2);
  if (!a2) throw new Error('证书查询缺少对手第 2 手');
  const response = branch.responsesByAi2[String(a2)];
  if (!response) throw new Error(`证书中没有 A1=${a1}, A2=${a2}`);
  if (aiNumber === 3) return response.h3 - 1;
  const a3 = humanMoves.get(3);
  if (!a3) throw new Error('证书查询缺少对手第 3 手');
  const h4 = response.h4ByAi3[String(a3)];
  if (!h4) throw new Error(`证书中没有 A1=${a1}, A2=${a2}, A3=${a3}`);
  if (aiNumber === 4) return h4 - 1;
  throw new Error('证书只定义第 1–4 手');
}

export function formatInteger(value: number): string { return new Intl.NumberFormat('zh-CN').format(Math.round(value)); }
