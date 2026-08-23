export interface BlackHoleModule {
  HEAP8: Int8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _exact_best_move(pointer: number, player: number): number;
  _strong_best_move(pointer: number, player: number, budgetMs: number): number;
  _score_diff(pointer: number): number;
  _get_last_value(): number;
  _get_last_nodes(): number;
  _get_last_cutoffs(): number;
  _get_last_iterations(): number;
  _get_last_estimate(): number;
  _set_random_seed(seed: number): void;
}

export default function createBlackHoleEngine(options?: Record<string, unknown>): Promise<BlackHoleModule>;
