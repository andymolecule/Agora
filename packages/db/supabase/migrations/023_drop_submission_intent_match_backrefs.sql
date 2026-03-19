drop index if exists idx_submission_intents_unmatched_expires;

alter table submission_intents
  drop column if exists matched_submission_id,
  drop column if exists matched_at;

create index if not exists idx_submission_intents_expires_created
  on submission_intents(expires_at, created_at);
