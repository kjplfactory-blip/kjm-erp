-- KHUSHALI JEWELLS MANUFACTURING ERP v501
-- Selective recovery of the four confirmed Factory Out postings from the
-- protected version-v499-before-v500 backup.
--
-- This script preserves current orders, lots, stock, designs, catalogue,
-- customers, users, transfers, and all non-bill Factory Ledger entries.
-- It first creates a fresh backup of the current live row.

begin;

do $$
begin
  if not exists (
    select 1
    from public.erp_state_backups
    where state_id = 'khushali-jewells-main'
      and backup_key = 'version-v499-before-v500'
  ) then
    raise exception 'Required backup version-v499-before-v500 was not found. No data was changed.';
  end if;
end $$;

insert into public.erp_state_backups (
  id,
  state_id,
  backup_key,
  backup_kind,
  source_version,
  target_version,
  source_updated_at,
  profile,
  data,
  created_at
)
select
  'sql-' || md5(s.id || clock_timestamp()::text || random()::text),
  s.id,
  'manual-v501-before-factory-out-repair-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
  'manual',
  coalesce(nullif(s.data->>'appVersion', ''), 'unknown'),
  'v501',
  s.updated_at,
  jsonb_build_object(
    'orders', case when jsonb_typeof(s.data->'orders') = 'array' then jsonb_array_length(s.data->'orders') else 0 end,
    'lots', case when jsonb_typeof(s.data->'lots') = 'array' then jsonb_array_length(s.data->'lots') else 0 end,
    'bills', case when jsonb_typeof(s.data->'bills') = 'array' then jsonb_array_length(s.data->'bills') else 0 end,
    'factoryEntries', case when jsonb_typeof(s.data->'factoryLedger') = 'array' then jsonb_array_length(s.data->'factoryLedger') else 0 end
  ),
  s.data,
  clock_timestamp()
from public.erp_state s
where s.id = 'khushali-jewells-main'
  and s.data is not null;

with protected_backup as (
  select data
  from public.erp_state_backups
  where state_id = 'khushali-jewells-main'
    and backup_key = 'version-v499-before-v500'
  order by created_at desc
  limit 1
),
live_row as (
  select s.id, s.data
  from public.erp_state s
  where s.id = 'khushali-jewells-main'
  for update
),
repaired_bills as (
  select coalesce(jsonb_agg(
    case
      when nullif(current_bill.value->>'factoryOutPostedAt', '') is null
        and nullif(backup_bill.value->>'factoryOutPostedAt', '') is not null
      then current_bill.value || jsonb_strip_nulls(jsonb_build_object(
        'factoryOutWstgPercent', backup_bill.value->'factoryOutWstgPercent',
        'factoryOutPostedAt', backup_bill.value->'factoryOutPostedAt',
        'factoryOutUpdatedAt', backup_bill.value->'factoryOutUpdatedAt'
      ))
      else current_bill.value
    end
    order by current_bill.ordinality
  ), '[]'::jsonb) as bills
  from live_row l
  cross join protected_backup b
  cross join lateral jsonb_array_elements(coalesce(l.data->'bills', '[]'::jsonb))
    with ordinality as current_bill(value, ordinality)
  left join lateral (
    select value
    from jsonb_array_elements(coalesce(b.data->'bills', '[]'::jsonb)) as source_bill(value)
    where source_bill.value->>'id' = current_bill.value->>'id'
    limit 1
  ) as backup_bill on true
),
merged_factory_ledger as (
  select coalesce(jsonb_agg(entry order by sort_order), '[]'::jsonb) as ledger
  from (
    select current_entry.value as entry, current_entry.ordinality as sort_order
    from live_row l
    cross join lateral jsonb_array_elements(coalesce(l.data->'factoryLedger', '[]'::jsonb))
      with ordinality as current_entry(value, ordinality)

    union all

    select backup_entry.value as entry, 100000 + backup_entry.ordinality as sort_order
    from live_row l
    cross join protected_backup b
    cross join lateral jsonb_array_elements(coalesce(b.data->'factoryLedger', '[]'::jsonb))
      with ordinality as backup_entry(value, ordinality)
    where backup_entry.value->>'sourceType' = 'bill'
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(l.data->'factoryLedger', '[]'::jsonb)) as existing(value)
        where existing.value->>'sourceType' = 'bill'
          and existing.value->>'sourceId' = backup_entry.value->>'sourceId'
      )
  ) combined
)
update public.erp_state s
set data = jsonb_set(
      jsonb_set(s.data, '{bills}', repaired_bills.bills, true),
      '{factoryLedger}', merged_factory_ledger.ledger, true
    ),
    updated_at = clock_timestamp()
from repaired_bills, merged_factory_ledger
where s.id = 'khushali-jewells-main';

notify pgrst, 'reload schema';

commit;

select
  updated_at,
  coalesce(jsonb_array_length(data->'bills'), 0) as bills,
  (
    select count(*)
    from jsonb_array_elements(coalesce(data->'bills', '[]'::jsonb)) as bill(value)
    where nullif(bill.value->>'factoryOutPostedAt', '') is not null
  ) as posted_bills,
  (
    select count(*)
    from jsonb_array_elements(coalesce(data->'factoryLedger', '[]'::jsonb)) as entry(value)
    where entry.value->>'sourceType' = 'bill'
  ) as factory_out_bill_rows
from public.erp_state
where id = 'khushali-jewells-main';
