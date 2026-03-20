create table if not exists authoring_sponsor_budget_reservations (
  draft_id uuid primary key references authoring_drafts(id) on delete cascade,
  provider text not null,
  period_start timestamptz not null,
  amount_usdc numeric(20, 6) not null,
  status text not null default 'reserved',
  reserved_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint authoring_sponsor_budget_reservations_provider_check
    check (provider in ('beach_science', 'github', 'slack', 'lab_portal')),
  constraint authoring_sponsor_budget_reservations_amount_check
    check (amount_usdc > 0),
  constraint authoring_sponsor_budget_reservations_status_check
    check (status in ('reserved', 'consumed', 'released')),
  constraint authoring_sponsor_budget_reservations_period_start_check
    check (date_trunc('month', period_start) = period_start)
);

create index if not exists idx_authoring_sponsor_budget_reservations_window
  on authoring_sponsor_budget_reservations(provider, period_start, status);

insert into authoring_sponsor_budget_reservations (
  draft_id,
  provider,
  period_start,
  amount_usdc,
  status,
  reserved_at,
  consumed_at,
  created_at,
  updated_at
)
select
  published_challenge_links.draft_id,
  challenges.source_provider,
  date_trunc(
    'month',
    coalesce(published_challenge_links.published_at, challenges.created_at)
  ),
  challenges.reward_amount,
  'consumed',
  coalesce(published_challenge_links.published_at, challenges.created_at),
  coalesce(published_challenge_links.published_at, challenges.created_at),
  challenges.created_at,
  challenges.updated_at
from published_challenge_links
inner join challenges
  on challenges.id = published_challenge_links.challenge_id
where challenges.source_provider in ('beach_science', 'github', 'slack', 'lab_portal')
on conflict (draft_id) do nothing;

create or replace function reserve_authoring_sponsor_budget(
  p_draft_id uuid,
  p_provider text,
  p_period_start timestamptz,
  p_amount_usdc numeric(20, 6),
  p_budget_usdc numeric(20, 6)
)
returns table (
  reserved boolean,
  total_allocated_usdc numeric(20, 6)
)
language plpgsql
as $$
declare
  v_period_start timestamptz := date_trunc('month', p_period_start);
  v_existing authoring_sponsor_budget_reservations%rowtype;
  v_current_allocated numeric(20, 6);
begin
  if p_amount_usdc <= 0 or p_budget_usdc <= 0 then
    raise exception 'Authoring sponsor budget reservations require positive amount and budget values.';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_provider || ':' || v_period_start::text));

  select *
  into v_existing
  from authoring_sponsor_budget_reservations
  where draft_id = p_draft_id
  for update;

  if found then
    if
      v_existing.provider <> p_provider or
      v_existing.period_start <> v_period_start or
      v_existing.amount_usdc <> p_amount_usdc
    then
      raise exception 'Existing authoring sponsor budget reservation does not match the requested reservation.';
    end if;

    select coalesce(sum(amount_usdc), 0)
    into v_current_allocated
    from authoring_sponsor_budget_reservations
    where provider = p_provider
      and period_start = v_period_start
      and status in ('reserved', 'consumed');

    if v_existing.status in ('reserved', 'consumed') then
      return query
      select true, v_current_allocated;
      return;
    end if;
  end if;

  select coalesce(sum(amount_usdc), 0)
  into v_current_allocated
  from authoring_sponsor_budget_reservations
  where provider = p_provider
    and period_start = v_period_start
    and status in ('reserved', 'consumed')
    and draft_id <> p_draft_id;

  if v_current_allocated + p_amount_usdc > p_budget_usdc then
    return query
    select false, v_current_allocated;
    return;
  end if;

  insert into authoring_sponsor_budget_reservations (
    draft_id,
    provider,
    period_start,
    amount_usdc,
    status,
    reserved_at,
    consumed_at,
    released_at,
    release_reason,
    updated_at
  )
  values (
    p_draft_id,
    p_provider,
    v_period_start,
    p_amount_usdc,
    'reserved',
    now(),
    null,
    null,
    null,
    now()
  )
  on conflict (draft_id) do update
    set provider = excluded.provider,
        period_start = excluded.period_start,
        amount_usdc = excluded.amount_usdc,
        status = 'reserved',
        reserved_at = now(),
        consumed_at = null,
        released_at = null,
        release_reason = null,
        updated_at = now();

  return query
  select true, v_current_allocated + p_amount_usdc;
end;
$$;
