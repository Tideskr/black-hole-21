'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FIRST_PLAYER, SECOND_PLAYER, NEIGHBORS, ROWS, advantageIndex, certifiedMove, emptyBoard,
  emptyCells, formatInteger, nextNumber, nextPlayer, outcomeLabel, place,
  scoreBoard, shouldRecordTrend, shouldUseExactEvaluation, undoKeepCount,
  type Board, type Player, type RuntimeCertificate, type ScoreResult,
} from '../lib/game';
import type { AiRequest, AiResponse } from '../workers/protocol';
import AiWorker from '../workers/ai.worker?worker';

type Mode = 'ai-first' | 'human-first' | 'local';
type MoveSource = 'certificate' | 'exact' | 'mcts' | 'human';
type MoveSide = 'ai' | 'human' | 'player1' | 'player2';
type Certainty = 'proof' | 'exact' | 'estimate';

interface MoveRecord {
  side: MoveSide;
  player: Player;
  number: number;
  cell: number;
  source: MoveSource;
  evaluation: number;
  certainty: Certainty;
}

interface TrendPoint { label: string; value: number; certainty: Certainty; }

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function perspectiveFor(mode: Mode): Player {
  return mode === 'human-first' ? SECOND_PLAYER : FIRST_PLAYER;
}

function guaranteedIndex(heuristic: number) {
  return Math.round(clamp(78 + (heuristic - 50) * 0.22, 69, 92));
}

function exactIndex(value: number, perspective: Player) {
  const oriented = perspective === FIRST_PLAYER ? value : -value;
  if (oriented === 0) return 50;
  const margin = Math.max(0, Math.abs(value) - 100);
  return oriented > 0 ? Math.min(100, 80 + margin * 2) : Math.max(0, 20 - margin * 2);
}

function replay(moves: readonly MoveRecord[]): Board {
  const board = emptyBoard();
  for (const move of moves) board[move.cell] = move.player * move.number;
  return board;
}

function trendFromMoves(moves: readonly MoveRecord[], mode: Mode): TrendPoint[] {
  const points: TrendPoint[] = [{
    label: '开局',
    value: mode === 'ai-first' ? 78 : 50,
    certainty: mode === 'ai-first' ? 'proof' : 'estimate',
  }];
  for (const move of moves) {
    if (!shouldRecordTrend(mode === 'local', move.side)) continue;
    points.push({
      label: mode === 'local' ? `${move.player === FIRST_PLAYER ? '玩家一' : '玩家二'} ${move.number}` : `AI ${move.number}`,
      value: move.evaluation,
      certainty: move.certainty,
    });
  }
  return points;
}

function initialAiGame(): { board: Board; moves: MoveRecord[] } {
  const board = place(emptyBoard(), 0, FIRST_PLAYER);
  const base = advantageIndex(board, FIRST_PLAYER);
  return {
    board,
    moves: [{
      side: 'ai', player: FIRST_PLAYER, number: 1, cell: 0, source: 'certificate',
      evaluation: guaranteedIndex(base), certainty: 'proof',
    }],
  };
}

function AdvantageChart({ points, mode, pending }: { points: TrendPoint[]; mode: Mode; pending: boolean }) {
  const width = 320;
  const height = 104;
  const current = points.at(-1) ?? { value: 50, certainty: 'estimate' as const, label: '开局' };
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
    const y = height - (point.value / 100) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const label = mode === 'local' ? '先手优势指数' : 'AI 胜势指数';
  const certainty = pending ? '评估中…' : current.certainty === 'proof' ? '策略保证' : current.certainty === 'exact' ? '精确搜索' : '局面估值';
  const cadence = mode === 'local' ? '双方每次落子后更新' : 'AI 完成回应后更新';
  const explanation = mode === 'local'
    ? '使用潜在黑洞的邻和差衡量先手压力，不是统计胜率。'
    : '搜索结果先落入胜／和／负区间，再按终局分差表示取胜难度，不是统计胜率。';

  return (
    <section className="advantage-card" aria-label={`${label} ${current.value}`}>
      <div className="advantage-heading">
        <div><span className="kicker">实时局势</span><strong>{label}</strong></div>
        <div className="advantage-number"><b>{current.value}</b><small>/100</small></div>
      </div>
      <div className="chart-wrap">
        <span className="chart-label top">胜</span>
        <span className="chart-label middle">和</span>
        <span className="chart-label bottom">负</span>
        <svg className="advantage-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}变化曲线`}>
          <line x1="0" y1="20.8" x2={width} y2="20.8" />
          <line x1="0" y1="52" x2={width} y2="52" />
          <line x1="0" y1="83.2" x2={width} y2="83.2" />
          <polyline points={coordinates} />
          {points.map((point, index) => {
            const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
            const y = height - (point.value / 100) * height;
            return <circle key={`${point.label}-${index}`} cx={x} cy={y} r={index === points.length - 1 ? 4 : 2.2} />;
          })}
        </svg>
      </div>
      <div className="chart-caption"><span className={pending ? 'pending' : ''}>{certainty}</span><span>{current.label}</span></div>
      <p>{cadence}。{explanation}</p>
    </section>
  );
}

export function BlackHoleGame() {
  const initial = initialAiGame();
  const [mode, setMode] = useState<Mode>('ai-first');
  const [board, setBoard] = useState<Board>(initial.board);
  const [moves, setMoves] = useState<MoveRecord[]>(initial.moves);
  const [trend, setTrend] = useState<TrendPoint[]>(() => trendFromMoves(initial.moves, 'ai-first'));
  const [certificate, setCertificate] = useState<RuntimeCertificate | null>(null);
  const [thinking, setThinking] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [detail, setDetail] = useState('策略证书 · 第 1 手固定在格 01');
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
    setEvaluating(false);
    setThinkingSeconds(0);
    if (selectedMode === 'ai-first') {
      const next = initialAiGame();
      setBoard(next.board);
      setMoves(next.moves);
      setTrend(trendFromMoves(next.moves, selectedMode));
      setDetail('策略证书 · 第 1 手固定在格 01');
    } else {
      setBoard(emptyBoard());
      setMoves([]);
      setTrend(trendFromMoves([], selectedMode));
      setDetail(selectedMode === 'local' ? '双人对战 · 由玩家一先手' : '实验模式 · AI 前中盘使用约 2 秒强力搜索');
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
    if (currentMode === 'local') return;
    const aiPlayer: Player = currentMode === 'ai-first' ? FIRST_PLAYER : SECOND_PLAYER;
    const number = nextNumber(position);
    setThinkingSeconds(0);
    setThinking(true);
    setDetail(number <= 4 && currentMode === 'ai-first' ? `正在查询策略证书 · 第 ${number} 手` : 'AI 正在搜索…');
    const started = performance.now();
    try {
      let move: number;
      let source: MoveSource;
      let nextDetail: string;
      let evaluation: number;
      let certainty: Certainty;
      if (currentMode === 'ai-first' && number <= 4) {
        if (!certificate) throw new Error('策略证书尚未加载完成');
        const humanMoves = new Map(history.filter((item) => item.side === 'human').map((item) => [item.number, item.cell + 1]));
        move = certifiedMove(certificate, humanMoves, number);
        source = 'certificate';
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        const previewBoard = place(position, move, aiPlayer);
        evaluation = guaranteedIndex(advantageIndex(previewBoard, aiPlayer));
        certainty = 'proof';
        nextDetail = `策略证书 · 第 ${number} 手选择格 ${String(move + 1).padStart(2, '0')}`;
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
          evaluation = exactIndex(response.value ?? 0, aiPlayer);
          certainty = 'exact';
          nextDetail = `精确搜索 · ${formatInteger(response.nodes ?? 0)} 节点 · ${formatInteger(response.cutoffs ?? 0)} 次剪枝 · ${seconds.toFixed(2)} 秒 · ${outcomeLabel(response.value ?? 0, aiPlayer)}`;
        } else {
          evaluation = Math.round(clamp(50 + (response.estimate ?? 0) * 45, 4, 96));
          certainty = 'estimate';
          nextDetail = `实验性 MCTS · ${formatInteger(response.iterations ?? 0)} 次模拟 · 估值 ${(response.estimate ?? 0).toFixed(3)} · ${seconds.toFixed(2)} 秒`;
        }
      }
      if (generationRef.current !== gameGeneration) return;
      const nextBoard = place(position, move, aiPlayer);
      if (scoreBoard(nextBoard)) evaluation = advantageIndex(nextBoard, aiPlayer);
      const nextHistory = [...history, { side: 'ai' as const, player: aiPlayer, number, cell: move, source, evaluation, certainty }];
      setBoard(nextBoard);
      setMoves(nextHistory);
      setTrend(trendFromMoves(nextHistory, currentMode));
      setDetail(nextDetail);
      setThinking(false);
      finishIfNeeded(nextBoard);
    } catch (cause) {
      if (generationRef.current !== gameGeneration) return;
      setThinking(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [askEngine, certificate, finishIfNeeded]);

  const runLocalEvaluation = useCallback(async (position: Board, history: MoveRecord[], gameGeneration: number) => {
    setEvaluating(true);
    setDetail('正在精确评估双人残局…');
    try {
      const response = await askEngine({
        kind: 'exactBestMove',
        board: position,
        player: nextPlayer(position),
      });
      if (generationRef.current !== gameGeneration) return;
      const value = response.value ?? 0;
      const evaluation = exactIndex(value, FIRST_PLAYER);
      const nextHistory = history.map((move, index) => index === history.length - 1
        ? { ...move, evaluation, certainty: 'exact' as const }
        : move);
      const outcome = value > 0 ? '完美应对下先手可胜' : value < 0 ? '完美应对下后手可胜' : '完美应对下可逼平';
      setMoves(nextHistory);
      setTrend(trendFromMoves(nextHistory, 'local'));
      setDetail(`精确残局 · ${formatInteger(response.nodes ?? 0)} 节点 · ${formatInteger(response.cutoffs ?? 0)} 次剪枝 · ${outcome}`);
      setEvaluating(false);
    } catch (cause) {
      if (generationRef.current !== gameGeneration) return;
      setEvaluating(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [askEngine]);

  const humanMove = useCallback((cell: number) => {
    if (thinking || evaluating || result || board[cell] !== 0) return;
    const currentPlayer = nextPlayer(board);
    const humanPlayer: Player = mode === 'ai-first' ? SECOND_PLAYER : FIRST_PLAYER;
    if (mode !== 'local' && currentPlayer !== humanPlayer) return;
    const number = nextNumber(board);
    const nextBoard = place(board, cell, currentPlayer);
    const perspective = perspectiveFor(mode);
    const rawEvaluation = advantageIndex(nextBoard, perspective);
    const evaluation = mode === 'ai-first' ? guaranteedIndex(rawEvaluation) : rawEvaluation;
    const side: MoveSide = mode === 'local' ? (currentPlayer === FIRST_PLAYER ? 'player1' : 'player2') : 'human';
    const certainty: Certainty = mode === 'ai-first' ? 'proof' : 'estimate';
    const nextHistory = [...moves, { side, player: currentPlayer, number, cell, source: 'human' as const, evaluation, certainty }];
    const exactLocalEvaluation = mode === 'local' && shouldUseExactEvaluation(nextBoard);
    setBoard(nextBoard);
    setMoves(nextHistory);
    if (!exactLocalEvaluation) setTrend(trendFromMoves(nextHistory, mode));
    setError(null);
    if (finishIfNeeded(nextBoard)) return;
    if (mode === 'local') {
      if (exactLocalEvaluation) void runLocalEvaluation(nextBoard, nextHistory, generationRef.current);
      return;
    }
    void runAi(nextBoard, nextHistory, generationRef.current, mode);
  }, [board, evaluating, finishIfNeeded, mode, moves, result, runAi, runLocalEvaluation, thinking]);

  const undo = useCallback(() => {
    const minimum = mode === 'ai-first' ? 1 : 0;
    if (moves.length <= minimum) return;
    generationRef.current += 1;
    restartWorker();
    const keep = undoKeepCount(moves.map((move) => move.side), mode === 'local', minimum);
    const nextMoves = moves.slice(0, keep);
    setBoard(replay(nextMoves));
    setMoves(nextMoves);
    setTrend(trendFromMoves(nextMoves, mode));
    setResult(null);
    setError(null);
    setThinking(false);
    setEvaluating(false);
    setThinkingSeconds(0);
    setDetail(mode === 'local' ? '已撤销上一手' : '已回到你的上一个决策点');
  }, [mode, moves, restartWorker]);

  const humanPlayer: Player = mode === 'ai-first' ? SECOND_PLAYER : FIRST_PLAYER;
  const scoreNeighbors = result ? new Set(NEIGHBORS[result.hole]) : new Set<number>();
  const playerName = (player: Player) => {
    if (mode === 'local') return player === FIRST_PLAYER ? '玩家一' : '玩家二';
    return player === humanPlayer ? '你' : 'AI';
  };
  const winnerText = result ? result.winner === 0 ? '平局' : `${playerName(result.winner)}获胜` : '';
  const currentPlayer = nextPlayer(board);
  const statusText = error
    ? '出现错误'
    : result
      ? winnerText
      : evaluating
        ? '正在精确评估双人残局…'
        : thinking
          ? `AI 思考中 · ${thinkingSeconds.toFixed(1)} 秒`
          : `${playerName(currentPlayer)}落子 · 数字 ${nextNumber(board)}`;
  const canPlay = mode === 'local' || currentPlayer === humanPlayer;
  const canUndo = moves.length > (mode === 'ai-first' ? 1 : 0);

  let cellIndex = 0;
  return (
    <section className="game-panel" aria-label="21 黑洞游戏">
      <div className="game-toolbar">
        <div className="mode-switch" aria-label="对局模式">
          <button className={mode === 'ai-first' ? 'selected' : ''} onClick={() => startGame('ai-first')}>AI 先手</button>
          <button className={mode === 'human-first' ? 'selected' : ''} onClick={() => startGame('human-first')}>你先手</button>
          <button className={mode === 'local' ? 'selected' : ''} onClick={() => startGame('local')}>双人</button>
        </div>
        <div className="game-actions">
          <button className="undo-game" disabled={!canUndo} onClick={undo}>撤销</button>
          <button className="new-game" onClick={() => startGame()}>重新开始</button>
        </div>
      </div>

      <div className="game-status" role="status" aria-live="polite">
        <span className={`status-dot ${thinking || evaluating ? 'thinking' : ''}`} />
        <strong>{statusText}</strong>
        <span>{mode === 'ai-first' ? 'AI 使用已证明的先手必胜策略' : mode === 'human-first' ? '实验性强力防守 · 尚无后手不败证明' : '本地双人 · 玩家一先手'}</span>
      </div>

      {error && <div className="error-box">{error}<button onClick={() => startGame()}>重试</button></div>}

      <div className="game-stage">
        <div className="board-column">
          <div className="board" aria-label="三角形棋盘">
            {ROWS.map((count) => (
              <div className="board-row" key={count}>
                {Array.from({ length: count }, () => {
                  const cell = cellIndex++;
                  const value = board[cell];
                  const isHole = result?.hole === cell;
                  const owner = value === 0 ? null : value < 0 ? FIRST_PLAYER : SECOND_PLAYER;
                  const ownerName = owner ? playerName(owner) : '';
                  const label = isHole ? '黑洞' : value === 0 ? `第 ${cell + 1} 格，空` : `${ownerName}，数字 ${Math.abs(value)}`;
                  const pieceClass = owner === FIRST_PLAYER ? 'first-piece' : owner === SECOND_PLAYER ? 'second-piece' : '';
                  return (
                    <button
                      className={`cell ${pieceClass} ${isHole ? 'hole' : ''} ${scoreNeighbors.has(cell) ? 'scored-neighbor' : ''}`}
                      key={cell}
                      aria-label={label}
                      disabled={thinking || evaluating || Boolean(result) || value !== 0 || !canPlay}
                      onClick={() => humanMove(cell)}
                    >
                      {isHole ? <span className="hole-label">黑洞</span> : value !== 0 ? <><small>{ownerName}</small>{Math.abs(value)}</> : <span>{String(cell + 1).padStart(2, '0')}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <aside className="game-rail">
          <AdvantageChart points={trend} mode={mode} pending={thinking || evaluating} />

          <section className="rules-card">
            <span className="kicker">怎么玩</span>
            <p>双方轮流把自己的 <b>1—10</b> 放入空格。最后剩下的一格成为黑洞，只统计与它相邻的数字。</p>
            <p><b>邻和较大者输</b>；相同则平局。蓝色为先手，红色为后手。</p>
          </section>

          {result ? (
            <section className="result-card">
              <span className="kicker">本局结果</span>
              <h2>{winnerText}</h2>
              <div className="score-pair">
                <div><small>{playerName(FIRST_PLAYER)}</small><strong>{result.firstSum}</strong></div>
                <span>:</span>
                <div><small>{playerName(SECOND_PLAYER)}</small><strong>{result.secondSum}</strong></div>
              </div>
              <p>黑洞位于格 {String(result.hole + 1).padStart(2, '0')}，高亮圆圈参与计分。</p>
            </section>
          ) : (
            <section className="search-card">
              <span className="kicker">最近决策</span>
              <p>{detail}</p>
            </section>
          )}

          <section className="history-card">
            <span className="kicker">落子记录</span>
            <ol>
              {moves.length === 0 && <li className="empty-history">等待第一手</li>}
              {moves.slice(-8).reverse().map((move, index) => (
                <li key={`${move.number}-${move.side}-${index}`}>
                  <span>{move.side === 'ai' ? 'AI' : move.side === 'human' ? '你' : move.side === 'player1' ? '玩家一' : '玩家二'} {move.number}</span>
                  <strong>{String(move.cell + 1).padStart(2, '0')}</strong>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </section>
  );
}
