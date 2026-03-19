create table if not exists authoring_source_links (
  provider text not null,
  external_id text not null,
  draft_id uuid not null references authoring_drafts(id) on delete cascade,
  external_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, external_id),
  unique (draft_id)
);

insert into authoring_source_links (
  provider,
  external_id,
  draft_id,
  external_url
)
select
  authoring_ir_json->'origin'->>'provider',
  authoring_ir_json->'origin'->>'external_id',
  id,
  authoring_ir_json->'origin'->>'external_url'
from authoring_drafts
where coalesce(authoring_ir_json->'origin'->>'provider', '') <> ''
  and authoring_ir_json->'origin'->>'provider' <> 'direct'
  and coalesce(authoring_ir_json->'origin'->>'external_id', '') <> ''
on conflict (provider, external_id) do update
set
  draft_id = excluded.draft_id,
  external_url = excluded.external_url,
  updated_at = now();
