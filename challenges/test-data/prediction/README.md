# Prediction Test Data

Test fixtures for the **regression scorer** (`containers/regression-scorer`).

Tiny synthetic dataset: 20 training rows, 10 test rows, 3 features. The underlying relationship is roughly `label ~ 3*feature_a - 0.5*feature_b + 5*feature_c + noise`.

## Files

| File | Role | Who uses it |
|------|------|-------------|
| `train.csv` | Public training data with labels | Solver downloads to build model |
| `test.csv` | Public test inputs (no labels) | Solver predicts on these |
| `hidden_labels.csv` | Private ground truth for test set | Scorer compares predictions against this |
| `sample_submission.csv` | Example solver output | Quick testing without building a model |

## Posting a Challenge (Web UI)

On the challenge posting page, select **Prediction** type and fill these fields:

| UI Field | Upload this file | Notes |
|----------|-----------------|-------|
| **Training Data** | `train.csv` | Has `id`, `feature_a`, `feature_b`, `feature_c`, `label` |
| **Test Data** | `test.csv` | Has `id`, `feature_a`, `feature_b`, `feature_c` (no label) |
| **Hidden Labels** | `hidden_labels.csv` | Has `id`, `label` (kept private, used by scorer) |

Set reward, deadline, and distribution type as desired.

## Submitting as a Solver

Upload `sample_submission.csv` (or your own predictions). The file must have:
- `id` column matching the IDs in `test.csv`
- `prediction` column with numeric values

## Expected Scores (sample_submission.csv)

The sample submission contains near-correct predictions with small offsets:

| Metric | Value |
|--------|-------|
| R² (primary score) | ~0.99 |
| RMSE | ~0.50 |
| MAE | ~0.43 |
| Pearson | ~0.998 |
| Spearman | ~0.988 |

## Scorer Details

- **Container:** `ghcr.io/hermes-science/regression-scorer:v1`
- **Primary metric:** R² (clamped to 0-1, higher is better)
- **All metrics:** R², RMSE, MAE, Pearson, Spearman (all reported in `details`)
- **Dependencies:** None (pure Python stdlib)

## Testing Locally

```bash
# Build the scorer
docker build -t regression-scorer containers/regression-scorer/

# Run against sample data
docker run --rm \
  -v $(pwd)/challenges/test-data/prediction:/input:ro \
  -v /tmp/regression-output:/output \
  regression-scorer

# Check the score
cat /tmp/regression-output/score.json | python -m json.tool
```

Note: For local Docker testing, rename `hidden_labels.csv` to `ground_truth.csv` in the input directory, or create a symlink — the scorer expects `/input/ground_truth.csv`.
