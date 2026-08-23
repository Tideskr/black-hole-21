#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

#define CELL_COUNT 21
#define FIRST_PLAYER -1
#define SECOND_PLAYER 1
#define WIN_BASE 100
#define INF 10000
#define MAX_MCTS_NODES 140000

static const int8_t NEIGHBORS[CELL_COUNT][6] = {
  {1,2,-1,-1,-1,-1}, {0,2,3,4,-1,-1}, {0,1,4,5,-1,-1},
  {1,4,6,7,-1,-1}, {1,2,3,5,7,8}, {2,4,8,9,-1,-1},
  {3,7,10,11,-1,-1}, {3,4,6,8,11,12}, {4,5,7,9,12,13},
  {5,8,13,14,-1,-1}, {6,11,15,16,-1,-1}, {6,7,10,12,16,17},
  {7,8,11,13,17,18}, {8,9,12,14,18,19}, {9,13,19,20,-1,-1},
  {10,16,-1,-1,-1,-1}, {10,11,15,17,-1,-1},
  {11,12,16,18,-1,-1}, {12,13,17,19,-1,-1},
  {13,14,18,20,-1,-1}, {14,19,-1,-1,-1,-1}
};

static const uint32_t CORNER_MASK = (1u << 0) | (1u << 15) | (1u << 20);
static double last_nodes = 0;
static double last_cutoffs = 0;
static double last_iterations = 0;
static double last_estimate = 0;
static int last_value = 0;
static uint64_t rng_state = 0x9e3779b97f4a7c15ULL;

typedef struct {
  int8_t board[CELL_COUNT];
  int8_t player;
  int8_t move;
  int8_t remaining;
  int32_t parent;
  int32_t first_child;
  int32_t next_sibling;
  uint32_t unexpanded;
  uint32_t visits;
  double value_sum;
} MctsNode;

static MctsNode *mcts_nodes = NULL;

static uint64_t next_random(void) {
  uint64_t x = rng_state;
  x ^= x >> 12;
  x ^= x << 25;
  x ^= x >> 27;
  rng_state = x;
  return x * 2685821657736338717ULL;
}

static double now_ms(void) {
#ifdef __EMSCRIPTEN__
  return emscripten_get_now();
#else
  return (double)clock() * 1000.0 / (double)CLOCKS_PER_SEC;
#endif
}

static int count_empty(const int8_t *board) {
  int count = 0;
  for (int i = 0; i < CELL_COUNT; ++i) count += board[i] == 0;
  return count;
}

static uint32_t empty_mask(const int8_t *board) {
  uint32_t mask = 0;
  for (int i = 0; i < CELL_COUNT; ++i) if (board[i] == 0) mask |= 1u << i;
  return mask;
}

static int next_number(const int8_t *board) {
  return (CELL_COUNT - count_empty(board)) / 2 + 1;
}

static int terminal_diff(const int8_t *board) {
  int hole = -1;
  for (int i = 0; i < CELL_COUNT; ++i) if (board[i] == 0) { hole = i; break; }
  if (hole < 0) return 0;
  int diff = 0;
  for (int k = 0; k < 6 && NEIGHBORS[hole][k] >= 0; ++k) diff += board[NEIGHBORS[hole][k]];
  return diff;
}

/* Positive values favor the first player. Any win outranks every draw/loss. */
static int terminal_value(const int8_t *board) {
  const int diff = terminal_diff(board); /* second sum - first sum */
  if (diff > 0) return WIN_BASE + diff;
  if (diff < 0) return -WIN_BASE + diff;
  return 0;
}

static int fill_ordered_moves(const int8_t *board, int player, int number, int8_t *moves, int32_t *scores) {
  int base_total = 0;
  for (int hole = 0; hole < CELL_COUNT; ++hole) if (board[hole] == 0) {
    for (int k = 0; k < 6 && NEIGHBORS[hole][k] >= 0; ++k) base_total += board[NEIGHBORS[hole][k]];
  }

  int size = 0;
  for (int move = 0; move < CELL_COUNT; ++move) if (board[move] == 0) {
    int old_diff = 0;
    int empty_neighbors = 0;
    for (int k = 0; k < 6 && NEIGHBORS[move][k] >= 0; ++k) {
      const int neighbor = NEIGHBORS[move][k];
      old_diff += board[neighbor];
      empty_neighbors += board[neighbor] == 0;
    }
    int score = base_total - old_diff + player * number * empty_neighbors;
    if (number <= 3 && ((CORNER_MASK >> move) & 1u)) score += player == FIRST_PLAYER ? 7 : -7;
    moves[size] = (int8_t)move;
    scores[size] = score;
    ++size;
  }

  for (int i = 1; i < size; ++i) {
    const int8_t move = moves[i];
    const int32_t score = scores[i];
    int j = i - 1;
    if (player == FIRST_PLAYER) {
      while (j >= 0 && scores[j] < score) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; --j; }
    } else {
      while (j >= 0 && scores[j] > score) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; --j; }
    }
    moves[j + 1] = move;
    scores[j + 1] = score;
  }
  return size;
}

static int alpha_beta(int8_t *board, int player, int number, int remaining, int alpha, int beta, int depth,
                      int8_t move_stack[CELL_COUNT][CELL_COUNT], int32_t score_stack[CELL_COUNT][CELL_COUNT]) {
  last_nodes += 1;
  if (remaining == 1) return terminal_value(board);
  int8_t *moves = move_stack[depth];
  int32_t *scores = score_stack[depth];
  const int size = fill_ordered_moves(board, player, number, moves, scores);

  if (player == FIRST_PLAYER) {
    int value = -INF;
    for (int i = 0; i < size; ++i) {
      const int move = moves[i];
      board[move] = (int8_t)-number;
      const int child = alpha_beta(board, SECOND_PLAYER, number, remaining - 1, alpha, beta, depth + 1, move_stack, score_stack);
      board[move] = 0;
      if (child > value) value = child;
      if (value > alpha) alpha = value;
      if (alpha >= beta) { last_cutoffs += 1; break; }
    }
    return value;
  }

  int value = INF;
  for (int i = 0; i < size; ++i) {
    const int move = moves[i];
    board[move] = (int8_t)number;
    const int child = alpha_beta(board, FIRST_PLAYER, number + 1, remaining - 1, alpha, beta, depth + 1, move_stack, score_stack);
    board[move] = 0;
    if (child < value) value = child;
    if (value < beta) beta = value;
    if (alpha >= beta) { last_cutoffs += 1; break; }
  }
  return value;
}

EXPORT int exact_best_move(const int8_t *input, int player) {
  int8_t board[CELL_COUNT];
  int8_t move_stack[CELL_COUNT][CELL_COUNT];
  int32_t score_stack[CELL_COUNT][CELL_COUNT];
  memcpy(board, input, CELL_COUNT);
  const int remaining = count_empty(board);
  const int number = next_number(board);
  int8_t moves[CELL_COUNT];
  int32_t scores[CELL_COUNT];
  const int size = fill_ordered_moves(board, player, number, moves, scores);
  int best_move = -1;
  int best_value = player == FIRST_PLAYER ? -INF : INF;
  int alpha = -INF, beta = INF;
  last_nodes = 0;
  last_cutoffs = 0;

  for (int i = 0; i < size; ++i) {
    const int move = moves[i];
    board[move] = (int8_t)(player * number);
    const int child = alpha_beta(board, -player, number + (player == SECOND_PLAYER), remaining - 1,
                                 alpha, beta, 0, move_stack, score_stack);
    board[move] = 0;
    if ((player == FIRST_PLAYER && child > best_value) || (player == SECOND_PLAYER && child < best_value)) {
      best_value = child;
      best_move = move;
    }
    if (player == FIRST_PLAYER && best_value > alpha) alpha = best_value;
    if (player == SECOND_PLAYER && best_value < beta) beta = best_value;
  }
  last_value = best_value;
  return best_move;
}

static int heuristic_rollout_move(const int8_t *board, int player, int number) {
  int8_t moves[CELL_COUNT];
  int32_t scores[CELL_COUNT];
  const int size = fill_ordered_moves(board, player, number, moves, scores);
  if (size <= 1) return moves[0];
  if ((next_random() & 7u) == 0) return moves[next_random() % (uint64_t)size];
  const int pool = size < 3 ? size : 3;
  return moves[next_random() % (uint64_t)pool];
}

static double rollout(int8_t *board, int player, int remaining, int root_player) {
  int number = next_number(board);
  while (remaining > 1) {
    const int move = heuristic_rollout_move(board, player, number);
    board[move] = (int8_t)(player * number);
    if (player == SECOND_PLAYER) ++number;
    player = -player;
    --remaining;
  }
  const int diff = terminal_diff(board);
  double first_reward = diff > 0 ? 1.0 + diff / 100.0 : diff < 0 ? -1.0 + diff / 100.0 : 0.0;
  return root_player == FIRST_PLAYER ? first_reward : -first_reward;
}

static int pick_unexpanded(MctsNode *node, int number) {
  int8_t moves[CELL_COUNT];
  int32_t scores[CELL_COUNT];
  const int size = fill_ordered_moves(node->board, node->player, number, moves, scores);
  int available[CELL_COUNT], count = 0;
  for (int i = 0; i < size; ++i) if ((node->unexpanded >> moves[i]) & 1u) available[count++] = moves[i];
  const int pool = count < 4 ? count : 4;
  return available[next_random() % (uint64_t)pool];
}

static int select_child(const MctsNode *nodes, int parent_index, int root_player) {
  const MctsNode *parent = &nodes[parent_index];
  int best = -1;
  double best_score = -1e100;
  for (int child = parent->first_child; child >= 0; child = nodes[child].next_sibling) {
    const MctsNode *candidate = &nodes[child];
    const double mean = candidate->value_sum / (double)candidate->visits;
    const double direction = parent->player == root_player ? 1.0 : -1.0;
    const double explore = 1.35 * sqrt(log((double)parent->visits + 1.0) / (double)candidate->visits);
    const double score = direction * mean + explore;
    if (score > best_score) { best_score = score; best = child; }
  }
  return best;
}

EXPORT int strong_best_move(const int8_t *input, int player, int budget_ms) {
  if (!mcts_nodes) mcts_nodes = (MctsNode *)malloc(sizeof(MctsNode) * MAX_MCTS_NODES);
  if (!mcts_nodes) return -1;
  const int root_remaining = count_empty(input);
  if (root_remaining <= 10) return exact_best_move(input, player);

  memset(&mcts_nodes[0], 0, sizeof(MctsNode));
  memcpy(mcts_nodes[0].board, input, CELL_COUNT);
  mcts_nodes[0].player = (int8_t)player;
  mcts_nodes[0].move = -1;
  mcts_nodes[0].remaining = (int8_t)root_remaining;
  mcts_nodes[0].parent = -1;
  mcts_nodes[0].first_child = -1;
  mcts_nodes[0].next_sibling = -1;
  mcts_nodes[0].unexpanded = empty_mask(input);
  int node_count = 1;
  int iterations = 0;
  const double deadline = now_ms() + (budget_ms < 50 ? 50 : budget_ms);

  while (now_ms() < deadline && node_count < MAX_MCTS_NODES) {
    int node_index = 0;
    while (mcts_nodes[node_index].remaining > 1 && mcts_nodes[node_index].unexpanded == 0) {
      node_index = select_child(mcts_nodes, node_index, player);
      if (node_index < 0) break;
    }
    if (node_index < 0) break;
    MctsNode *node = &mcts_nodes[node_index];
    if (node->remaining > 1 && node->unexpanded != 0) {
      const int number = next_number(node->board);
      const int move = pick_unexpanded(node, number);
      node->unexpanded &= ~(1u << move);
      const int child_index = node_count++;
      MctsNode *child = &mcts_nodes[child_index];
      memset(child, 0, sizeof(MctsNode));
      memcpy(child->board, node->board, CELL_COUNT);
      child->board[move] = (int8_t)(node->player * number);
      child->player = (int8_t)-node->player;
      child->move = (int8_t)move;
      child->remaining = (int8_t)(node->remaining - 1);
      child->parent = node_index;
      child->first_child = -1;
      child->next_sibling = node->first_child;
      child->unexpanded = empty_mask(child->board);
      node->first_child = child_index;
      node_index = child_index;
      node = child;
    }

    int8_t rollout_board[CELL_COUNT];
    memcpy(rollout_board, node->board, CELL_COUNT);
    const double reward = rollout(rollout_board, node->player, node->remaining, player);
    for (int index = node_index; index >= 0; index = mcts_nodes[index].parent) {
      mcts_nodes[index].visits += 1;
      mcts_nodes[index].value_sum += reward;
    }
    ++iterations;
  }

  int best = -1;
  uint32_t best_visits = 0;
  double best_mean = -1e100;
  for (int child = mcts_nodes[0].first_child; child >= 0; child = mcts_nodes[child].next_sibling) {
    const double mean = mcts_nodes[child].visits ? mcts_nodes[child].value_sum / mcts_nodes[child].visits : -1e100;
    if (mcts_nodes[child].visits > best_visits || (mcts_nodes[child].visits == best_visits && mean > best_mean)) {
      best = child; best_visits = mcts_nodes[child].visits; best_mean = mean;
    }
  }
  last_iterations = iterations;
  last_estimate = best_mean;
  last_nodes = node_count;
  last_cutoffs = 0;
  last_value = 0;
  return best >= 0 ? mcts_nodes[best].move : -1;
}

EXPORT int score_diff(const int8_t *board) { return terminal_diff(board); }
EXPORT int get_last_value(void) { return last_value; }
EXPORT double get_last_nodes(void) { return last_nodes; }
EXPORT double get_last_cutoffs(void) { return last_cutoffs; }
EXPORT double get_last_iterations(void) { return last_iterations; }
EXPORT double get_last_estimate(void) { return last_estimate; }
EXPORT void set_random_seed(int seed) { rng_state = ((uint64_t)(uint32_t)seed << 1) | 1u; }
