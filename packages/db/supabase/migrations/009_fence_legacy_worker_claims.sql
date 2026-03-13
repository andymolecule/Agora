create or replace function claim_next_score_job(
  p_worker_id text,
  p_lease_ms integer default 3600000
)
returns table (
  id uuid,
  submission_id uuid,
  challenge_id uuid,
  status text,
  attempts integer,
  max_attempts integer,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  run_started_at timestamptz,
  locked_by text,
  last_error text,
  score_tx_hash text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
as $$
declare
  v_runtime_version text;
begin
  select wrs.runtime_version
    into v_runtime_version
  from worker_runtime_state wrs
  where wrs.worker_id = p_worker_id
  limit 1;

  return query
  select *
  from claim_next_score_job(
    p_worker_id,
    v_runtime_version,
    p_lease_ms
  );
end;
$$;
