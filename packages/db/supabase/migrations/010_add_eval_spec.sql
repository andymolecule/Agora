-- Add eval_spec columns to challenges table.
-- These represent the lean 3-field evaluation specification:
--   eval_engine_id:          preset name or "custom"
--   eval_engine_digest:      pinned container digest (@sha256:...)
--   eval_bundle_cid:         CID of evaluation bundle (ground truth + config)
--
-- Existing challenges are backfilled from scoring_preset_id / scoring_container / dataset_test_cid.
-- The old columns are retained for backward compatibility.

ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS eval_engine_id text,
  ADD COLUMN IF NOT EXISTS eval_engine_digest text,
  ADD COLUMN IF NOT EXISTS eval_bundle_cid text;

-- Backfill: derive eval columns from existing data
UPDATE challenges
SET
  eval_engine_id = COALESCE(scoring_preset_id, 'custom'),
  eval_engine_digest = CASE
    WHEN scoring_container LIKE '%@sha256:%' THEN scoring_container
    ELSE NULL
  END,
  eval_bundle_cid = dataset_test_cid
WHERE eval_engine_id IS NULL;

-- Index for engine lookups
CREATE INDEX IF NOT EXISTS idx_challenges_eval_engine_id
  ON challenges (eval_engine_id);
