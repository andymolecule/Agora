alter table posting_sessions
  add column if not exists authoring_ir_json jsonb;
