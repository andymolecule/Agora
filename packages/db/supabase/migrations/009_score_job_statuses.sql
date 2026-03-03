-- Normalize score job statuses so "skipped" is distinct from "failed".
-- Legacy skipped rows were previously written as failed with attempts/max_attempts set to 0.
update score_jobs
set status = 'skipped',
    updated_at = now()
where status = 'failed'
  and attempts = 0
  and max_attempts = 0
  and score_tx_hash is null;

-- Normalize any unexpected legacy values before tightening the check constraint.
update score_jobs
set status = 'failed',
    updated_at = now()
where status not in ('queued', 'running', 'scored', 'failed', 'skipped');

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'score_jobs_status_check'
      and conrelid = 'score_jobs'::regclass
  ) then
    alter table score_jobs drop constraint score_jobs_status_check;
  end if;
end $$;

alter table score_jobs
  add constraint score_jobs_status_check
  check (status in ('queued', 'running', 'scored', 'failed', 'skipped'));
