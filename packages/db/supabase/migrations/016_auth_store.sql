create table if not exists auth_nonces (
  nonce text primary key,
  purpose text not null,
  address text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_nonces_purpose_expires
  on auth_nonces(purpose, expires_at desc);

create index if not exists idx_auth_nonces_address
  on auth_nonces(address);

create table if not exists auth_sessions (
  token_hash text primary key,
  address text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_sessions_address
  on auth_sessions(address);

create index if not exists idx_auth_sessions_expires
  on auth_sessions(expires_at desc);
