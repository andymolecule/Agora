update authoring_drafts
set
  state = 'failed',
  failure_message = coalesce(
    nullif(failure_message, ''),
    'Managed authoring review was removed. Next step: resubmit the draft through /api/authoring/drafts/submit or switch to the explicit custom scorer workflow.'
  ),
  updated_at = now()
where state = 'needs_review';

alter table authoring_drafts
  drop constraint if exists authoring_drafts_state_check;

alter table authoring_drafts
  add constraint authoring_drafts_state_check
    check (
      state in (
        'draft',
        'compiling',
        'ready',
        'needs_clarification',
        'published',
        'failed'
      )
    );
