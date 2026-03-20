alter table challenges
  alter column evaluation_json drop not null;

update challenges
set
  evaluation_json = null,
  scoring_env_json = null
where evaluation_plan_json is not null;
