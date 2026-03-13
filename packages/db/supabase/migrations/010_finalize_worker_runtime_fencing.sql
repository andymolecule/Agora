drop function if exists claim_next_score_job(text, text, integer);

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
  v_stale_cutoff timestamptz := now() - (p_lease_ms || ' milliseconds')::interval;
  v_job_id uuid;
  v_active_runtime_version text;
  v_worker_runtime_version text;
begin
  select wrc.active_runtime_version
    into v_active_runtime_version
  from worker_runtime_control wrc
  where wrc.worker_type = 'scoring'
  limit 1;

  select wrs.runtime_version
    into v_worker_runtime_version
  from worker_runtime_state wrs
  where wrs.worker_id = p_worker_id
    and wrs.worker_type = 'scoring'
  limit 1;

  if v_active_runtime_version is not null
     and v_worker_runtime_version is distinct from v_active_runtime_version then
    return;
  end if;

  select sj.id into v_job_id
  from score_jobs sj
  where sj.status = 'running'
    and sj.locked_at < v_stale_cutoff
  order by sj.locked_at asc
  limit 1
  for update skip locked;

  if v_job_id is null then
    select sj.id into v_job_id
    from score_jobs sj
    join challenges c on c.id = sj.challenge_id
    where sj.status = 'queued'
      and c.status = 'scoring'
      and sj.next_attempt_at <= now()
    order by sj.next_attempt_at asc, sj.created_at asc
    limit 1
    for update of sj skip locked;
  end if;

  if v_job_id is null then
    return;
  end if;

  return query
  update score_jobs sj
  set
    status = 'running',
    attempts = sj.attempts + 1,
    locked_at = now(),
    run_started_at = now(),
    locked_by = p_worker_id,
    updated_at = now()
  where sj.id = v_job_id
  returning
    sj.id,
    sj.submission_id,
    sj.challenge_id,
    sj.status,
    sj.attempts,
    sj.max_attempts,
    sj.next_attempt_at,
    sj.locked_at,
    sj.run_started_at,
    sj.locked_by,
    sj.last_error,
    sj.score_tx_hash,
    sj.created_at,
    sj.updated_at;
end;
$$;
