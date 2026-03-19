alter table submissions
  drop constraint if exists submissions_submission_intent_id_fkey;

alter table submissions
  add constraint submissions_submission_intent_id_fkey
  foreign key (submission_intent_id)
  references submission_intents(id)
  on delete restrict;
