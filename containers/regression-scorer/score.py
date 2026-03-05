"""
Hermes Regression Scorer

Compares submission.csv predictions against ground_truth.csv labels.
Computes all standard regression metrics. Primary score = R² (0–1, higher is better).

Input:  /input/ground_truth.csv — must have 'id' and 'label' columns
        /input/submission.csv   — must have 'id' and 'prediction' columns
Output: /output/score.json      — {ok, score, details}
"""

import json
import math
from pathlib import Path

INPUT_DIR = Path("/input")
OUTPUT_DIR = Path("/output")
GROUND_TRUTH_PATH = INPUT_DIR / "ground_truth.csv"
SUBMISSION_PATH = INPUT_DIR / "submission.csv"
OUTPUT_PATH = OUTPUT_DIR / "score.json"

ID_COL = "id"
LABEL_COL = "label"
PREDICTION_COL = "prediction"


def write_result(payload: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    OUTPUT_PATH.write_text(serialized, encoding="utf-8")


def write_error(message: str) -> None:
    write_result({"ok": False, "score": 0.0, "error": message, "details": {}})
    raise SystemExit(1)


def parse_csv(path: Path) -> list[dict[str, str]]:
    """Minimal CSV parser — no external dependencies beyond stdlib."""
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    lines = text.split("\n")
    header = [col.strip() for col in lines[0].split(",")]
    rows = []
    for line in lines[1:]:
        values = [v.strip() for v in line.split(",")]
        if len(values) != len(header):
            continue  # skip malformed rows
        rows.append(dict(zip(header, values)))
    return rows


def main() -> None:
    if not GROUND_TRUTH_PATH.exists():
        write_error("Missing required file: /input/ground_truth.csv")
    if not SUBMISSION_PATH.exists():
        write_error("Missing required file: /input/submission.csv")

    truth_rows = parse_csv(GROUND_TRUTH_PATH)
    sub_rows = parse_csv(SUBMISSION_PATH)

    if not truth_rows:
        write_error("ground_truth.csv is empty.")

    # Validate columns
    truth_cols = set(truth_rows[0].keys())
    if ID_COL not in truth_cols or LABEL_COL not in truth_cols:
        write_error(f"ground_truth.csv must have '{ID_COL}' and '{LABEL_COL}' columns.")

    if not sub_rows:
        write_error("submission.csv is empty.")

    sub_cols = set(sub_rows[0].keys())
    if ID_COL not in sub_cols or PREDICTION_COL not in sub_cols:
        write_error(f"submission.csv must have '{ID_COL}' and '{PREDICTION_COL}' columns.")

    # Build lookup: id -> label
    truth_map: dict[str, float] = {}
    for row in truth_rows:
        try:
            truth_map[row[ID_COL]] = float(row[LABEL_COL])
        except (ValueError, KeyError):
            continue

    # Match predictions to ground truth by id
    y_true: list[float] = []
    y_pred: list[float] = []
    missing_ids = 0

    for row in sub_rows:
        row_id = row.get(ID_COL, "")
        if row_id not in truth_map:
            missing_ids += 1
            continue
        try:
            pred_val = float(row[PREDICTION_COL])
        except (ValueError, KeyError):
            missing_ids += 1
            continue
        y_true.append(truth_map[row_id])
        y_pred.append(pred_val)

    n = len(y_true)
    if n == 0:
        write_error("No matching rows between submission and ground truth.")

    # ── Compute metrics ──────────────────────────────────────────────

    # Mean
    mean_true = sum(y_true) / n
    mean_pred = sum(y_pred) / n

    # Residuals
    ss_res = sum((t - p) ** 2 for t, p in zip(y_true, y_pred))
    ss_tot = sum((t - mean_true) ** 2 for t in y_true)

    # RMSE
    rmse = math.sqrt(ss_res / n)

    # MAE
    mae = sum(abs(t - p) for t, p in zip(y_true, y_pred)) / n

    # R² (clamped to 0 if negative — means worse than predicting the mean)
    r2 = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    r2_clamped = max(r2, 0.0)

    # Pearson correlation
    std_true = math.sqrt(sum((t - mean_true) ** 2 for t in y_true) / n)
    std_pred = math.sqrt(sum((p - mean_pred) ** 2 for p in y_pred) / n)
    if std_true > 0 and std_pred > 0:
        cov = sum((t - mean_true) * (p - mean_pred) for t, p in zip(y_true, y_pred)) / n
        pearson = cov / (std_true * std_pred)
    else:
        pearson = 0.0

    # Spearman rank correlation
    def rankdata(values: list[float]) -> list[float]:
        """Average-rank method."""
        indexed = sorted(enumerate(values), key=lambda x: x[1])
        ranks = [0.0] * len(values)
        i = 0
        while i < len(indexed):
            j = i
            while j < len(indexed) and indexed[j][1] == indexed[i][1]:
                j += 1
            avg_rank = (i + j + 1) / 2  # 1-based average
            for k in range(i, j):
                ranks[indexed[k][0]] = avg_rank
            i = j
        return ranks

    ranks_true = rankdata(y_true)
    ranks_pred = rankdata(y_pred)
    mean_rank_true = sum(ranks_true) / n
    mean_rank_pred = sum(ranks_pred) / n
    cov_rank = sum((rt - mean_rank_true) * (rp - mean_rank_pred) for rt, rp in zip(ranks_true, ranks_pred)) / n
    std_rank_true = math.sqrt(sum((rt - mean_rank_true) ** 2 for rt in ranks_true) / n)
    std_rank_pred = math.sqrt(sum((rp - mean_rank_pred) ** 2 for rp in ranks_pred) / n)
    if std_rank_true > 0 and std_rank_pred > 0:
        spearman = cov_rank / (std_rank_true * std_rank_pred)
    else:
        spearman = 0.0

    # ── Primary score: R² (clamped 0–1) ──────────────────────────────
    score = float(round(r2_clamped, 12))

    payload = {
        "ok": True,
        "score": score,
        "details": {
            "matched_rows": n,
            "missing_ids": missing_ids,
            "total_ground_truth": len(truth_map),
            "total_submitted": len(sub_rows),
            "r2": float(round(r2, 12)),
            "r2_clamped": float(round(r2_clamped, 12)),
            "rmse": float(round(rmse, 12)),
            "mae": float(round(mae, 12)),
            "pearson": float(round(pearson, 12)),
            "spearman": float(round(spearman, 12)),
        },
    }

    write_result(payload)


if __name__ == "__main__":
    main()
