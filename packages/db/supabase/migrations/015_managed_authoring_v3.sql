create table if not exists posting_sessions (
  id uuid primary key default gen_random_uuid(),
  poster_address text,
  state text not null,
  intent_json jsonb,
  uploaded_artifacts_json jsonb not null default '[]'::jsonb,
  compilation_json jsonb,
  approved_confirmation_json jsonb,
  published_spec_json jsonb,
  published_spec_cid text,
  failure_message text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posting_sessions_state_check
    check (
      state in (
        'draft',
        'compiling',
        'ready',
        'published',
        'failed'
      )
    ),
  constraint posting_sessions_poster_address_lowercase_check
    check (
      poster_address is null
      or poster_address = lower(poster_address)
    )
);

create index if not exists idx_posting_sessions_state
  on posting_sessions(state);

create index if not exists idx_posting_sessions_expires_at
  on posting_sessions(expires_at);

create index if not exists idx_posting_sessions_poster
  on posting_sessions(poster_address);
