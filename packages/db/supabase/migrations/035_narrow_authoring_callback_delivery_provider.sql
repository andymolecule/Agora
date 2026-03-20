do $$
begin
  if exists (
    select 1
    from authoring_callback_deliveries
    where provider <> 'beach_science'
  ) then
    raise exception
      'authoring_callback_deliveries still contains legacy providers. Next step: delete those rows or reset the environment before applying migration 035.';
  end if;
end
$$;

alter table authoring_callback_deliveries
  drop constraint if exists authoring_callback_deliveries_provider_check;

alter table authoring_callback_deliveries
  add constraint authoring_callback_deliveries_provider_check
    check (provider in ('beach_science'));
