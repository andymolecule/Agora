create table if not exists authoring_callback_targets (
  draft_id uuid primary key references authoring_drafts(id) on delete cascade,
  callback_url text not null,
  registered_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into authoring_callback_targets (
  draft_id,
  callback_url,
  registered_at
)
select
  id,
  source_callback_url,
  coalesce(source_callback_registered_at, now())
from authoring_drafts
where source_callback_url is not null
on conflict (draft_id) do update
set
  callback_url = excluded.callback_url,
  registered_at = excluded.registered_at,
  updated_at = now();

alter table authoring_drafts
  drop column if exists source_callback_url,
  drop column if exists source_callback_registered_at;
