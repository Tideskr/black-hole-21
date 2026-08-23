"""Computer-assisted first-player strategy prover for Black Hole (21).

The prover asks whether the first player can force a win within the configured
opening candidate order. Opponent nodes quantify over every legal response;
first-player nodes need one legal witness.
"""

from __future__ import annotations

import itertools
import json
import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
from numba import njit


SIDE = 6
CELL_COUNT = 21
AI = 1
FIRST = -1
STRATEGY_VERSION = 6
CERTIFICATE_FORMAT = "black-hole-21-first-player-opening-v1"
PROOF_STATEMENT = (
    "With H1 fixed at cell 1: for every A1 there exists H2; for every A2 "
    "there exists H3; for every A3 there exists H4; and exact minimax from "
    "the resulting position is a forced first-player win."
)

COORDS = [(row, col) for row in range(SIDE) for col in range(row + 1)]
INDEX = {coord: i for i, coord in enumerate(COORDS)}
CORNERS = tuple(sorted((INDEX[(0, 0)], INDEX[(SIDE - 1, 0)], INDEX[(SIDE - 1, SIDE - 1)])))


def _make_neighbors():
    directions = ((0, -1), (0, 1), (-1, -1), (-1, 0), (1, 0), (1, 1))
    result = []
    for row, col in COORDS:
        adjacent = []
        for dr, dc in directions:
            target = (row + dr, col + dc)
            if target in INDEX:
                adjacent.append(INDEX[target])
        result.append(tuple(sorted(adjacent)))
    return tuple(result)


NEIGHBORS = _make_neighbors()
NB_NEIGHBORS = np.full((CELL_COUNT, 6), -1, dtype=np.int8)
for _cell, _adjacent in enumerate(NEIGHBORS):
    NB_NEIGHBORS[_cell, : len(_adjacent)] = _adjacent


def _make_distances():
    distances = [[CELL_COUNT] * CELL_COUNT for _ in range(CELL_COUNT)]
    for source in range(CELL_COUNT):
        distances[source][source] = 0
        queue = [source]
        for cell in queue:
            for neighbor in NEIGHBORS[cell]:
                if distances[source][neighbor] == CELL_COUNT:
                    distances[source][neighbor] = distances[source][cell] + 1
                    queue.append(neighbor)
    return tuple(tuple(row) for row in distances)


DISTANCES = _make_distances()
# Corner guard order: for each lower corner, try the bottom edge before the
# diagonal edge. The top corner uses lexicographic order.
CORNER_GUARDS = {
    INDEX[(0, 0)]: (INDEX[(1, 0)], INDEX[(1, 1)]),
    INDEX[(SIDE - 1, 0)]: (INDEX[(SIDE - 1, 1)], INDEX[(SIDE - 2, 0)]),
    INDEX[(SIDE - 1, SIDE - 1)]: (
        INDEX[(SIDE - 1, SIDE - 2)],
        INDEX[(SIDE - 2, SIDE - 2)],
    ),
}


def empty_cells(board):
    return [i for i, value in enumerate(board) if value == 0]


def cell_name(cell):
    """Return the human-readable 1..21 cell number."""
    return cell + 1


def board_text(board):
    rows = []
    for row in range(SIDE):
        values = []
        for col in range(row + 1):
            value = board[INDEX[(row, col)]]
            if value > 0:
                values.append(f"A{value}")
            elif value < 0:
                values.append(f"H{-value}")
            else:
                values.append("·")
        rows.append(" " * (SIDE - row - 1) * 2 + "  ".join(values))
    return "\n".join(rows)


# The triangle's six rotations/reflections merge equivalent endgames in cache.
def _make_symmetries():
    transforms = []
    for permutation in itertools.permutations((0, 1, 2)):
        mapping = [0] * CELL_COUNT
        for old, (row, col) in enumerate(COORDS):
            bary = (SIDE - 1 - row, row - col, col)
            transformed = tuple(bary[i] for i in permutation)
            new_row = transformed[1] + transformed[2]
            new_col = transformed[2]
            mapping[old] = INDEX[(new_row, new_col)]
        transforms.append(tuple(mapping))
    return tuple(dict.fromkeys(transforms))


SYMMETRIES = _make_symmetries()
REFLECTION = next(
    mapping
    for mapping in SYMMETRIES
    if mapping[CORNERS[0]] == CORNERS[0]
    and mapping[CORNERS[1]] == CORNERS[2]
    and mapping[CORNERS[2]] == CORNERS[1]
)


def canonical_board(board):
    variants = []
    for mapping in SYMMETRIES:
        transformed = [0] * CELL_COUNT
        for old, new in enumerate(mapping):
            transformed[new] = board[old]
        variants.append(tuple(transformed))
    return min(variants)


# ---------- Formalized opening strategy ----------

def first_move(board):
    """Move one: choose the lexicographically first corner."""
    assert all(value == 0 for value in board)
    return CORNERS[0]


def second_moves(board):
    """Move-two candidates, ordered before the opponent's second move.

    If A1 occupies a corner, take the remaining corner. Otherwise place 2 next
    to 1. When both guards are empty, prefer the one farther from A1, break ties
    lexicographically, and retain the other as a legal fallback.
    """
    assert board[CORNERS[0]] == -1
    ai1 = next(cell for cell, value in enumerate(board) if value == 1)
    if ai1 in CORNERS:
        return [corner for corner in CORNERS if board[corner] == 0]
    candidates = [cell for cell in CORNER_GUARDS[CORNERS[0]] if board[cell] == 0]
    candidates = sorted(candidates, key=lambda cell: (-DISTANCES[ai1][cell], cell))
    # When A1 lies on the symmetry axis, cells 2 and 3 are equivalent; retain one.
    if REFLECTION[ai1] == ai1 and len(candidates) == 2:
        return candidates[:1]
    return candidates


def _append_empty(board, result, seen, cells):
    for cell in cells:
        if board[cell] == 0 and cell not in seen:
            result.append(cell)
            seen.add(cell)


def _rank_empty_corners(board):
    """Rank empty corners by contamination, free guards, AI distance, then cell."""
    ai_cells = [cell for cell, value in enumerate(board) if value > 0]

    def key(corner):
        guards = CORNER_GUARDS[corner]
        pollution = sum(board[cell] > 0 for cell in guards)
        free_guards = sum(board[cell] == 0 for cell in guards)
        nearest_ai = min((DISTANCES[corner][cell] for cell in ai_cells), default=CELL_COUNT)
        return pollution, -free_guards, -nearest_ai, corner

    return sorted((corner for corner in CORNERS if board[corner] == 0), key=key)


def _rank_human_corners(board):
    # First-player values are negative, so -3, -2, -1 is descending by number.
    return sorted((corner for corner in CORNERS if board[corner] < 0), key=lambda c: (board[c], c))


def _append_remaining_by_geometry(board, result, seen):
    """Final fallback: remaining corners, boundary cells, then interior cells."""
    for degree in (2, 4, 6):
        _append_empty(
            board,
            result,
            seen,
            (cell for cell in range(CELL_COUNT) if len(NEIGHBORS[cell]) == degree),
        )


def third_moves(board):
    """Move three: urgent corner, clean guard, owned corner, empty corner, fallback."""
    result, seen = [], set()
    empty_corners = _rank_empty_corners(board)
    ai_has_corner = any(board[corner] > 0 for corner in CORNERS)

    # If AI occupies one lower corner, first try the only remaining empty corner.
    if ai_has_corner and len(empty_corners) == 1:
        _append_empty(board, result, seen, empty_corners)

    # If AI owns no corner, develop the cleanest one; try bottom-edge guard first.
    for corner in empty_corners:
        _append_empty(board, result, seen, CORNER_GUARDS[corner])

    # When A1 and H2 occupy corners, first guard the larger owned corner value.
    for corner in _rank_human_corners(board):
        _append_empty(board, result, seen, CORNER_GUARDS[corner])

    # If no guard guarantees a win, allow direct occupation of an empty corner.
    _append_empty(board, result, seen, empty_corners)
    _append_remaining_by_geometry(board, result, seen)
    return result


def fourth_moves(board, third_move):
    """Move four: corner response, same corner, other corners, boundary, interior."""
    result, seen = [], set()
    empty_corners = _rank_empty_corners(board)
    ai_has_corner = any(board[corner] > 0 for corner in CORNERS)

    # If A3 just took a lower corner, immediately prefer the last empty corner.
    if ai_has_corner and len(empty_corners) == 1:
        _append_empty(board, result, seen, empty_corners)

    same_anchors = []
    if third_move in CORNERS:
        same_anchors.append(third_move)
    same_anchors.extend(
        corner
        for corner in CORNERS
        if third_move in NEIGHBORS[corner] and corner not in same_anchors
    )

    # Complete the corner developed on move three, then try occupying it directly.
    for corner in same_anchors:
        _append_empty(board, result, seen, CORNER_GUARDS[corner])
    _append_empty(board, result, seen, same_anchors)

    # Continue with other clean empty corners, then other owned corners.
    other_empty = [corner for corner in empty_corners if corner not in same_anchors]
    for corner in other_empty:
        _append_empty(board, result, seen, CORNER_GUARDS[corner])
    for corner in _rank_human_corners(board):
        if corner not in same_anchors:
            _append_empty(board, result, seen, CORNER_GUARDS[corner])
    _append_empty(board, result, seen, other_empty)

    _append_remaining_by_geometry(board, result, seen)
    return result


# ---------- Exact Numba endgame search ----------

@njit(nogil=True)
def _empty_count_nb(board):
    count = 0
    for i in range(CELL_COUNT):
        if board[i] == 0:
            count += 1
    return count


@njit(nogil=True)
def _terminal_value_nb(board, neighbors):
    hole = -1
    for i in range(CELL_COUNT):
        if board[i] == 0:
            hole = i
            break
    diff = 0
    for k in range(6):
        neighbor = neighbors[hole, k]
        if neighbor >= 0:
            diff += board[neighbor]
    # Signed sum is opponent neighbor sum minus first-player neighbor sum.
    # The returned value is negative exactly when the first player wins.
    if diff < 0:
        return 100 - diff
    if diff > 0:
        return -100 - diff
    return 0


@njit(nogil=True)
def _mean_hole_diff_nb(board, neighbors):
    total = 0.0
    holes = 0
    for hole in range(CELL_COUNT):
        if board[hole] == 0:
            diff = 0
            for k in range(6):
                neighbor = neighbors[hole, k]
                if neighbor >= 0:
                    diff += board[neighbor]
            total += diff
            holes += 1
    return total / holes


@njit(nogil=True)
def _fill_ordered_moves_nb(board, player, number, neighbors, moves, scores):
    base_total = 0

    # Sum the score difference with every empty cell treated as the black hole.
    # The incremental update below replaces the old O(E^2*6) rescan with O(E*6).
    for hole in range(CELL_COUNT):
        if board[hole] == 0:
            for k in range(6):
                neighbor = neighbors[hole, k]
                if neighbor >= 0:
                    base_total += board[neighbor]

    size = 0
    for move in range(CELL_COUNT):
        if board[move] == 0:
            old_diff_at_move = 0
            empty_neighbors = 0
            for k in range(6):
                neighbor = neighbors[move, k]
                if neighbor >= 0:
                    old_diff_at_move += board[neighbor]
                    if board[neighbor] == 0:
                        empty_neighbors += 1

            # Once occupied, move is no longer a possible hole, so remove its old
            # neighbor sum. Every adjacent empty hole gains player*number. All
            # candidates share a denominator, so sorting needs no float division.
            scores[size] = (
                base_total
                - old_diff_at_move
                + player * number * empty_neighbors
            )
            moves[size] = move
            size += 1

    for i in range(1, size):
        move = moves[i]
        score = scores[i]
        j = i - 1
        if player == AI:
            while j >= 0 and scores[j] > score:
                moves[j + 1] = moves[j]
                scores[j + 1] = scores[j]
                j -= 1
        else:
            while j >= 0 and scores[j] < score:
                moves[j + 1] = moves[j]
                scores[j + 1] = scores[j]
                j -= 1
        moves[j + 1] = move
        scores[j + 1] = score
    return size


@njit(nogil=True)
def _ordered_moves_nb(board, player, number, neighbors):
    """Test wrapper; production recursion reuses depth-indexed buffers."""
    moves = np.empty(CELL_COUNT, dtype=np.int8)
    scores = np.empty(CELL_COUNT, dtype=np.int32)
    size = _fill_ordered_moves_nb(board, player, number, neighbors, moves, scores)
    return moves, size


@njit(nogil=True)
def _alpha_beta_nb(
    board, player, number, remaining, alpha, beta, neighbors, stats,
    move_stack, score_stack, depth
):
    stats[0] += 1
    if remaining == 1:
        return _terminal_value_nb(board, neighbors)

    moves = move_stack[depth]
    scores = score_stack[depth]
    size = _fill_ordered_moves_nb(
        board, player, number, neighbors, moves, scores
    )
    if player == AI:
        value = -10_000
        for i in range(size):
            move = moves[i]
            board[move] = number
            child = _alpha_beta_nb(
                board, FIRST, number + 1, remaining - 1,
                alpha, beta, neighbors, stats,
                move_stack, score_stack, depth + 1
            )
            board[move] = 0
            if child > value:
                value = child
            if value > alpha:
                alpha = value
            if alpha >= beta:
                stats[1] += 1
                break
        return value

    value = 10_000
    for i in range(size):
        move = moves[i]
        board[move] = -number
        child = _alpha_beta_nb(
            board, AI, number, remaining - 1,
            alpha, beta, neighbors, stats,
            move_stack, score_stack, depth + 1
        )
        board[move] = 0
        if child < value:
            value = child
        if value < beta:
            beta = value
        if alpha >= beta:
            stats[1] += 1
            break
    return value


@njit(nogil=True)
def _exact_value_nb(board, player, neighbors):
    stats = np.zeros(2, dtype=np.int64)
    move_stack = np.empty((CELL_COUNT, CELL_COUNT), dtype=np.int8)
    score_stack = np.empty((CELL_COUNT, CELL_COUNT), dtype=np.int32)
    remaining = _empty_count_nb(board)
    number = (CELL_COUNT - remaining) // 2 + 1
    value = _alpha_beta_nb(
        board, player, number, remaining,
        -10_000, 10_000, neighbors, stats,
        move_stack, score_stack, 0
    )
    return value, stats[0], stats[1]


_cache_lock = threading.Lock()
_solve_cache = {}
_inflight = {}
_cache_hits = 0
_cache_misses = 0
_cache_waits = 0


def _solve_canonical(canonical):
    """Single-flight cache: only one thread solves a given endgame at a time."""
    global _cache_hits, _cache_misses, _cache_waits
    while True:
        with _cache_lock:
            cached = _solve_cache.get(canonical)
            if cached is not None:
                _cache_hits += 1
                return cached, False

            event = _inflight.get(canonical)
            if event is None:
                event = threading.Event()
                _inflight[canonical] = event
                _cache_misses += 1
                break
            _cache_waits += 1

        # Another thread owns this solve. Wait without consuming CPU, then retry.
        event.wait()

    try:
        board = np.asarray(canonical, dtype=np.int16).copy()
        value, nodes, cutoffs = _exact_value_nb(board, AI, NB_NEIGHBORS)
        result = int(value), int(nodes), int(cutoffs)
    except BaseException:
        with _cache_lock:
            _inflight.pop(canonical, None)
            event.set()
        raise

    with _cache_lock:
        _solve_cache[canonical] = result
        _inflight.pop(canonical, None)
        event.set()
    return result, True


def exact_value_after_four(board):
    canonical = canonical_board(board)
    result, computed = _solve_canonical(canonical)
    if computed:
        return result
    # Cache hits do not add the same search nodes to this run twice.
    return result[0], 0, 0


def cache_stats():
    with _cache_lock:
        return {
            "entries": len(_solve_cache),
            "hits": _cache_hits,
            "misses": _cache_misses,
            "waits": _cache_waits,
        }


# ---------- AND-OR proof tasks ----------

def task_key(ai1):
    return str(cell_name(ai1))


def mirror_cell_number(number):
    return cell_name(REFLECTION[number - 1])


def mirror_pass_result(result):
    """Reflect a passing A1 strategy certificate onto the other half-board."""
    assert result["passed"]
    mirrored_responses = {}
    for ai2_text, response in result["responses_by_ai2"].items():
        mirrored_h4 = {
            str(mirror_cell_number(int(ai3_text))): mirror_cell_number(h4)
            for ai3_text, h4 in response["h4_by_ai3"].items()
        }
        mirrored_responses[str(mirror_cell_number(int(ai2_text)))] = {
            "h3": mirror_cell_number(response["h3"]),
            "h4_by_ai3": mirrored_h4,
        }

    return {
        "passed": True,
        "ai1": mirror_cell_number(result["ai1"]),
        "h2": mirror_cell_number(result["h2"]),
        "responses_by_ai2": mirrored_responses,
        "exact_calls": 0,
        "exact_nodes": 0,
        "derived_by_reflection_from_ai1": result["ai1"],
    }


def _verify_after_ai2(board):
    """After fixing H1,A1,H2,A2, verify exists H3, for all A3, exists H4."""
    refutations = []
    exact_calls = 0
    exact_nodes = 0

    for h3 in third_moves(board):
        board[h3] = -3
        response_map = {}
        failed_ai3 = None

        for ai3 in empty_cells(board):
            board[ai3] = 3
            winning_h4 = None
            tried_h4 = []

            for h4 in fourth_moves(board, h3):
                board[h4] = -4
                value, nodes, _ = exact_value_after_four(board)
                exact_calls += 1
                exact_nodes += nodes
                board[h4] = 0
                tried_h4.append((cell_name(h4), value))
                if value < 0:
                    winning_h4 = h4
                    break

            board[ai3] = 0
            if winning_h4 is None:
                failed_ai3 = ai3
                refutations.append({
                    "h3": cell_name(h3),
                    "ai3": cell_name(ai3),
                    "h4_values": tried_h4,
                })
                break
            response_map[str(cell_name(ai3))] = cell_name(winning_h4)

        board[h3] = 0
        if failed_ai3 is None:
            return ({
                "passed": True,
                "h3": cell_name(h3),
                "h4_by_ai3": response_map,
            }, exact_calls, exact_nodes)

    return ({
        "passed": False,
        "refutations": refutations,
        "prefix_board": board.copy(),
    }, exact_calls, exact_nodes)


def verify_ai1(ai1):
    """For a fixed A1, verify that one H2 covers every A2 response."""
    base = [0] * CELL_COUNT
    h1 = first_move(base)
    base[h1] = -1
    if base[ai1] != 0:
        return None
    base[ai1] = 1

    total_calls = 0
    total_nodes = 0
    h2_refutations = []

    # H2 is selected before A2 and must cover every legal A2 response.
    for h2 in second_moves(base):
        board = base.copy()
        board[h2] = -2
        responses = {}
        failed_ai2 = None

        for ai2 in empty_cells(board):
            board[ai2] = 2
            verdict, calls, nodes = _verify_after_ai2(board)
            total_calls += calls
            total_nodes += nodes
            failure_board = board.copy()
            board[ai2] = 0

            if not verdict["passed"]:
                failed_ai2 = ai2
                h2_refutations.append({
                    "h2": cell_name(h2),
                    "ai2": cell_name(ai2),
                    "h3_refutations": verdict["refutations"],
                    "prefix_board": failure_board,
                })
                break

            responses[str(cell_name(ai2))] = {
                "h3": verdict["h3"],
                "h4_by_ai3": verdict["h4_by_ai3"],
            }

        if failed_ai2 is None:
            return {
                "passed": True,
                "ai1": cell_name(ai1),
                "h2": cell_name(h2),
                "responses_by_ai2": responses,
                "exact_calls": total_calls,
                "exact_nodes": total_nodes,
            }

    return {
        "passed": False,
        "ai1": cell_name(ai1),
        "h2_refutations": h2_refutations,
        "prefix_board": base,
        "exact_calls": total_calls,
        "exact_nodes": total_nodes,
    }


def generate_tasks():
    board = [0] * CELL_COUNT
    board[first_move(board)] = -1
    return [
        ai1
        for ai1 in empty_cells(board)
        if ai1 <= REFLECTION[ai1]
    ]


def _save_checkpoint(path, data):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def certificate_payload(results, full_results=None):
    payload = {
        "certificate_format": CERTIFICATE_FORMAT,
        "proof_statement": PROOF_STATEMENT,
        "strategy_version": STRATEGY_VERSION,
        "results": results,
    }
    if full_results is not None:
        payload["full_results"] = full_results
    return payload


def run_proof(
    workers=None,
    checkpoint_path="/content/black_hole_proof_checkpoint_v6.json",
    previous_checkpoint_path="/content/black_hole_proof_checkpoint_v5.json",
):
    """Run the full proof, resuming from a checkpoint when available."""
    workers = workers or max(1, min(4, os.cpu_count() or 1))
    checkpoint = Path(checkpoint_path)
    all_tasks = generate_tasks()
    if checkpoint.exists():
        data = json.loads(checkpoint.read_text(encoding="utf-8"))
        if data.get("strategy_version") == STRATEGY_VERSION:
            results = data.get("results", {})
            print(f"Loaded checkpoint with {len(results)} completed tasks.")
        else:
            results = {}
            print("Ignored a checkpoint from a different strategy version.")
    else:
        results = {}

    # v6 changes only equivalent optimizations; passing v5 witnesses remain valid.
    migrated = 0
    previous = Path(previous_checkpoint_path) if previous_checkpoint_path else None
    if previous and previous.exists():
        old_data = json.loads(previous.read_text(encoding="utf-8"))
        if old_data.get("strategy_version") == 5:
            old_results = old_data.get("results", {})
            for ai1 in all_tasks:
                key = task_key(ai1)
                if key in results:
                    continue
                old_result = old_results.get(key)
                if old_result and old_result.get("passed"):
                    results[key] = old_result
                    migrated += 1
                    continue
                mirror_key = task_key(REFLECTION[ai1])
                old_result = old_results.get(mirror_key)
                if old_result and old_result.get("passed"):
                    results[key] = mirror_pass_result(old_result)
                    migrated += 1
            if migrated:
                _save_checkpoint(checkpoint, certificate_payload(results))
                print(f"Migrated {migrated} passing representative tasks from v5.")

    existing_failures = [result for result in results.values() if not result["passed"]]
    if existing_failures:
        print("The checkpoint already contains a counterexample; stopping.")
        return False, existing_failures[0]

    # Warm up Numba on a two-cell endgame before starting worker threads.
    warm = np.zeros(CELL_COUNT, dtype=np.int16)
    player = FIRST
    number = 1
    for cell in range(19):
        warm[cell] = player * number
        player = -player
        if player == FIRST:
            number += 1
    _exact_value_nb(warm, player, NB_NEIGHBORS)

    pending = [ai1 for ai1 in all_tasks if task_key(ai1) not in results]
    print(f"Total tasks: {len(all_tasks)}; pending: {len(pending)}; CPU threads: {workers}.")
    print("Eleven reflection representatives cover all 20 A1 moves; passing witnesses are mirrored automatically.")
    print("Each task fixes A1 and selects one H2 before A2 that must cover every A2 reply.")
    print("GPU disabled: recursive alpha-beta has irregular branching and pruning, so CPU execution is a better fit.")

    start = time.perf_counter()
    completed_now = 0
    first_failure = None

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(verify_ai1, ai1): ai1 for ai1 in pending}
        for future in as_completed(futures):
            ai1 = futures[future]
            result = future.result()
            if result is None:
                continue
            key = task_key(ai1)
            results[key] = result
            completed_now += 1
            _save_checkpoint(checkpoint, certificate_payload(results))

            elapsed = time.perf_counter() - start
            rate = completed_now / elapsed if elapsed else 0.0
            remaining = len(pending) - completed_now
            eta = remaining / rate if rate else math.inf
            label = "passed" if result["passed"] else "counterexample"
            mirror_ai1 = REFLECTION[ai1]
            task_label = str(cell_name(ai1))
            if mirror_ai1 != ai1:
                task_label += f"/{cell_name(mirror_ai1)}(reflection)"
            print(
                f"[{len(results)}/{len(all_tasks)}] AI1={task_label}：{label}；"
                f"selected H2={result.get('h2', 'none')}; run ETA {eta/60:.1f} minutes"
            )

            if not result["passed"] and first_failure is None:
                first_failure = result
                # One counterexample refutes the strategy; cancel unstarted tasks.
                for other in futures:
                    other.cancel()
                break

    if first_failure is not None:
        print("\nStrategy refuted. First counterexample prefix:")
        print(json.dumps(first_failure, ensure_ascii=False, indent=2))
        return False, first_failure

    failed = [result for result in results.values() if not result["passed"]]
    if failed:
        print("The checkpoint contains a counterexample.")
        return False, failed[0]

    if len(results) == len(all_tasks):
        full_results = {}
        for ai1 in all_tasks:
            result = results[task_key(ai1)]
            full_results[task_key(ai1)] = result
            mirror_ai1 = REFLECTION[ai1]
            if mirror_ai1 != ai1:
                full_results[task_key(mirror_ai1)] = mirror_pass_result(result)
        _save_checkpoint(checkpoint, certificate_payload(results, full_results))
        print("\nAll branches passed: the formalized first-player strategy is computer-assisted proven.")
        print(f"Expanded 11 representative tasks into {len(full_results)} complete A1 response tables.")
        print(f"Exact endgame cache: {cache_stats()}")
        return True, full_results

    print("This run is incomplete; call run_proof() again to resume from the checkpoint.")
    return None, results


def self_check():
    assert CORNERS == (0, 15, 20)
    assert tuple(cell_name(cell) for cell in CORNER_GUARDS[15]) == (17, 11)
    assert tuple(cell_name(cell) for cell in CORNER_GUARDS[20]) == (20, 15)
    assert len(SYMMETRIES) == 6
    assert mirror_cell_number(2) == 3
    assert mirror_cell_number(16) == 21
    assert mirror_cell_number(5) == 5
    assert len(generate_tasks()) == 11

    sample_certificate = {
        "passed": True,
        "ai1": 2,
        "h2": 3,
        "responses_by_ai2": {
            "4": {"h3": 17, "h4_by_ai3": {"11": 4}},
        },
        "exact_calls": 1,
        "exact_nodes": 1,
    }
    mirrored = mirror_pass_result(sample_certificate)
    assert mirrored["ai1"] == 3 and mirrored["h2"] == 2
    assert mirrored["responses_by_ai2"]["6"]["h3"] == 20
    assert mirrored["responses_by_ai2"]["6"]["h4_by_ai3"]["15"] == 6

    board = [0] * CELL_COUNT
    h1 = first_move(board)
    board[h1] = -1
    assert h1 == 0

    # A1 is on the left and not a corner: try the farther guard cell 3, then 2.
    board[3] = 1
    assert [cell_name(move) for move in second_moves(board)] == [3, 2]

    # With A1 on axis cell 5, H2=2 and H2=3 are reflections; keep cell 2.
    board = [0] * CELL_COUNT
    board[0], board[4] = -1, 1
    assert [cell_name(move) for move in second_moves(board)] == [2]

    # If A1 occupies corner 16, H2 must occupy corner 21.
    board = [0] * CELL_COUNT
    board[0], board[15] = -1, 1
    assert [cell_name(move) for move in second_moves(board)] == [21]

    # Opening H1=1,A1=2,H2=3,A2=17: corner 21 is clean, so move three tries
    # its bottom-edge guard 20 before its diagonal guard 15.
    board = [0] * CELL_COUNT
    board[0], board[1], board[2], board[16] = -1, 1, -2, 2
    h3_candidates = [cell_name(move) for move in third_moves(board)]
    assert h3_candidates[:2] == [20, 15]
    assert sorted(h3_candidates) == [cell_name(cell) for cell in empty_cells(board)]

    # Known difficult prefix H3=20,A3=11: after guards and corners, the order
    # must reach boundary cell 4; every legal H4 must appear exactly once.
    board[19], board[10] = -3, 3
    h4_candidates = [cell_name(move) for move in fourth_moves(board, 19)]
    assert h4_candidates[:2] == [15, 21]
    assert 4 in h4_candidates
    assert sorted(h4_candidates) == [cell_name(cell) for cell in empty_cells(board)]
    assert len(h4_candidates) == len(set(h4_candidates))
    return "Self-check passed: 11 reflections, legal quantifier order, layered fallbacks, and complete candidates."


if __name__ == "__main__":
    print(self_check())
