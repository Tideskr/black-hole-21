import type { Board, Player } from '../lib/game';

export interface AiRequest {
  id: number;
  kind: 'exactBestMove' | 'strongBestMove';
  board: Board;
  player: Player;
  budgetMs?: number;
}

export interface AiResponse {
  id: number;
  ok: boolean;
  move?: number;
  value?: number;
  nodes?: number;
  cutoffs?: number;
  iterations?: number;
  estimate?: number;
  engineMode?: 'exact' | 'mcts';
  error?: string;
}
