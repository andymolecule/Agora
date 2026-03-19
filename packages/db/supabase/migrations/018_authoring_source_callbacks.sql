alter table posting_sessions
  add column if not exists source_callback_url text,
  add column if not exists source_callback_registered_at timestamptz;
