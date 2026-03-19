-- Destructive migration: do not apply blindly to a populated production
-- database. Preflight first:
--   select count(*) from submissions where submission_intent_id is null;
-- Any remaining rows would be deleted below because the strict intent-first
-- model does not allow scoreable submissions without a registered intent.
alter table submissions
  add column if not exists submission_intent_id uuid;

update submissions
set submission_intent_id = submission_intents.id
from submission_intents
where submission_intents.matched_submission_id = submissions.id
  and submissions.submission_intent_id is null;

delete from submissions
where submission_intent_id is null;

with ranked_submission_intents as (
  select
    id,
    row_number() over (
      partition by challenge_id, solver_address, result_hash
      order by
        case when matched_submission_id is not null then 0 else 1 end,
        created_at asc,
        id asc
    ) as row_num
  from submission_intents
)
delete from submission_intents
where id in (
  select id
  from ranked_submission_intents
  where row_num > 1
);

create unique index if not exists idx_submission_intents_unique_match
  on submission_intents(challenge_id, solver_address, result_hash);

create unique index if not exists idx_submissions_submission_intent_id
  on submissions(submission_intent_id);

alter table submissions
  alter column submission_intent_id set not null;

alter table submissions
  drop constraint if exists submissions_submission_intent_id_fkey;

alter table submissions
  add constraint submissions_submission_intent_id_fkey
  foreign key (submission_intent_id)
  references submission_intents(id)
  on delete cascade;
