'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FIRST_PLAYER, SECOND_PLAYER, NEIGHBORS, ROWS, certifiedMove, emptyBoard,
  emptyCells, formatInteger, nextNumber, nextPlayer, outcomeLabel, place,
  scoreBoard, type Board, type Player, type RuntimeCertificate, type ScoreResult,
} from '../lib/game';
import type { AiRequest, AiResponse } from '../workers/protocol';
import AiWorker from '../workers/ai.worker?worker';

type Mode = 'ai-first' | 'human-first';
type MoveSource = 'certificate' | 'exact' | 'mcts' | 'human';
interface MoveRecord { side: 'ai' | 'human'; player: Player; number: number; cell: number; source: MoveSource; }

function initialAiGame(): { board: Board; moves: MoveRecord[] } {
  const board = place(emptyBoard(), 0, FIRST_PLAYER);
  return { board, moves: [{ side: 'ai', player: FIRST_PLAYER, number: 1, cell: 0, source: 'certificate' }] };
}

export function BlackHoleGame() {
  const [mode, setMode] = useState<Mode>('ai-first');
  const [board, setBoard] = useState<Board>(() => initialAiGame().board);
  const [moves, setMoves] = useState<MoveRecord[]>(() => initialAiGame().moves);
  const [certificate, setCertificate] = useState<RuntimeCertificate | null>(null);
  const [thinking, setThinking] = useState(false);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [detail, setDetail] = useState('证书 v6 · 第 1 手固定在格 01');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const generationRef = useRef(0);
  const requestRef = useRef(0);

  const createWorker = useCallback(() => {
    const worker = new AiWorker();
    workerRef.current = worker;
    return worker;
  }, []);

  useEffect(() => {
    createWorker();
    fetch('/generated/strategy-v6.json')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((data: RuntimeCertificate) => setCertificate(data))
      .catch((cause) => setError(`策略证书加载失败：${cause instanceof Error ? cause.message : String(cause)}`));
    return () => workerRef.current?.terminate();
  }, [createWorker]);

  useEffect(() => {
    if (!thinking) return;
    const started = performance.now();
    const timer = window.setInterval(() => setThinkingSeconds((performance.now() - started) / 1000), 100);
    return () => window.clearInterval(timer);
  }, [thinking]);

  const restartWorker = useCallback(() => {
    workerRef.current?.terminate();
    createWorker();
  }, [createWorker]);

  const askEngine = useCallback((request: Omit<AiRequest, 'id'>) => new Promise<AiResponse>((resolve, reject) => {
    const worker = workerRef.current ?? createWorker();
    const id = ++requestRef.current;
    const onMessage = (event: MessageEvent<AiResponse>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error ?? '搜索失败'));
    };
    const onError = (event: ErrorEvent) => { cleanup(); reject(new Error(event.message || '搜索线程异常')); };
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ ...request, id } satisfies AiRequest);
  }), [createWorker]);

  const startGame = useCallback((selectedMode: Mode = mode) => {
    generationRef.current += 1;
    restartWorker();
    setMode(selectedMode);
    setError(null);
    setResult(null);
    setThinking(false);
    if (selectedMode === 'ai-first') {
      const next = initialAiGame();
      setBoard(next.board);
      setMoves(next.moves);
      setDetail('证书 v6 · 第 1 手固定在格 01');
    } else {
      setBoard(emptyBoard());
      setMoves([]);
      setDetail('实验模式 · AI 前中盘使用约 2 秒强力搜索');
    }
  }, [mode, restartWorker]);

  const finishIfNeeded = useCallback((nextBoard: Board) => {
    const score = scoreBoard(nextBoard);
    if (!score) return false;
    setResult(score);
    setThinking(false);
    return true;
  }, []);

  const runAi = useCallback(async (position: Board, history: MoveRecord[], gameGeneration: number, currentMode: Mode) => {
    const aiPlayer: Player = currentMode === 'ai-first' ? FIRST_PLAYER : SECOND_PLAYER;
    const number = nextNumber(position);
    setThinkingSeconds(0);
    setThinking(true);
    setDetail(number <= 4 && currentMode === 'ai-first' ? `正在查询策略证书 · H${number}` : 'AI 正在搜索…');
    const started = performance.now();
    try {
      let move: number;
      let source: MoveSource;
      let nextDetail: string;
      if (currentMode === 'ai-first' && number <= 4) {
        if (!certificate) throw new Error('策略证书尚未加载完成');
        const humanMoves = new Map(history.filter((item) => item.side === 'human').map((item) => [item.number, item.cell + 1]));
        move = certifiedMove(certificate, humanMoves, number);
        source = 'certificate';
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        nextDetail = `证书 v6 · H${number} 选择格 ${String(move + 1).padStart(2, '0')}`;
      } else {
        const empty = emptyCells(position).length;
        const exact = currentMode === 'ai-first' || empty <= 10;
        const response = await askEngine({
          kind: exact ? 'exactBestMove' : 'strongBestMove',
          board: position,
          player: aiPlayer,
          budgetMs: 2000,
        });
        move = response.move!;
        source = response.engineMode === 'exact' ? 'exact' : 'mcts';
        const seconds = (performance.now() - started) / 1000;
        if (source === 'exact') {
          nextDetail = `精确搜索 · ${formatInteger(response.nodes ?? 0)} 节点 · ${formatInteger(response.cutoffs ?? 0)} 次剪枝 · ${seconds.toFixed(2)} 秒 · ${outcomeLabel(response.value ?? 0, aiPlayer)}`;
        } else {
          nextDetail = `实验性 MCTS · ${formatInteger(response.iterations ?? 0)} 次模拟 · 估值 ${(response.estimate ?? 0).toFixed(3)} · ${seconds.toFixed(2)} 秒`;
        }
      }
      if (generationRef.current !== gameGeneration) return;
      const nextBoard = place(position, move, aiPlayer);
      const nextHistory = [...history, { side: 'ai' as const, player: aiPlayer, number, cell: move, source }];
      setBoard(nextBoard);
      setMoves(nextHistory);
      setDetail(nextDetail);
      setThinking(false);
      finishIfNeeded(nextBoard);
    } catch (cause) {
      if (generationRef.current !== gameGeneration) return;
      setThinking(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [askEngine, certificate, finishIfNeeded]);

  const humanMove = useCallback((cell: number) => {
    if (thinking || result || board[cell] !== 0) return;
    const humanPlayer: Player = mode === 'ai-first' ? SECOND_PLAYER : FIRST_PLAYER;
    if (nextPlayer(board) !== humanPlayer) return;
    const number = nextNumber(board);
    const nextBoard = place(board, cell, humanPlayer);
    const nextHistory = [...moves, { side: 'human' as const, player: humanPlayer, number, cell, source: 'human' as const }];
    setBoard(nextBoard);
    setMoves(nextHistory);
    setError(null);
    if (!finishIfNeeded(nextBoard)) void runAi(nextBoard, nextHistory, generationRef.current, mode);
  }, [board, finishIfNeeded, mode, moves, result, runAi, thinking]);

  const humanPlayer: Player = mode === 'ai-first' ? SECOND_PLAYER : FIRST_PLAYER;
  const scoreNeighbors = result ? new Set(NEIGHBORS[result.hole]) : new Set<number>();
  const winnerText = result
    ? result.winner === 0 ? '平局' : result.winner === humanPlayer ? '你获胜' : 'AI 获胜'
    : '';
  const statusText = error ? '出现错误' : result ? winnerText : thinking ? `AI 思考中 · ${thinkingSeconds.toFixed(1)} 秒` : `轮到你 · 数字 ${nextNumber(board)}`;

  let cellIndex = 0;
  return (
    <section className="game-panel" aria-label="21 黑洞游戏">
      <div className="game-toolbar">
        <div className="mode-switch" aria-label="先手选择">
          <button className={mode === 'ai-first' ? 'selected' : ''} onClick={() => startGame('ai-first')}>AI 先手</button>
          <button className={mode === 'human-first' ? 'selected' : ''} onClick={() => startGame('human-first')}>你先手</button>
        </div>
        <button className="new-game" onClick={() => startGame()}>重新开始</button>
      </div>

      <div className="game-status" role="status" aria-live="polite">
        <span className={`status-dot ${thinking ? 'thinking' : ''}`} />
        <strong>{statusText}</strong>
        <span>{mode === 'ai-first' ? '已证明的先手必胜策略' : '实验性强力防守 · 尚无后手不败证明'}</span>
      </div>

      {error && <div className="error-box">{error}<button onClick={() => startGame()}>重试</button></div>}

      <div className="game-grid">
        <div className="board-wrap">
          <div className="board" aria-label="三角形棋盘">
            {ROWS.map((count) => (
              <div className="board-row" key={count}>
                {Array.from({ length: count }, () => {
                  const cell = cellIndex++;
                  const value = board[cell];
                  const isHole = result?.hole === cell;
                  const occupiedByAi = value !== 0 && Math.sign(value) === (mode === 'ai-first' ? FIRST_PLAYER : SECOND_PLAYER);
                  const label = isHole ? '黑洞' : value === 0 ? `第 ${cell + 1} 格，空` : `${occupiedByAi ? 'AI' : '你'}，数字 ${Math.abs(value)}`;
                  return (
                    <button
                      className={`cell ${value !== 0 ? occupiedByAi ? 'ai-piece' : 'human-piece' : ''} ${isHole ? 'hole' : ''} ${scoreNeighbors.has(cell) ? 'scored-neighbor' : ''}`}
                      key={cell}
                      aria-label={label}
                      disabled={thinking || Boolean(result) || value !== 0 || nextPlayer(board) !== humanPlayer}
                      onClick={() => humanMove(cell)}
                    >
                      {isHole ? <span className="hole-label">HOLE</span> : value !== 0 ? <><small>{occupiedByAi ? 'AI' : '你'}</small>{Math.abs(value)}</> : <span>{String(cell + 1).padStart(2, '0')}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <aside className="game-sidebar">
          {result ? (
            <div className="result-card">
              <span className="kicker">FINAL RESULT</span>
              <h2>{winnerText}</h2>
              <div className="score-pair">
                <div><small>你</small><strong>{humanPlayer === FIRST_PLAYER ? result.firstSum : result.secondSum}</strong></div>
                <span>:</span>
                <div><small>AI</small><strong>{humanPlayer === FIRST_PLAYER ? result.secondSum : result.firstSum}</strong></div>
              </div>
              <p>黑洞位于格 {String(result.hole + 1).padStart(2, '0')}。邻格数字之和较小者获胜。</p>
            </div>
          ) : (
            <div className="search-card">
              <span className="kicker">LAST DECISION</span>
              <p>{detail}</p>
            </div>
          )}
          <div className="history-card">
            <span className="kicker">MOVE LOG</span>
            <ol>
              {moves.slice(-8).reverse().map((move, index) => (
                <li key={`${move.number}-${move.side}-${index}`}>
                  <span>{move.side === 'ai' ? 'AI' : '你'} {move.number}</span>
                  <strong>{String(move.cell + 1).padStart(2, '0')}</strong>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </section>
  );
}
