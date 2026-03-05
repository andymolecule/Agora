# Test Data

Fixture datasets for end-to-end testing of each challenge type. Each subdirectory maps to one challenge type and contains everything needed for a full post-to-payout loop.

## Directory Layout

```
test-data/
  prediction/     ← regression scorer (RMSE, R², Pearson, Spearman)
  reproducibility/ ← (planned) repro scorer
  docking/         ← (planned) docking scorer
```

## How to Use

1. Pick a challenge type directory (e.g. `prediction/`).
2. Read its `README.md` for which files to upload in the posting UI and what a solver submits.
3. Post a challenge using `hm post` or the web UI.
4. Submit the sample submission as a solver.
5. Wait for scoring, verify, finalize, claim.

See `docs/testnet-ops-runbook.md` for full operational procedures.
