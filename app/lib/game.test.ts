import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIRST_PLAYER, SECOND_PLAYER, NEIGHBORS, advantageIndex, certifiedMove, emptyBoard,
  nextNumber, place, recommendTrapMove, scoreBoard, shouldRecordTrend, shouldUseExactEvaluation,
  undoKeepCount, type RuntimeCertificate,
} from './game';

describe('board rules', () => {
  it('defines correct corner, edge, and center adjacency', () => {
    expect(NEIGHBORS[0]).toEqual([1, 2]);
    expect(NEIGHBORS[15]).toEqual([10, 16]);
    expect(NEIGHBORS[4]).toEqual([1, 2, 3, 5, 7, 8]);
    expect(NEIGHBORS.every((neighbors, cell) => neighbors.every((neighbor) => NEIGHBORS[neighbor].includes(cell)))).toBe(true);
  });

  it('gives both players the same number in sequence', () => {
    let board = emptyBoard();
    expect(nextNumber(board)).toBe(1);
    board = place(board, 0, FIRST_PLAYER);
    expect(nextNumber(board)).toBe(1);
    board = place(board, 1, SECOND_PLAYER);
    expect(nextNumber(board)).toBe(2);
  });

  it('awards the win to the lower neighboring sum and draws on equality', () => {
    const base = Array.from({ length: 21 }, (_, cell) => cell === 0 ? 0 : -1);
    let board = [...base]; board[1] = -3; board[2] = 5;
    expect(scoreBoard(board)).toMatchObject({ firstSum: 3, secondSum: 5, winner: FIRST_PLAYER });
    board = [...base]; board[1] = -6; board[2] = 2;
    expect(scoreBoard(board)).toMatchObject({ firstSum: 6, secondSum: 2, winner: SECOND_PLAYER });
    board = [...base]; board[1] = -4; board[2] = 4;
    expect(scoreBoard(board)).toMatchObject({ firstSum: 4, secondSum: 4, winner: 0 });
  });

  it('bounds the advantage index and exactly reflects terminal outcomes', () => {
    expect(advantageIndex(emptyBoard(), FIRST_PLAYER)).toBe(50);
    const board = Array.from({ length: 21 }, (_, cell) => cell === 0 ? 0 : -1);
    board[1] = -3;
    board[2] = 5;
    expect(advantageIndex(board, FIRST_PLAYER)).toBe(100);
    expect(advantageIndex(board, SECOND_PLAYER)).toBe(0);
  });

  it('undoes to the previous human decision against AI and one move locally', () => {
    expect(undoKeepCount(['ai', 'human', 'ai'], false, 1)).toBe(1);
    expect(undoKeepCount(['human', 'ai'], false)).toBe(0);
    expect(undoKeepCount(['player1', 'player2', 'player1'], true)).toBe(2);
  });

  it('records AI games after AI replies and local games after every move', () => {
    expect(shouldRecordTrend(false, 'human')).toBe(false);
    expect(shouldRecordTrend(false, 'ai')).toBe(true);
    expect(shouldRecordTrend(true, 'player1')).toBe(true);
    expect(shouldRecordTrend(true, 'player2')).toBe(true);
  });

  it('uses exact evaluation once a local endgame has at most 12 empty cells', () => {
    expect(shouldUseExactEvaluation(Array(21).fill(0))).toBe(false);
    expect(shouldUseExactEvaluation([...Array(8).fill(-1), ...Array(13).fill(0)])).toBe(false);
    expect(shouldUseExactEvaluation([...Array(9).fill(-1), ...Array(12).fill(0)])).toBe(true);
    expect(shouldUseExactEvaluation([...Array(20).fill(-1), 0])).toBe(false);
  });

  it('preserves outcome class before preferring branches that invite mistakes', () => {
    const recommendation = recommendTrapMove([
      { cell: 2, guaranteedValue: 0, opponentValues: [0, 0, 101] },
      { cell: 5, guaranteedValue: 0, opponentValues: [0, 102, 101] },
      { cell: 7, guaranteedValue: -101, opponentValues: [-101, 0, 102] },
    ]);
    expect(recommendation).toMatchObject({ cell: 5, guaranteedValue: 0, opponentMistakes: 2, opponentReplies: 3 });

    expect(recommendTrapMove([
      { cell: 9, guaranteedValue: 101, opponentValues: [101, 101] },
      { cell: 3, guaranteedValue: 0, opponentValues: [0, 102] },
    ])?.cell).toBe(9);

    expect(recommendTrapMove([
      { cell: 4, guaranteedValue: -101, opponentValues: [-101, -101] },
      { cell: 8, guaranteedValue: -105, opponentValues: [-105, 0] },
    ])?.cell).toBe(8);
  });
});

describe('v6 certificate', () => {
  const path = resolve(process.cwd(), 'public/generated/strategy-v6.json');
  const certificate = JSON.parse(readFileSync(path, 'utf8')) as RuntimeCertificate;

  it('covers all 20 × 18 × 16 opponent branches', () => {
    expect(Object.keys(certificate.fullResults)).toHaveLength(20);
    let mappings = 0;
    for (const branch of Object.values(certificate.fullResults)) {
      expect(Object.keys(branch.responsesByAi2)).toHaveLength(18);
      for (const response of Object.values(branch.responsesByAi2)) {
        expect(Object.keys(response.h4ByAi3)).toHaveLength(16);
        mappings += Object.keys(response.h4ByAi3).length;
      }
    }
    expect(mappings).toBe(5760);
  });

  it('places every certificate move in a legal unoccupied cell', () => {
    for (const [a1Key, branch] of Object.entries(certificate.fullResults)) {
      const a1 = Number(a1Key);
      expect(certifiedMove(certificate, new Map([[1, a1]]), 2) + 1).toBe(branch.h2);
      for (const [a2Key, response] of Object.entries(branch.responsesByAi2)) {
        const a2 = Number(a2Key);
        const prefix = new Set([1, a1, branch.h2, a2]);
        expect(prefix.has(response.h3)).toBe(false);
        for (const [a3Key, h4] of Object.entries(response.h4ByAi3)) {
          const a3 = Number(a3Key);
          expect(new Set([...prefix, response.h3, a3]).has(h4)).toBe(false);
        }
      }
    }
  });
});
