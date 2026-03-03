alter table challenges
add column if not exists scoring_preset_id text;

create index if not exists idx_challenges_scoring_preset_id
on challenges(scoring_preset_id);
