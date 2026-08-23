import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FIRST_PLAYER, SECOND_PLAYER, NEIGHBORS, advantageIndex, certifiedMove, emptyBoard,
  nextNumber, place, scoreBoard, shouldRecordTrend, undoKeepCount, type RuntimeCertificate,
} from './game';

describe('棋盘规则', () => {
  it('角、边与中心的邻接关系正确', () => {
    expect(NEIGHBORS[0]).toEqual([1, 2]);
    expect(NEIGHBORS[15]).toEqual([10, 16]);
    expect(NEIGHBORS[4]).toEqual([1, 2, 3, 5, 7, 8]);
    expect(NEIGHBORS.every((neighbors, cell) => neighbors.every((neighbor) => NEIGHBORS[neighbor].includes(cell)))).toBe(true);
  });

  it('双方依次放置同一个数字', () => {
    let board = emptyBoard();
    expect(nextNumber(board)).toBe(1);
    board = place(board, 0, FIRST_PLAYER);
    expect(nextNumber(board)).toBe(1);
    board = place(board, 1, SECOND_PLAYER);
    expect(nextNumber(board)).toBe(2);
  });

  it('邻和较小者获胜，和相等时平局', () => {
    const base = Array.from({ length: 21 }, (_, cell) => cell === 0 ? 0 : -1);
    let board = [...base]; board[1] = -3; board[2] = 5;
    expect(scoreBoard(board)).toMatchObject({ firstSum: 3, secondSum: 5, winner: FIRST_PLAYER });
    board = [...base]; board[1] = -6; board[2] = 2;
    expect(scoreBoard(board)).toMatchObject({ firstSum: 6, secondSum: 2, winner: SECOND_PLAYER });
    board = [...base]; board[1] = -4; board[2] = 4;
    expect(scoreBoard(board)).toMatchObject({ firstSum: 4, secondSum: 4, winner: 0 });
  });

  it('优势指数有界，并在终局严格反映胜负方向', () => {
    expect(advantageIndex(emptyBoard(), FIRST_PLAYER)).toBe(50);
    const board = Array.from({ length: 21 }, (_, cell) => cell === 0 ? 0 : -1);
    board[1] = -3;
    board[2] = 5;
    expect(advantageIndex(board, FIRST_PLAYER)).toBeGreaterThan(50);
    expect(advantageIndex(board, SECOND_PLAYER)).toBeLessThan(50);
  });

  it('AI 对局撤回到上一个真人决策点，双人对局只撤一手', () => {
    expect(undoKeepCount(['ai', 'human', 'ai'], false, 1)).toBe(1);
    expect(undoKeepCount(['human', 'ai'], false)).toBe(0);
    expect(undoKeepCount(['player1', 'player2', 'player1'], true)).toBe(2);
  });

  it('AI 对局只在 AI 回应后记录趋势，双人对局每完整回合记录一次', () => {
    expect(shouldRecordTrend(false, 'human', FIRST_PLAYER)).toBe(false);
    expect(shouldRecordTrend(false, 'ai', SECOND_PLAYER)).toBe(true);
    expect(shouldRecordTrend(true, 'player1', FIRST_PLAYER)).toBe(false);
    expect(shouldRecordTrend(true, 'player2', SECOND_PLAYER)).toBe(true);
  });
});

describe('v6 证书', () => {
  const path = resolve(process.cwd(), 'public/generated/strategy-v6.json');
  const certificate = JSON.parse(readFileSync(path, 'utf8')) as RuntimeCertificate;

  it('完整覆盖 20 × 18 × 16 个对手分支', () => {
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

  it('每个证书着法都落在尚未占据的合法格', () => {
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
