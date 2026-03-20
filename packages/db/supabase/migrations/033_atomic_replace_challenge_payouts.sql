create or replace function replace_challenge_payouts(
  p_challenge_id uuid,
  p_payouts jsonb default '[]'::jsonb
)
returns table (
  challenge_id uuid,
  solver_address text,
  winning_on_chain_sub_id bigint,
  rank integer,
  amount numeric(20, 6),
  claimed_at timestamptz,
  claim_tx_hash text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
as $$
begin
  delete from challenge_payouts
  where challenge_id = p_challenge_id;

  if p_payouts is null
     or jsonb_typeof(p_payouts) <> 'array'
     or jsonb_array_length(p_payouts) = 0 then
    return;
  end if;

  return query
  insert into challenge_payouts (
    challenge_id,
    solver_address,
    winning_on_chain_sub_id,
    rank,
    amount,
    claimed_at,
    claim_tx_hash
  )
  select
    p_challenge_id,
    lower(row_payload.solver_address),
    row_payload.winning_on_chain_sub_id,
    row_payload.rank,
    row_payload.amount,
    row_payload.claimed_at,
    row_payload.claim_tx_hash
  from jsonb_to_recordset(p_payouts) as row_payload(
    solver_address text,
    winning_on_chain_sub_id bigint,
    rank integer,
    amount numeric(20, 6),
    claimed_at timestamptz,
    claim_tx_hash text
  )
  returning
    challenge_payouts.challenge_id,
    challenge_payouts.solver_address,
    challenge_payouts.winning_on_chain_sub_id,
    challenge_payouts.rank,
    challenge_payouts.amount,
    challenge_payouts.claimed_at,
    challenge_payouts.claim_tx_hash,
    challenge_payouts.created_at,
    challenge_payouts.updated_at;
end;
$$;
