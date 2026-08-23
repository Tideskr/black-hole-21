# Reproducing the proof

This directory contains the v6 Python/Numba proof program and a Google Colab launcher. The proof fixes the first player's move 1 at cell 1, then checks every possible opponent move in the following quantifier order:

```text
for every A1, choose one H2 that covers every A2;
for every A2, choose one H3 that covers every A3;
for every A3, choose one H4 whose position is an exact first-player win.
```

After H4, exact alpha-beta search enumerates every legal continuation from A4 through the terminal black hole. Eleven reflection representatives cover all 20 possible A1 cells.

## Local run

From the repository root:

```bash
python -m pip install numpy numba
python -c "from proof.prove_first_player import run_proof; ok,_=run_proof(workers=4, checkpoint_path='proof-output-v6.json', previous_checkpoint_path=None); raise SystemExit(0 if ok else 1)"
```

The run writes an atomic checkpoint and can resume after interruption. Increase or decrease `workers` according to available CPU cores. GPU execution is not used because recursive alpha-beta has highly irregular branching and pruning.

The board stores first-player pieces as negative values and opponent pieces as positive values. The Python terminal value is negative for a first-player win, positive for an opponent win, and zero for a draw. Win/draw/loss class always outranks score margin.

## Colab

Upload `Black_Hole_First_Player_Proof_Colab_v6.ipynb` to Google Colab and run the cells in order. The notebook installs dependencies, clones this repository, runs the self-check, and starts the same full proof.

## Recorded result

- Certificate format: `black-hole-21-first-player-opening-v1`
- Strategy version: 6
- SHA-256: `db99816cc75f3fc5ee50939af8cd8fdf20faf0872e10df0da4705d45d35b4cca`
- Exact endgame calls: 6,153
- Search nodes: 33,370,517,302
- Measured local four-thread time: 34 minutes 12 seconds

The manual **Re-run full proof** GitHub Actions workflow performs the same computation and uploads the resulting certificate as a workflow artifact.
