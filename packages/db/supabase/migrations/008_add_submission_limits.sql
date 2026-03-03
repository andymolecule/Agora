alter table challenges
add column if not exists max_submissions_total integer;

alter table challenges
add column if not exists max_submissions_per_solver integer;

update challenges
set
  max_submissions_total = coalesce(max_submissions_total, 100),
  max_submissions_per_solver = coalesce(max_submissions_per_solver, 3);

create index if not exists idx_challenges_max_submissions_total
on challenges(max_submissions_total);
