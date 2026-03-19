alter table challenges
  add column if not exists source_provider text,
  add column if not exists source_external_id text,
  add column if not exists source_external_url text,
  add column if not exists source_agent_handle text;

create index if not exists idx_challenges_source_provider_created_at
  on challenges(source_provider, created_at desc);

update challenges
set
  source_provider = published_challenge_links.published_spec_json->'source'->>'provider',
  source_external_id = published_challenge_links.published_spec_json->'source'->>'external_id',
  source_external_url = published_challenge_links.published_spec_json->'source'->>'external_url',
  source_agent_handle = published_challenge_links.published_spec_json->'source'->>'agent_handle'
from published_challenge_links
where published_challenge_links.challenge_id = challenges.id
  and challenges.source_provider is null;
