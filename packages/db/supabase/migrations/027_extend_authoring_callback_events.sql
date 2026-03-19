alter table authoring_callback_deliveries
  drop constraint if exists authoring_callback_deliveries_event_check;

alter table authoring_callback_deliveries
  add constraint authoring_callback_deliveries_event_check
    check (
      event in (
        'draft_updated',
        'draft_compiled',
        'draft_compile_failed',
        'draft_published',
        'challenge_created',
        'challenge_finalized'
      )
    );
