alter table authoring_drafts
  add column if not exists source_callback_url text,
  add column if not exists source_callback_registered_at timestamptz,
  add column if not exists published_challenge_id uuid references challenges(id) on delete set null,
  add column if not exists published_spec_json jsonb,
  add column if not exists published_spec_cid text,
  add column if not exists published_return_to text,
  add column if not exists published_at timestamptz;

create index if not exists idx_authoring_drafts_published_challenge
  on authoring_drafts(published_challenge_id);

update authoring_drafts
set
  source_callback_url = authoring_callback_targets.callback_url,
  source_callback_registered_at = authoring_callback_targets.registered_at
from authoring_callback_targets
where authoring_callback_targets.draft_id = authoring_drafts.id
  and (
    authoring_drafts.source_callback_url is distinct from authoring_callback_targets.callback_url
    or authoring_drafts.source_callback_registered_at is distinct from authoring_callback_targets.registered_at
  );

update authoring_drafts
set
  published_challenge_id = published_challenge_links.challenge_id,
  published_spec_json = published_challenge_links.published_spec_json,
  published_spec_cid = published_challenge_links.published_spec_cid,
  published_return_to = published_challenge_links.return_to,
  published_at = published_challenge_links.published_at
from published_challenge_links
where published_challenge_links.draft_id = authoring_drafts.id
  and (
    authoring_drafts.published_challenge_id is distinct from published_challenge_links.challenge_id
    or authoring_drafts.published_spec_json is distinct from published_challenge_links.published_spec_json
    or authoring_drafts.published_spec_cid is distinct from published_challenge_links.published_spec_cid
    or authoring_drafts.published_return_to is distinct from published_challenge_links.return_to
    or authoring_drafts.published_at is distinct from published_challenge_links.published_at
  );

drop table if exists authoring_callback_targets;
drop table if exists published_challenge_links;
