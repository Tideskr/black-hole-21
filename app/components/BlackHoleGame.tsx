'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FIRST_PLAYER, SECOND_PLAYER, NEIGHBORS, ROWS, advantageIndex, certifiedMove, emptyBoard,
  emptyCells, formatInteger, nextNumber, nextPlayer, outcomeCode, place,
  recommendTrapMove, scoreBoard, shouldRecordTrend, shouldUseExactEvaluation, undoKeepCount,
  type Board, type Player, type RuntimeCertificate, type ScoreResult,
} from '../lib/game';
import type { AiRequest, AiResponse } from '../workers/protocol';
import AiWorker from '../workers/ai.worker?worker';
import { useI18n, type TranslationKey, type Translator } from '../i18n';

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
  analysis?: MoveAnalysis;
}

interface TrendPoint { label: string; value: number; certainty: Certainty; }
interface OpeningHint { cell: number; source: 'certificate' | 'exact' | 'mcts'; iterations: number; estimate: number; value: number; }
interface UiMessage {
  key: TranslationKey;
  variables?: Record<string, string | number>;
  nested?: Record<string, TranslationKey>;
}
interface MoveAnalysis {
  wins: number;
  draws: number;
  losses: number;
  total: number;
  bestFirstValue: number;
  recommendedCell: number;
  recommendationValue: number;
  opponentMistakes: number;
  opponentReplies: number;
  nodes: number;
  cutoffs: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function renderUiMessage(message: UiMessage, t: Translator) {
  const variables = { ...message.variables };
  for (const [name, key] of Object.entries(message.nested ?? {})) variables[name] = t(key);
  return t(message.key, variables);
}

function perspectiveFor(mode: Mode): Player {
  return mode === 'human-first' ? SECOND_PLAYER : FIRST_PLAYER;
}

function exactIndex(value: number, perspective: Player) {
  const oriented = perspective === FIRST_PLAYER ? value : -value;
  return oriented > 0 ? 100 : oriented < 0 ? 0 : 50;
}

function terminalValue(score: ScoreResult) {
  return score.diff > 0 ? 100 + score.diff : score.diff < 0 ? -100 + score.diff : 0;
}

function replay(moves: readonly MoveRecord[]): Board {
  const board = emptyBoard();
  for (const move of moves) board[move.cell] = move.player * move.number;
  return board;
}

function trendFromMoves(moves: readonly MoveRecord[], mode: Mode): TrendPoint[] {
  const points: TrendPoint[] = [{
    label: 'Opening',
    value: 100,
    certainty: 'proof',
  }];
  for (const move of moves) {
    if (!shouldRecordTrend(mode === 'local', move.side)) continue;
    points.push({
      label: mode === 'local' ? `${move.player === FIRST_PLAYER ? 'Player one' : 'Player two'} ${move.number}` : `AI ${move.number}`,
      value: move.evaluation,
      certainty: move.certainty,
    });
  }
  return points;
}

function certifiedPrefixIntact(certificate: RuntimeCertificate, moves: readonly MoveRecord[]) {
  const firstMoves = moves.filter((move) => move.player === FIRST_PLAYER).sort((left, right) => left.number - right.number);
  if (firstMoves.some((move) => move.number > 4)) return false;
  const opponentMoves = new Map(moves
    .filter((move) => move.player === SECOND_PLAYER)
    .map((move) => [move.number, move.cell + 1]));
  try {
    return firstMoves.every((move) => certifiedMove(certificate, opponentMoves, move.number) === move.cell);
  } catch {
    return false;
  }
}

function initialAiGame(): { board: Board; moves: MoveRecord[] } {
  const board = place(emptyBoard(), 0, FIRST_PLAYER);
  return {
    board,
    moves: [{
      side: 'ai', player: FIRST_PLAYER, number: 1, cell: 0, source: 'certificate',
      evaluation: 100, certainty: 'proof',
    }],
  };
}

function AdvantageChart({
  points, mode, pending, analysis, analysisPlayer, hintVisible, openingHint, hintComputing, certifiedWin,
}: {
  points: TrendPoint[];
  mode: Mode;
  pending: boolean;
  analysis: MoveAnalysis | null;
  analysisPlayer: string;
  hintVisible: boolean;
  openingHint: OpeningHint | null;
  hintComputing: boolean;
  certifiedWin: boolean;
}) {
  const { locale, t } = useI18n();
  const current = points.at(-1) ?? { value: 50, certainty: 'estimate' as const, label: 'Opening' };
  const firstPlayerValue = mode === 'human-first' ? 100 - current.value : current.value;
  const certainty = certifiedWin ? t('situation.proof') : pending ? t('situation.pending') : current.certainty === 'proof' ? t('situation.proof') : current.certainty === 'exact' ? t('situation.exact') : t('situation.estimate');
  const situation = certifiedWin
    ? t('situation.firstWins')
    : pending
    ? t('situation.calculating')
    : current.certainty === 'estimate'
      ? firstPlayerValue > 57 ? t('situation.estimateFirst') : firstPlayerValue < 43 ? t('situation.estimateSecond') : t('situation.estimateEven')
      : firstPlayerValue > 50 ? t('situation.firstWins') : firstPlayerValue < 50 ? t('situation.firstLoses') : t('situation.firstDraws');
  const safeMoves = analysis ? analysis.wins + analysis.draws : 0;
  const safetyRate = analysis ? Math.round((safeMoves / analysis.total) * 100) : null;
  const aiMargin = analysis && analysis.bestFirstValue > 0 ? Math.max(0, analysis.bestFirstValue - 100) : null;
  const recommendationOutcome = analysis
    ? analysis.recommendationValue > 0 ? t('hint.forceWin') : analysis.recommendationValue === 0 ? t('hint.forceDraw') : t('hint.lossInevitable')
    : '';

  return (
    <section className="advantage-card" aria-label={situation}>
      <div className="situation-summary">
        <span className="kicker">{t('situation.label', { certainty })}</span>
        <strong>{situation}</strong>
      </div>
      {analysis && mode === 'ai-first' && aiMargin !== null && (
        <div className="tolerance-card margin-card">
          <div className="tolerance-heading">
            <div><span className="kicker">{t('analysis.margin')}</span><strong>{t('analysis.perfectDefense')}</strong></div>
            <b>{aiMargin}<small>{t('analysis.points')}</small></b>
          </div>
          <p>{t('analysis.marginBody', { margin: aiMargin })}</p>
        </div>
      )}
      {analysis && mode !== 'ai-first' && safetyRate !== null && (
        <div className="tolerance-card">
          <div className="tolerance-heading">
            <div><span className="kicker">{t('analysis.safeRate')}</span><strong>{analysisPlayer}</strong></div>
            <b>{safetyRate}<small>%</small></b>
          </div>
          <div className="outcome-bar" aria-label={t('analysis.outcomesAria', { wins: analysis.wins, draws: analysis.draws, losses: analysis.losses })}>
            <span className="wins" style={{ width: `${analysis.wins / analysis.total * 100}%` }} />
            <span className="draws" style={{ width: `${analysis.draws / analysis.total * 100}%` }} />
            <span className="losses" style={{ width: `${analysis.losses / analysis.total * 100}%` }} />
          </div>
          <div className="outcome-counts">
            <span><i className="win-dot" />{t('analysis.winShort', { count: analysis.wins })}</span>
            <span><i className="draw-dot" />{t('analysis.drawShort', { count: analysis.draws })}</span>
            <span><i className="loss-dot" />{t('analysis.lossShort', { count: analysis.losses })}</span>
          </div>
          <p>{t('analysis.safeBody', { safe: safeMoves, total: analysis.total })}</p>
        </div>
      )}
      {hintVisible && analysis && (
        <div className="recommendation-card">
          <div>
            <span className="kicker">{t('hint.bestMove')}</span>
            <strong>{t('hint.cell', { cell: String(analysis.recommendedCell + 1).padStart(2, '0') })}</strong>
          </div>
          <span className={`outcome-pill ${analysis.recommendationValue > 0 ? 'winning' : analysis.recommendationValue === 0 ? 'drawing' : 'losing'}`}>{recommendationOutcome}</span>
          <p>{analysis.opponentReplies > 0
            ? t('hint.mistakes', { mistakes: analysis.opponentMistakes, replies: analysis.opponentReplies })
            : t('hint.lastMove')}</p>
        </div>
      )}
      {hintVisible && !analysis && openingHint && (
        <div className={`recommendation-card ${openingHint.source === 'mcts' ? 'estimated-recommendation' : ''}`}>
          <div>
            <span className="kicker">{openingHint.source === 'certificate' ? t('hint.proven') : openingHint.source === 'exact' ? t('hint.exact') : t('hint.opening')}</span>
            <strong>{t('hint.cell', { cell: String(openingHint.cell + 1).padStart(2, '0') })}</strong>
          </div>
          <span className={`outcome-pill ${openingHint.source === 'mcts' || openingHint.value === 0 ? 'drawing' : openingHint.value > 0 ? 'winning' : 'losing'}`}>{openingHint.source === 'certificate' ? t('hint.strategyGuarantee') : openingHint.source === 'exact' ? openingHint.value > 0 ? t('hint.forceWin') : openingHint.value === 0 ? t('hint.forceDraw') : t('hint.lossInevitable') : t('hint.strongEstimate')}</span>
          <p>{openingHint.source === 'certificate'
            ? t('hint.certificateBody')
            : openingHint.source === 'exact'
              ? t(openingHint.value > 0 ? 'hint.exactBodyWin' : openingHint.value === 0 ? 'hint.exactBodyDraw' : 'hint.exactBodyLoss', { value: openingHint.value })
              : t('hint.mctsBody', { iterations: formatInteger(openingHint.iterations, locale), estimate: openingHint.estimate.toFixed(3) })}</p>
        </div>
      )}
      {hintVisible && !analysis && !openingHint && hintComputing && (
        <div className="recommendation-card estimated-recommendation pending-recommendation">
          <div><span className="kicker">{t('hint.opening')}</span><strong>{t('hint.computing')}</strong></div>
          <p>{t('hint.computingBody')}</p>
        </div>
      )}
    </section>
  );
}

export function BlackHoleGame() {
  const { locale, t } = useI18n();
  const initial = initialAiGame();
  const [mode, setMode] = useState<Mode>('ai-first');
  const [board, setBoard] = useState<Board>(initial.board);
  const [moves, setMoves] = useState<MoveRecord[]>(initial.moves);
  const [trend, setTrend] = useState<TrendPoint[]>(() => trendFromMoves(initial.moves, 'ai-first'));
  const [certificate, setCertificate] = useState<RuntimeCertificate | null>(null);
  const [thinking, setThinking] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [detail, setDetail] = useState<UiMessage>({ key: 'detail.certificateFirst' });
  const [error, setError] = useState<UiMessage | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [moveAnalysis, setMoveAnalysis] = useState<MoveAnalysis | null>(null);
  const [computedHint, setComputedHint] = useState<OpeningHint | null>(null);
  const [hintComputing, setHintComputing] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const hintWorkerRef = useRef<Worker | null>(null);
  const generationRef = useRef(0);
  const hintGenerationRef = useRef(0);
  const requestRef = useRef(0);
  const hintRequestRef = useRef(0);

  const certifiedWin = useMemo(() => certificate ? certifiedPrefixIntact(certificate, moves) : false, [certificate, moves]);

  const certificateHint = useMemo<OpeningHint | null>(() => {
    const number = nextNumber(board);
    if (!certificate || !certifiedWin || nextPlayer(board) !== FIRST_PLAYER || number > 4) return null;
    const opponentMoves = new Map(moves
      .filter((move) => move.player === SECOND_PLAYER)
      .map((move) => [move.number, move.cell + 1]));
    try {
      return { cell: certifiedMove(certificate, opponentMoves, number), source: 'certificate', iterations: 0, estimate: 1, value: 101 };
    } catch {
      return null;
    }
  }, [board, certificate, certifiedWin, moves]);

  const createWorker = useCallback(() => {
    const worker = new AiWorker();
    workerRef.current = worker;
    return worker;
  }, []);

  const createHintWorker = useCallback(() => {
    const worker = new AiWorker();
    hintWorkerRef.current = worker;
    return worker;
  }, []);

  useEffect(() => {
    createWorker();
    createHintWorker();
    fetch('/generated/strategy-v6.json')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then((data: RuntimeCertificate) => setCertificate(data))
      .catch((cause) => setError({ key: 'error.certificateLoad', variables: { message: cause instanceof Error ? cause.message : String(cause) } }));
    return () => {
      workerRef.current?.terminate();
      hintWorkerRef.current?.terminate();
    };
  }, [createHintWorker, createWorker]);

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

  const restartHintWorker = useCallback(() => {
    hintWorkerRef.current?.terminate();
    createHintWorker();
  }, [createHintWorker]);

  const clearHint = useCallback(() => {
    hintGenerationRef.current += 1;
    hintWorkerRef.current?.terminate();
    hintWorkerRef.current = null;
    setComputedHint(null);
    setHintComputing(false);
    setHintVisible(false);
  }, []);

  const askEngine = useCallback((request: Omit<AiRequest, 'id'>) => new Promise<AiResponse>((resolve, reject) => {
    const worker = workerRef.current ?? createWorker();
    const id = ++requestRef.current;
    const onMessage = (event: MessageEvent<AiResponse>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error ?? 'Search failed'));
    };
    const onError = (event: ErrorEvent) => { cleanup(); reject(new Error(event.message || 'Search worker failed')); };
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ ...request, id } satisfies AiRequest);
  }), [createWorker]);

  const askHintEngine = useCallback((request: Omit<AiRequest, 'id'>) => new Promise<AiResponse>((resolve, reject) => {
    const worker = hintWorkerRef.current ?? createHintWorker();
    const id = ++hintRequestRef.current;
    const onMessage = (event: MessageEvent<AiResponse>) => {
      if (event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error ?? 'Hint search failed'));
    };
    const onError = (event: ErrorEvent) => { cleanup(); reject(new Error(event.message || 'Hint search worker failed')); };
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ ...request, id } satisfies AiRequest);
  }), [createHintWorker]);

  useEffect(() => {
    const humanPlayer: Player = mode === 'ai-first' ? SECOND_PLAYER : FIRST_PLAYER;
    const userCanChoose = mode === 'local' || nextPlayer(board) === humanPlayer;
    const waitingForOpeningCertificate = nextPlayer(board) === FIRST_PLAYER && nextNumber(board) <= 4 && !certificate;
    if (thinking || evaluating || result || moveAnalysis || certificateHint || waitingForOpeningCertificate || !userCanChoose || emptyCells(board).length <= 1) return;
    const exactFifthMove = nextPlayer(board) === FIRST_PLAYER && nextNumber(board) === 5 && (mode === 'human-first' || certifiedWin);
    const token = ++hintGenerationRef.current;
    restartHintWorker();
    const statusTimer = window.setTimeout(() => {
      if (hintGenerationRef.current === token) setHintComputing(true);
    }, 0);
    void askHintEngine({
      kind: exactFifthMove ? 'exactBestMove' : 'strongBestMove',
      board,
      player: nextPlayer(board),
      budgetMs: 1200,
    }).then((response) => {
      if (hintGenerationRef.current !== token) return;
      setComputedHint({
        cell: response.move!,
        source: exactFifthMove ? 'exact' : 'mcts',
        iterations: response.iterations ?? 0,
        estimate: response.estimate ?? 0,
        value: response.value ?? 0,
      });
      setHintComputing(false);
    }).catch(() => {
      if (hintGenerationRef.current === token) setHintComputing(false);
    });
    return () => {
      window.clearTimeout(statusTimer);
      if (hintGenerationRef.current === token) {
        hintGenerationRef.current += 1;
        hintWorkerRef.current?.terminate();
        hintWorkerRef.current = null;
      }
    };
  }, [askHintEngine, board, certificate, certificateHint, certifiedWin, evaluating, mode, moveAnalysis, restartHintWorker, result, thinking]);

  const analyzeLegalMoves = useCallback(async (position: Board): Promise<MoveAnalysis> => {
    const player = nextPlayer(position);
    const branches: Array<{ cell: number; child: Board; firstValue: number; orientedValue: number; opponentValues: number[] }> = [];
    let nodes = 0;
    let cutoffs = 0;
    for (const cell of emptyCells(position)) {
      const child = place(position, cell, player);
      const terminal = scoreBoard(child);
      let firstValue: number;
      if (terminal) {
        firstValue = terminalValue(terminal);
      } else {
        const response = await askEngine({ kind: 'exactBestMove', board: child, player: nextPlayer(child) });
        firstValue = response.value ?? 0;
        nodes += response.nodes ?? 0;
        cutoffs += response.cutoffs ?? 0;
      }
      branches.push({
        cell,
        child,
        firstValue,
        orientedValue: player === FIRST_PLAYER ? firstValue : -firstValue,
        opponentValues: [],
      });
    }
    const bestOriented = Math.max(...branches.map((branch) => branch.orientedValue));
    const bestCategory = Math.sign(bestOriented);
    for (const branch of branches.filter((candidate) => Math.sign(candidate.orientedValue) === bestCategory)) {
      if (scoreBoard(branch.child)) continue;
      const opponent = nextPlayer(branch.child);
      for (const responseCell of emptyCells(branch.child)) {
        const responseBoard = place(branch.child, responseCell, opponent);
        const terminal = scoreBoard(responseBoard);
        let responseFirstValue: number;
        if (terminal) {
          responseFirstValue = terminalValue(terminal);
        } else {
          const response = await askEngine({ kind: 'exactBestMove', board: responseBoard, player: nextPlayer(responseBoard) });
          responseFirstValue = response.value ?? 0;
          nodes += response.nodes ?? 0;
          cutoffs += response.cutoffs ?? 0;
        }
        branch.opponentValues.push(player === FIRST_PLAYER ? responseFirstValue : -responseFirstValue);
      }
    }
    const recommendation = recommendTrapMove(branches.map((branch) => ({
      cell: branch.cell,
      guaranteedValue: branch.orientedValue,
      opponentValues: branch.opponentValues,
    })));
    if (!recommendation) throw new Error('The current position has no legal move');
    return {
      wins: branches.filter((branch) => branch.orientedValue > 0).length,
      draws: branches.filter((branch) => branch.orientedValue === 0).length,
      losses: branches.filter((branch) => branch.orientedValue < 0).length,
      total: branches.length,
      bestFirstValue: branches.find((branch) => branch.orientedValue === bestOriented)?.firstValue ?? 0,
      recommendedCell: recommendation.cell,
      recommendationValue: recommendation.guaranteedValue,
      opponentMistakes: recommendation.opponentMistakes,
      opponentReplies: recommendation.opponentReplies,
      nodes,
      cutoffs,
    };
  }, [askEngine]);

  const startGame = useCallback((selectedMode: Mode = mode) => {
    generationRef.current += 1;
    restartWorker();
    clearHint();
    setMode(selectedMode);
    setError(null);
    setResult(null);
    setMoveAnalysis(null);
    setThinking(false);
    setEvaluating(false);
    setThinkingSeconds(0);
    if (selectedMode === 'ai-first') {
      const next = initialAiGame();
      setBoard(next.board);
      setMoves(next.moves);
      setTrend(trendFromMoves(next.moves, selectedMode));
      setDetail({ key: 'detail.certificateFirst' });
    } else {
      setBoard(emptyBoard());
      setMoves([]);
      setTrend(trendFromMoves([], selectedMode));
      setDetail({ key: selectedMode === 'local' ? 'detail.localStart' : 'detail.experimentalStart' });
    }
  }, [clearHint, mode, restartWorker]);

  const finishIfNeeded = useCallback((nextBoard: Board) => {
    const score = scoreBoard(nextBoard);
    if (!score) return false;
    setResult(score);
    setMoveAnalysis(null);
    setThinking(false);
    return true;
  }, []);

  const runAi = useCallback(async (position: Board, history: MoveRecord[], gameGeneration: number, currentMode: Mode) => {
    if (currentMode === 'local') return;
    const aiPlayer: Player = currentMode === 'ai-first' ? FIRST_PLAYER : SECOND_PLAYER;
    const number = nextNumber(position);
    setThinkingSeconds(0);
    setThinking(true);
    setMoveAnalysis(null);
    setDetail(number <= 4 && currentMode === 'ai-first'
      ? { key: 'detail.queryCertificate', variables: { number } }
      : { key: 'detail.aiSearching' });
    const started = performance.now();
    try {
      let move: number;
      let source: MoveSource;
      let nextDetail: UiMessage;
      let evaluation: number;
      let certainty: Certainty;
      if (currentMode === 'ai-first' && number <= 4) {
        if (!certificate) throw new Error('The strategy certificate has not loaded yet');
        const humanMoves = new Map(history.filter((item) => item.side === 'human').map((item) => [item.number, item.cell + 1]));
        move = certifiedMove(certificate, humanMoves, number);
        source = 'certificate';
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        evaluation = 100;
        certainty = 'proof';
        nextDetail = { key: 'detail.certificateMove', variables: { number, cell: String(move + 1).padStart(2, '0') } };
      } else {
        const empty = emptyCells(position).length;
        const exact = currentMode === 'ai-first' || empty <= 12 || (currentMode === 'human-first' && number === 4);
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
          const outcome = outcomeCode(response.value ?? 0, aiPlayer);
          nextDetail = {
            key: 'detail.exactSearch',
            variables: {
              nodes: formatInteger(response.nodes ?? 0, locale),
              cutoffs: formatInteger(response.cutoffs ?? 0, locale),
              seconds: seconds.toFixed(2),
            },
            nested: { outcome: outcome === 'draw' ? 'detail.canDraw' : outcome === 'aiWin' ? 'detail.aiCanWin' : 'detail.aiCannotAvoidLoss' },
          };
        } else {
          evaluation = Math.round(clamp(50 + (response.estimate ?? 0) * 45, 4, 96));
          certainty = 'estimate';
          nextDetail = {
            key: 'detail.mctsSearch',
            variables: {
              iterations: formatInteger(response.iterations ?? 0, locale),
              estimate: (response.estimate ?? 0).toFixed(3),
              seconds: seconds.toFixed(2),
            },
          };
        }
      }
      if (generationRef.current !== gameGeneration) return;
      const nextBoard = place(position, move, aiPlayer);
      if (scoreBoard(nextBoard)) evaluation = advantageIndex(nextBoard, aiPlayer);
      let nextHistory = [...history, { side: 'ai' as const, player: aiPlayer, number, cell: move, source, evaluation, certainty }];
      setBoard(nextBoard);
      setMoves(nextHistory);
      setTrend(trendFromMoves(nextHistory, currentMode));
      setDetail(nextDetail);
      setThinking(false);
      const finished = finishIfNeeded(nextBoard);
      if (!finished && shouldUseExactEvaluation(nextBoard)) {
        setEvaluating(true);
        const analysis = await analyzeLegalMoves(nextBoard);
        if (generationRef.current !== gameGeneration) return;
        const resolvedEvaluation = exactIndex(analysis.bestFirstValue, aiPlayer);
        nextHistory = nextHistory.map((item, index) => index === nextHistory.length - 1
          ? { ...item, evaluation: resolvedEvaluation, certainty: 'exact' as const, analysis }
          : item);
        setMoves(nextHistory);
        setTrend(trendFromMoves(nextHistory, currentMode));
        setMoveAnalysis(analysis);
        setEvaluating(false);
      }
    } catch (cause) {
      if (generationRef.current !== gameGeneration) return;
      setThinking(false);
      setEvaluating(false);
      setError({ key: 'error.search', variables: { message: cause instanceof Error ? cause.message : String(cause) } });
    }
  }, [analyzeLegalMoves, askEngine, certificate, finishIfNeeded, locale]);

  const runLocalEvaluation = useCallback(async (position: Board, history: MoveRecord[], gameGeneration: number) => {
    setEvaluating(true);
    setMoveAnalysis(null);
    setDetail({ key: 'detail.analyzing' });
    try {
      const analysis = await analyzeLegalMoves(position);
      if (generationRef.current !== gameGeneration) return;
      const value = analysis.bestFirstValue;
      const evaluation = exactIndex(value, FIRST_PLAYER);
      const nextHistory = history.map((move, index) => index === history.length - 1
        ? { ...move, evaluation, certainty: 'exact' as const, analysis }
        : move);
      const outcome = value > 0 ? 'detail.firstCanWin' : value < 0 ? 'detail.secondCanWin' : 'detail.canDraw';
      setMoves(nextHistory);
      setTrend(trendFromMoves(nextHistory, 'local'));
      setMoveAnalysis(analysis);
      setDetail({
        key: 'detail.exactEndgame',
        variables: { nodes: formatInteger(analysis.nodes, locale), cutoffs: formatInteger(analysis.cutoffs, locale) },
        nested: { outcome },
      });
      setEvaluating(false);
    } catch (cause) {
      if (generationRef.current !== gameGeneration) return;
      setEvaluating(false);
      setError({ key: 'error.search', variables: { message: cause instanceof Error ? cause.message : String(cause) } });
    }
  }, [analyzeLegalMoves, locale]);

  const humanMove = useCallback((cell: number) => {
    if (thinking || evaluating || result || board[cell] !== 0) return;
    const currentPlayer = nextPlayer(board);
    const humanPlayer: Player = mode === 'ai-first' ? SECOND_PLAYER : FIRST_PLAYER;
    if (mode !== 'local' && currentPlayer !== humanPlayer) return;
    clearHint();
    const number = nextNumber(board);
    const nextBoard = place(board, cell, currentPlayer);
    const perspective = perspectiveFor(mode);
    const rawEvaluation = advantageIndex(nextBoard, perspective);
    const evaluation = mode === 'ai-first' ? 100 : rawEvaluation;
    const side: MoveSide = mode === 'local' ? (currentPlayer === FIRST_PLAYER ? 'player1' : 'player2') : 'human';
    const certainty: Certainty = mode === 'ai-first' ? 'proof' : 'estimate';
    const nextHistory = [...moves, { side, player: currentPlayer, number, cell, source: 'human' as const, evaluation, certainty }];
    const exactLocalEvaluation = mode === 'local' && shouldUseExactEvaluation(nextBoard);
    setBoard(nextBoard);
    setMoves(nextHistory);
    setMoveAnalysis(null);
    if (!exactLocalEvaluation) setTrend(trendFromMoves(nextHistory, mode));
    setError(null);
    if (finishIfNeeded(nextBoard)) return;
    if (mode === 'local') {
      if (exactLocalEvaluation) void runLocalEvaluation(nextBoard, nextHistory, generationRef.current);
      return;
    }
    void runAi(nextBoard, nextHistory, generationRef.current, mode);
  }, [board, clearHint, evaluating, finishIfNeeded, mode, moves, result, runAi, runLocalEvaluation, thinking]);

  const undo = useCallback(() => {
    const minimum = mode === 'ai-first' ? 1 : 0;
    if (moves.length <= minimum) return;
    generationRef.current += 1;
    restartWorker();
    clearHint();
    const keep = undoKeepCount(moves.map((move) => move.side), mode === 'local', minimum);
    const nextMoves = moves.slice(0, keep);
    setBoard(replay(nextMoves));
    setMoves(nextMoves);
    setTrend(trendFromMoves(nextMoves, mode));
    setResult(null);
    setMoveAnalysis(nextMoves.at(-1)?.analysis ?? null);
    setError(null);
    setThinking(false);
    setEvaluating(false);
    setThinkingSeconds(0);
    setDetail({ key: mode === 'local' ? 'detail.undoLocal' : 'detail.undoAi' });
  }, [clearHint, mode, moves, restartWorker]);

  const humanPlayer: Player = mode === 'ai-first' ? SECOND_PLAYER : FIRST_PLAYER;
  const scoreNeighbors = result ? new Set(NEIGHBORS[result.hole]) : new Set<number>();
  const playerName = (player: Player) => {
    if (mode === 'local') return player === FIRST_PLAYER ? t('game.playerOne') : t('game.playerTwo');
    return player === humanPlayer ? t('game.you') : t('game.ai');
  };
  const winnerText = result ? result.winner === 0 ? t('game.draw') : t('game.wins', { player: playerName(result.winner) }) : '';
  const currentPlayer = nextPlayer(board);
  const statusText = error
    ? t('game.error')
    : result
      ? winnerText
      : evaluating
        ? t('game.statusEvaluating')
        : thinking
          ? t('game.statusThinking', { seconds: thinkingSeconds.toFixed(1) })
          : t('game.statusTurn', { player: playerName(currentPlayer), number: nextNumber(board) });
  const canPlay = mode === 'local' || currentPlayer === humanPlayer;
  const canUndo = moves.length > (mode === 'ai-first' ? 1 : 0);
  const waitingForOpeningCertificate = currentPlayer === FIRST_PLAYER && nextNumber(board) <= 4 && !certificate;
  const canShowHint = canPlay && !thinking && !evaluating && !result && !waitingForOpeningCertificate;
  const openingHint = certificateHint ?? computedHint;
  const recommendedCell = hintVisible ? moveAnalysis?.recommendedCell ?? openingHint?.cell : undefined;

  let cellIndex = 0;
  return (
    <section className="game-panel" aria-label={t('game.label')}>
      <div className="game-toolbar">
        <div className="mode-switch" aria-label={t('game.modeLabel')}>
          <button className={mode === 'ai-first' ? 'selected' : ''} onClick={() => startGame('ai-first')}>{t('game.modeAiFirst')}</button>
          <button className={mode === 'human-first' ? 'selected' : ''} onClick={() => startGame('human-first')}>{t('game.modeHumanFirst')}</button>
          <button className={mode === 'local' ? 'selected' : ''} onClick={() => startGame('local')}>{t('game.modeLocal')}</button>
        </div>
        <div className="game-actions">
          <button className="hint-game" disabled={!canShowHint} onClick={() => setHintVisible((visible) => !visible)}>{hintVisible ? t('game.hideHint') : t('game.showHint')}</button>
          <button className="undo-game" disabled={!canUndo} onClick={undo}>{t('game.undo')}</button>
          <button className="new-game" onClick={() => startGame()}>{t('game.restart')}</button>
        </div>
      </div>

      <div className="game-status" role="status" aria-live="polite">
        <span className={`status-dot ${thinking || evaluating ? 'thinking' : ''}`} />
        <strong>{statusText}</strong>
        <span>{t(mode === 'ai-first' ? 'game.modeProof' : mode === 'human-first' ? 'game.modeExperimental' : 'game.modeLocalDetail')}</span>
      </div>

      {error && <div className="error-box">{renderUiMessage(error, t)}<button onClick={() => startGame()}>{t('game.retry')}</button></div>}

      <div className="game-stage">
        <div className="board-column">
          <div className="board" aria-label={t('game.boardLabel')}>
            {ROWS.map((count) => (
              <div className="board-row" key={count}>
                {Array.from({ length: count }, () => {
                  const cell = cellIndex++;
                  const value = board[cell];
                  const isHole = result?.hole === cell;
                  const owner = value === 0 ? null : value < 0 ? FIRST_PLAYER : SECOND_PLAYER;
                  const ownerName = owner ? playerName(owner) : '';
                  const isRecommended = !result && recommendedCell === cell;
                  const label = isHole
                    ? t('game.hole')
                    : value === 0
                      ? t('game.emptyCell', { cell: cell + 1, recommended: isRecommended ? t('game.recommendedSuffix') : '' })
                      : t('game.occupiedCell', { owner: ownerName, number: Math.abs(value) });
                  const pieceClass = owner === FIRST_PLAYER ? 'first-piece' : owner === SECOND_PLAYER ? 'second-piece' : '';
                  return (
                    <button
                      className={`cell ${pieceClass} ${isHole ? 'hole' : ''} ${scoreNeighbors.has(cell) ? 'scored-neighbor' : ''} ${isRecommended ? 'recommended-move' : ''}`}
                      key={cell}
                      data-recommended-label={t('game.recommendedBadge')}
                      aria-label={label}
                      disabled={thinking || evaluating || Boolean(result) || value !== 0 || !canPlay}
                      onClick={() => humanMove(cell)}
                    >
                      {isHole ? <span className="hole-label">{t('game.hole')}</span> : value !== 0 ? <><small>{ownerName}</small>{Math.abs(value)}</> : <span>{String(cell + 1).padStart(2, '0')}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <aside className="game-rail">
          <AdvantageChart
            points={trend}
            mode={mode}
            pending={thinking || evaluating}
            analysis={moveAnalysis}
            analysisPlayer={playerName(currentPlayer)}
            hintVisible={hintVisible}
            openingHint={openingHint}
            hintComputing={hintComputing}
            certifiedWin={certifiedWin}
          />

          <section className="rules-card">
            <span className="kicker">{t('game.rulesKicker')}</span>
            <p>{t('game.rulesOne')}</p>
            <p><b>{t('game.rulesTwo')}</b></p>
          </section>

          {result ? (
            <section className="result-card">
              <span className="kicker">{t('game.resultKicker')}</span>
              <h2>{winnerText}</h2>
              <div className="score-pair">
                <div><small>{playerName(FIRST_PLAYER)}</small><strong>{result.firstSum}</strong></div>
                <span>:</span>
                <div><small>{playerName(SECOND_PLAYER)}</small><strong>{result.secondSum}</strong></div>
              </div>
              <p>{t('game.resultHole', { cell: String(result.hole + 1).padStart(2, '0') })}</p>
            </section>
          ) : (
            <section className="search-card">
              <span className="kicker">{t('game.latestDecision')}</span>
              <p>{renderUiMessage(detail, t)}</p>
            </section>
          )}

          <section className="history-card">
            <span className="kicker">{t('game.history')}</span>
            <ol>
              {moves.length === 0 && <li className="empty-history">{t('game.awaitingFirst')}</li>}
              {moves.slice(-8).reverse().map((move, index) => (
                <li key={`${move.number}-${move.side}-${index}`}>
                  <span>{move.side === 'ai' ? t('game.ai') : move.side === 'human' ? t('game.you') : move.side === 'player1' ? t('game.playerOne') : t('game.playerTwo')} {move.number}</span>
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
