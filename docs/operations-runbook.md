# Hermes Operations Runbook

This runbook covers day-2 operations for posting, indexing, scoring, and settlement.

## 1. Health Checks

Run these checks first during any incident:

```bash
curl -sS http://localhost:3000/healthz
curl -sS http://localhost:3000/api/indexer-health
hm doctor
```

Expected:
- API health returns `{"ok":true}`.
- Indexer health is `ok` or `warning`, not `critical`.
- `hm doctor` passes RPC/Supabase/factory checks.

## 2. Submission / Scoring Safety Limits

Default scoring limits:
- Max submissions per challenge: `100`
- Max submissions per solver per challenge: `3`
- Max upload size: `50MB`

Behavior:
- Extra submissions are still recorded on-chain and in DB.
- Scoring jobs are marked skipped and not executed by the worker.

Per-challenge overrides can be set in challenge spec:
- `max_submissions_total`
- `max_submissions_per_solver`

## 3. Indexer Reorg Safety

Indexer processes only finalized head minus confirmation depth:
- `HERMES_INDEXER_CONFIRMATION_DEPTH` (default: `3`)

If indexer falls behind:
1. Restart indexer.
2. Check RPC health and `api/indexer-health`.
3. If state replay is needed, run reindex.

## 4. Reindex / Replay

Preview:

```bash
hm reindex --from-block 123456 --dry-run
```

Apply cursor rewind:

```bash
hm reindex --from-block 123456
```

Deep replay (also purge dedupe markers from that block onward):

```bash
hm reindex --from-block 123456 --purge-indexed-events
```

Notes:
- Reindex rewinds factory + challenge cursors for the active chain.
- Purging indexed events forces event handlers to run again from the block.

## 5. Key Management

Rules:
- Never log private key env values.
- Rotate oracle keys on suspected compromise.
- Keep `HERMES_PRIVATE_KEY` and `HERMES_ORACLE_KEY` scoped to required services.

Rotation sequence:
1. Pause worker scoring.
2. Rotate oracle on-chain via governance flow.
3. Update service env.
4. Resume worker after `hm doctor` + smoke validation.

## 6. Recovery Scenarios

### A) Scoring jobs appear stuck
1. Check worker process and Docker daemon health.
2. Check `score_jobs` for accumulating `queued` jobs.
3. Verify scorer images can be pulled and run.
4. Requeue/repair jobs only after root cause is fixed.

### B) IPFS gateway instability
1. Retry affected submissions/challenges.
2. Keep indexer running; retry logic will back off.
3. If failures persist, switch gateway and rerun scoring/verification.

### C) RPC instability
1. Fail over RPC endpoint.
2. Restart indexer/worker.
3. Confirm lag recovers via `/api/indexer-health`.

### D) DB restoration / migration rollback
1. Restore DB snapshot.
2. Re-apply migrations.
3. Rewind indexer (`hm reindex --from-block <known-good-block>`).
4. Monitor event replay and challenge/submission consistency.
