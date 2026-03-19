create table if not exists authoring_callback_deliveries (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references posting_sessions(id) on delete cascade,
  provider text not null,
  callback_url text not null,
  event text not null,
  payload_json jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_attempt_at timestamptz null,
  next_attempt_at timestamptz not null default now(),
  delivered_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint authoring_callback_deliveries_provider_check
    check (provider in ('beach_science', 'github', 'slack', 'lab_portal')),
  constraint authoring_callback_deliveries_event_check
    check (
      event in (
        'draft_updated',
        'draft_compiled',
        'draft_compile_failed',
        'draft_published'
      )
    ),
  constraint authoring_callback_deliveries_status_check
    check (status in ('pending', 'delivering', 'delivered', 'exhausted')),
  constraint authoring_callback_deliveries_attempts_check
    check (attempts >= 0),
  constraint authoring_callback_deliveries_max_attempts_check
    check (max_attempts >= 1)
);

create index if not exists idx_authoring_callback_deliveries_due
  on authoring_callback_deliveries(status, next_attempt_at);

create index if not exists idx_authoring_callback_deliveries_draft
  on authoring_callback_deliveries(draft_id);
