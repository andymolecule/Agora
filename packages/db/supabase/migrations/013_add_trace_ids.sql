alter table submission_intents
  add column if not exists trace_id text;

alter table submissions
  add column if not exists trace_id text;

alter table score_jobs
  add column if not exists trace_id text;

create index if not exists idx_submission_intents_trace_id
  on submission_intents(trace_id)
  where trace_id is not null;

create index if not exists idx_submissions_trace_id
  on submissions(trace_id)
  where trace_id is not null;

create index if not exists idx_score_jobs_trace_id
  on score_jobs(trace_id)
  where trace_id is not null;
