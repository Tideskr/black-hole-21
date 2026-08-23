"""Black Hole（21）先手策略的计算机辅助证明器。

证明目标：在用户限定的前三、四手策略内，先手是否能强制获胜。
AI 节点取“所有回应”，先手节点取“存在一个合法候选”。
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
# 每个角的邻格顺序：下方两个角先沿底边，再沿斜边；顶角按字典序。
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
    """人类可读编号使用 1..21。"""
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
                values.append(f"先{-value}")
            else:
                values.append("·")
        rows.append(" " * (SIDE - row - 1) * 2 + "  ".join(values))
    return "\n".join(rows)


# 三角形的 6 个旋转／镜像，用于把完全等价的残局合并缓存。
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


# ---------- 用户策略的形式化 ----------

def first_move(board):
    """第一手：按字典序选择第一个角。"""
    assert all(value == 0 for value in board)
    return CORNERS[0]


def second_moves(board):
    """第二手候选，顺序严格发生在 AI2 之前。

    AI1 占角时取最后一角；否则把 2 放在 1 旁边。两个邻格都空时，
    先尝试离 AI1 较远者，再以字典序破同分；另一个是合法回退。
    """
    assert board[CORNERS[0]] == -1
    ai1 = next(cell for cell, value in enumerate(board) if value == 1)
    if ai1 in CORNERS:
        return [corner for corner in CORNERS if board[corner] == 0]
    candidates = [cell for cell in CORNER_GUARDS[CORNERS[0]] if board[cell] == 0]
    candidates = sorted(candidates, key=lambda cell: (-DISTANCES[ai1][cell], cell))
    # AI1 位于中轴时，2、3 两格镜像等价；只保留一个代表。
    if REFLECTION[ai1] == ai1 and len(candidates) == 2:
        return candidates[:1]
    return candidates


def _append_empty(board, result, seen, cells):
    for cell in cells:
        if board[cell] == 0 and cell not in seen:
            result.append(cell)
            seen.add(cell)


def _rank_empty_corners(board):
    """空角按污染少、空邻格多、离 AI 远、字典序排列。"""
    ai_cells = [cell for cell, value in enumerate(board) if value > 0]

    def key(corner):
        guards = CORNER_GUARDS[corner]
        pollution = sum(board[cell] > 0 for cell in guards)
        free_guards = sum(board[cell] == 0 for cell in guards)
        nearest_ai = min((DISTANCES[corner][cell] for cell in ai_cells), default=CELL_COUNT)
        return pollution, -free_guards, -nearest_ai, corner

    return sorted((corner for corner in CORNERS if board[corner] == 0), key=key)


def _rank_human_corners(board):
    # 我方数字用负数保存，因此 -3、-2、-1 正好是从大到小。
    return sorted((corner for corner in CORNERS if board[corner] < 0), key=lambda c: (board[c], c))


def _append_remaining_by_geometry(board, result, seen):
    """最终兜底：剩余角、边界格、内部格；同类按字典序。"""
    for degree in (2, 4, 6):
        _append_empty(
            board,
            result,
            seen,
            (cell for cell in range(CELL_COUNT) if len(NEIGHBORS[cell]) == degree),
        )


def third_moves(board):
    """第三手：立即抢角 → 干净空角守格 → 己方角 → 空角 → 全盘兜底。"""
    result, seen = [], set()
    empty_corners = _rank_empty_corners(board)
    ai_has_corner = any(board[corner] > 0 for corner in CORNERS)

    # 若 AI 占了两个远角中的一个，第一候选是剩下的唯一空角。
    if ai_has_corner and len(empty_corners) == 1:
        _append_empty(board, result, seen, empty_corners)

    # AI 尚未占角时优先经营最干净的空角；每角先底边守格、后斜边守格。
    for corner in empty_corners:
        _append_empty(board, result, seen, CORNER_GUARDS[corner])

    # AI1 已占角、H2 占第三角的分支：先贴数字较大的己方角。
    for corner in _rank_human_corners(board):
        _append_empty(board, result, seen, CORNER_GUARDS[corner])

    # 守角格均不能保证获胜时，允许主动占空角。
    _append_empty(board, result, seen, empty_corners)
    _append_remaining_by_geometry(board, result, seen)
    return result


def fourth_moves(board, third_move):
    """第四手：抢角响应 → 同角 → 其他角 → 边界 → 内部，最终不漏合法着。"""
    result, seen = [], set()
    empty_corners = _rank_empty_corners(board)
    ai_has_corner = any(board[corner] > 0 for corner in CORNERS)

    # AI3 刚占一个远角时，优先立即占最后一个空角。
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

    # 补第 3 手经营的同一个角，再尝试直接占这个角。
    for corner in same_anchors:
        _append_empty(board, result, seen, CORNER_GUARDS[corner])
    _append_empty(board, result, seen, same_anchors)

    # 转向其他干净空角，再转向其他己方角。
    other_empty = [corner for corner in empty_corners if corner not in same_anchors]
    for corner in other_empty:
        _append_empty(board, result, seen, CORNER_GUARDS[corner])
    for corner in _rank_human_corners(board):
        if corner not in same_anchors:
            _append_empty(board, result, seen, CORNER_GUARDS[corner])
    _append_empty(board, result, seen, other_empty)

    _append_remaining_by_geometry(board, result, seen)
    return result


# ---------- Numba 精确残局搜索 ----------

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
    # AI 邻格和 - 先手邻格和：负数表示先手获胜。
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

    # 当前所有空格作为黑洞时的差值总和。旧版对每个候选落子都重新
    # 扫描整盘；下面用等价增量式把 O(E^2*6) 降为 O(E*6)。
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

            # 放下 move 后：move 不再是黑洞，故删掉它原来的邻和；其余
            # 相邻空格的邻和各增加 player*number。所有候选分母相同，
            # 排序时无需做浮点除法。
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
    """测试用包装器；正式递归使用按深度复用的缓冲区。"""
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
    """单航班缓存：同一残局同时只允许一个线程执行精确搜索。"""
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

        # 另一个线程正在算同一残局；不占 CPU，完成后回到缓存读取。
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
    # 缓存命中不重复计入本轮实际搜索节点数。
    return result[0], 0, 0


def cache_stats():
    with _cache_lock:
        return {
            "entries": len(_solve_cache),
            "hits": _cache_hits,
            "misses": _cache_misses,
            "waits": _cache_waits,
        }


# ---------- AND–OR 证明任务 ----------

def task_key(ai1):
    return str(cell_name(ai1))


def mirror_cell_number(number):
    return cell_name(REFLECTION[number - 1])


def mirror_pass_result(result):
    """把一个已通过的 AI1 策略证书镜像成另一半棋盘的证书。"""
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
    """在 H1,A1,H2,A2 固定后验证 ∃H3 ∀A3 ∃H4。"""
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
    """验证固定 AI1 后，是否存在一个 H2 能同时应对所有 AI2。"""
    base = [0] * CELL_COUNT
    h1 = first_move(base)
    base[h1] = -1
    if base[ai1] != 0:
        return None
    base[ai1] = 1

    total_calls = 0
    total_nodes = 0
    h2_refutations = []

    # H2 在 AI2 之前选择；每个 H2 必须覆盖 AI2 的全部回应。
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


def run_proof(
    workers=None,
    checkpoint_path="/content/black_hole_proof_checkpoint_v6.json",
    previous_checkpoint_path="/content/black_hole_proof_checkpoint_v5.json",
):
    """运行完整证明；可重复调用并从 checkpoint 继续。"""
    workers = workers or max(1, min(4, os.cpu_count() or 1))
    checkpoint = Path(checkpoint_path)
    all_tasks = generate_tasks()
    if checkpoint.exists():
        data = json.loads(checkpoint.read_text(encoding="utf-8"))
        if data.get("strategy_version") == STRATEGY_VERSION:
            results = data.get("results", {})
            print(f"读取断点：已有 {len(results)} 个任务。")
        else:
            results = {}
            print("发现旧策略断点，已忽略；本次将按新版策略重新计算。")
    else:
        results = {}

    # v6 只做等价优化，策略候选与 v5 相同；已通过的 v5 证书可安全迁移。
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
                _save_checkpoint(checkpoint, {
                    "strategy_version": STRATEGY_VERSION,
                    "results": results,
                })
                print(f"从 v5 断点迁移了 {migrated} 个已通过的镜像代表任务。")

    existing_failures = [result for result in results.values() if not result["passed"]]
    if existing_failures:
        print("断点中已经存在反例，无需继续搜索。")
        return False, existing_failures[0]

    # 先用只有两格的残局触发 Numba 编译，避免多个线程同时编译。
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
    print(f"总任务 {len(all_tasks)}；待运行 {len(pending)}；CPU线程 {workers}。")
    print("11个中轴镜像代表覆盖全部20种 AI1；通过后自动生成另一侧策略表。")
    print("每个任务固定 AI1，并在 AI2 落子前选定一个能覆盖其全部回应的 H2。")
    print("GPU未使用：递归 alpha-beta 的分支和剪枝高度不规则，CPU更合适。")

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
            _save_checkpoint(checkpoint, {
                "strategy_version": STRATEGY_VERSION,
                "results": results,
            })

            elapsed = time.perf_counter() - start
            rate = completed_now / elapsed if elapsed else 0.0
            remaining = len(pending) - completed_now
            eta = remaining / rate if rate else math.inf
            label = "通过" if result["passed"] else "反例"
            mirror_ai1 = REFLECTION[ai1]
            task_label = str(cell_name(ai1))
            if mirror_ai1 != ai1:
                task_label += f"/{cell_name(mirror_ai1)}(镜像)"
            print(
                f"[{len(results)}/{len(all_tasks)}] AI1={task_label}：{label}；"
                f"选定H2={result.get('h2', '无')}；本轮ETA {eta/60:.1f}分钟"
            )

            if not result["passed"] and first_failure is None:
                first_failure = result
                # 已经足以证伪；取消尚未开始的任务。
                for other in futures:
                    other.cancel()
                break

    if first_failure is not None:
        print("\n策略被证伪。最先发现的反例前缀：")
        print(json.dumps(first_failure, ensure_ascii=False, indent=2))
        return False, first_failure

    failed = [result for result in results.values() if not result["passed"]]
    if failed:
        print("断点中已经存在反例。")
        return False, failed[0]

    if len(results) == len(all_tasks):
        full_results = {}
        for ai1 in all_tasks:
            result = results[task_key(ai1)]
            full_results[task_key(ai1)] = result
            mirror_ai1 = REFLECTION[ai1]
            if mirror_ai1 != ai1:
                full_results[task_key(mirror_ai1)] = mirror_pass_result(result)
        _save_checkpoint(checkpoint, {
            "strategy_version": STRATEGY_VERSION,
            "results": results,
            "full_results": full_results,
        })
        print("\n全部分支通过：在上述形式化规则下，先手策略得到计算机辅助证明。")
        print(f"11个代表任务已展开为 {len(full_results)} 项完整 AI1 应对表。")
        print(f"精确残局缓存：{cache_stats()}")
        return True, full_results

    print("本次运行未完成；再次调用 run_proof() 将从断点继续。")
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

    # AI1 在左侧且不占角：2 先走离它较远的第 3 格，再回退第 2 格。
    board[3] = 1
    assert [cell_name(move) for move in second_moves(board)] == [3, 2]

    # AI1 在中轴第 5 格时，H2=2 与 H2=3 镜像等价，只保留第 2 格。
    board = [0] * CELL_COUNT
    board[0], board[4] = -1, 1
    assert [cell_name(move) for move in second_moves(board)] == [2]

    # AI1 占第 16 格角：H2 必须占第 21 格角。
    board = [0] * CELL_COUNT
    board[0], board[15] = -1, 1
    assert [cell_name(move) for move in second_moves(board)] == [21]

    # 新开局：H1=1,A1=2,H2=3,A2=17。21 是干净角，第三手先尝试
    # 它的底边守角格 20，再尝试斜边守角格 15。
    board = [0] * CELL_COUNT
    board[0], board[1], board[2], board[16] = -1, 1, -2, 2
    h3_candidates = [cell_name(move) for move in third_moves(board)]
    assert h3_candidates[:2] == [20, 15]
    assert sorted(h3_candidates) == [cell_name(cell) for cell in empty_cells(board)]

    # 已知困难局面：H3=20,A3=11。贴角与占角之后必须继续回退到
    # 边界格 4；所有合法 H4 都必须恰好出现一次。
    board[19], board[10] = -3, 3
    h4_candidates = [cell_name(move) for move in fourth_moves(board, 19)]
    assert h4_candidates[:2] == [15, 21]
    assert 4 in h4_candidates
    assert sorted(h4_candidates) == [cell_name(cell) for cell in empty_cells(board)]
    assert len(h4_candidates) == len(set(h4_candidates))
    return "自检通过：11个镜像代表、合法量词顺序、分层回退和全候选覆盖均正常。"


if __name__ == "__main__":
    print(self_check())
