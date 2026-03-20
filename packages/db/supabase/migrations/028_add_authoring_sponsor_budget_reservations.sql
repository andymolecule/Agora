create table if not exists authoring_sponsor_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references authoring_drafts(id) on delete cascade,
  provider text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount_usdc numeric(20, 6) not null,
  status text not null default 'reserved',
  tx_hash text,
  challenge_id uuid references challenges(id) on delete set null,
  reserved_at timestamptz not null default now(),
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint authoring_sponsor_budget_reservations_status_check
    check (status in ('reserved', 'consumed', 'released')),
  constraint authoring_sponsor_budget_reservations_amount_check
    check (amount_usdc > 0),
  constraint authoring_sponsor_budget_reservations_provider_check
    check (length(btrim(provider)) > 0),
  constraint authoring_sponsor_budget_reservations_period_check
    check (period_end > period_start)
);

create index if not exists idx_authoring_sponsor_budget_reservations_period
  on authoring_sponsor_budget_reservations(provider, period_start, period_end, status);

create index if not exists idx_authoring_sponsor_budget_reservations_tx_hash
  on authoring_sponsor_budget_reservations(tx_hash);

create or replace function reserve_authoring_sponsor_budget(
  p_draft_id uuid,
  p_provider text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_amount_usdc numeric,
  p_budget_limit_usdc numeric
)
returns authoring_sponsor_budget_reservations
language plpgsql
as $$
declare
  v_reservation authoring_sponsor_budget_reservations;
  v_consumed numeric(20, 6);
  v_reserved numeric(20, 6);
begin
  if p_amount_usdc is null or p_amount_usdc <= 0 then
    raise exception
      'Authoring sponsor budget reservation amount must be positive.'
      using errcode = '22003';
  end if;

  if p_budget_limit_usdc is null or p_budget_limit_usdc <= 0 then
    raise exception
      'Authoring sponsor budget limit must be positive.'
      using errcode = '22003';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      lower(coalesce(p_provider, '')) || '|' || p_period_start::text || '|' || p_period_end::text,
      0
    )
  );

  select *
  into v_reservation
  from authoring_sponsor_budget_reservations
  where draft_id = p_draft_id
  for update;

  if found and v_reservation.status = 'consumed' then
    return v_reservation;
  end if;

  if found then
    update authoring_sponsor_budget_reservations
    set
      provider = p_provider,
      period_start = p_period_start,
      period_end = p_period_end,
      amount_usdc = p_amount_usdc,
      status = 'reserved',
      released_at = null,
      updated_at = now()
    where draft_id = p_draft_id
    returning * into v_reservation;
  else
    insert into authoring_sponsor_budget_reservations (
      draft_id,
      provider,
      period_start,
      period_end,
      amount_usdc,
      status
    )
    values (
      p_draft_id,
      p_provider,
      p_period_start,
      p_period_end,
      p_amount_usdc,
      'reserved'
    )
    returning * into v_reservation;
  end if;

  select coalesce(sum(reward_amount), 0)
  into v_consumed
  from challenges
  where source_provider = p_provider
    and created_at >= p_period_start
    and created_at < p_period_end;

  select coalesce(sum(amount_usdc), 0)
  into v_reserved
  from authoring_sponsor_budget_reservations
  where provider = p_provider
    and period_start = p_period_start
    and period_end = p_period_end
    and status = 'reserved'
    and draft_id <> p_draft_id;

  if v_consumed + v_reserved + v_reservation.amount_usdc > p_budget_limit_usdc then
    raise exception
      'Agora sponsor budget for provider % would be exceeded. Next step: lower the reward, wait for the next budget window, or raise the sponsor cap and retry.',
      p_provider
      using errcode = 'P0001';
  end if;

  return v_reservation;
end;
$$;
