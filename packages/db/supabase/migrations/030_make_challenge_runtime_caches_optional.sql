alter table challenges
  alter column evaluation_json drop not null;

alter table challenges
  alter column evaluation_json drop default;

alter table challenges
  alter column scoring_env_json drop default;
