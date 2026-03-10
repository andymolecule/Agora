create table if not exists worker_runtime_state (
  worker_id text primary key,
  worker_type text not null,
  host text,
  ready boolean not null default false,
  docker_ready boolean not null default false,
  seal_enabled boolean not null default false,
  seal_key_id text,
  seal_self_check_ok boolean not null default false,
  last_error text,
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_runtime_state_worker_type_check
    check (worker_type in ('scoring'))
);

create index if not exists idx_worker_runtime_state_type_heartbeat
  on worker_runtime_state(worker_type, last_heartbeat_at desc);

alter table if exists worker_runtime_state enable row level security;
