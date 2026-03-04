#!/usr/bin/env python3
"""
Hermes optimization scorer — starter scaffold.

This is a minimal scorer that reads solver-submitted parameters,
runs your objective function, and outputs a score.

Customize the `objective()` function with your simulation logic.

Container contract:
  Inputs (read-only):
    /input/submission/   — solver's submitted file(s)
    /input/eval/         — poster's evaluation bundle (optional)
  Output (write):
    /output/score.json   — required, format: {"ok": true, "score": <number>, ...}

Build & push:
  docker build -t ghcr.io/your-org/your-scorer:v1 .
  docker push ghcr.io/your-org/your-scorer:v1

Test locally:
  docker run --rm --network=none --read-only \
    -v ./test-submission:/input/submission:ro \
    -v ./test-eval:/input/eval:ro \
    -v ./output:/output \
    ghcr.io/your-org/your-scorer:v1
"""

import json
import glob
import sys
from pathlib import Path

SUBMISSION_DIR = Path("/input/submission")
EVAL_DIR = Path("/input/eval")
OUTPUT_FILE = Path("/output/score.json")


def load_submission() -> dict:
    """Load the solver's submitted parameters."""
    # Look for JSON submission
    json_files = list(SUBMISSION_DIR.glob("*.json"))
    if json_files:
        with open(json_files[0]) as f:
            return json.load(f)

    # Look for CSV submission (single row of params)
    csv_files = list(SUBMISSION_DIR.glob("*.csv"))
    if csv_files:
        import csv
        with open(csv_files[0]) as f:
            reader = csv.DictReader(f)
            row = next(reader)
            return {k: float(v) for k, v in row.items()}

    raise FileNotFoundError("No .json or .csv submission found in /input/submission/")


def objective(params: dict) -> float:
    """
    YOUR OBJECTIVE FUNCTION HERE.

    Replace this with your simulation, model evaluation, or scoring logic.
    Return a single numeric score (higher = better by convention).

    Examples:
      - Run a molecular dynamics simulation with the given parameters
      - Evaluate a set of hyperparameters against a validation set
      - Score a drug candidate configuration

    Args:
        params: dict of parameter names to values submitted by solver

    Returns:
        float: the objective score (higher is better)
    """
    # --- Example: simple quadratic objective ---
    # Replace this with your real simulation
    target = {"param_a": 3.0, "param_b": 7.0}
    score = 0.0
    for key, target_val in target.items():
        val = params.get(key, 0.0)
        score -= (val - target_val) ** 2
    return score


def validate_params(params: dict) -> str | None:
    """
    Optional: validate solver parameters before scoring.
    Return an error message string if invalid, None if valid.
    """
    # Example: check bounds
    for key, val in params.items():
        if not isinstance(val, (int, float)):
            return f"Parameter '{key}' must be numeric, got {type(val).__name__}"
        if val < 0 or val > 10:
            return f"Parameter '{key}' = {val} is out of bounds [0, 10]"
    return None


def main():
    try:
        params = load_submission()

        # Validate
        error = validate_params(params)
        if error:
            result = {"ok": False, "score": 0, "error": error}
        else:
            score = objective(params)
            result = {
                "ok": True,
                "score": score,
                "metric": "custom",
                "details": {
                    "params_received": list(params.keys()),
                    "num_params": len(params),
                },
            }

        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_FILE, "w") as f:
            json.dump(result, f, indent=2)

    except Exception as e:
        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_FILE, "w") as f:
            json.dump({"ok": False, "score": 0, "error": str(e)}, f, indent=2)
        sys.exit(1)


if __name__ == "__main__":
    main()
