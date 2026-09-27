-- KHUSHALI JEWELLS ERP v479 - READ-ONLY CLOUD DATA CHECK
-- Safe to run at any time. This file contains SELECT statements only.
-- It cannot update, delete, insert, truncate, or replace ERP data.

select
  to_regclass('public.erp_state') is not null as live_table_exists,
  to_regclass('public.erp_state_backups') is not null as backup_table_exists;

select
  id,
  updated_at,
  coalesce(nullif(data->>'appVersion', ''), 'unknown') as app_version,
  case when jsonb_typeof(data->'orders') = 'array' then jsonb_array_length(data->'orders') else 0 end as orders,
  case when jsonb_typeof(data->'lots') = 'array' then jsonb_array_length(data->'lots') else 0 end as lots,
  case when jsonb_typeof(data->'designs') = 'array' then jsonb_array_length(data->'designs') else 0 end as designs,
  case when jsonb_typeof(data->'customers') = 'array' then jsonb_array_length(data->'customers') else 0 end as customers,
  case when jsonb_typeof(data->'bills') = 'array' then jsonb_array_length(data->'bills') else 0 end as bills,
  case when jsonb_typeof(data->'safeItems') = 'array' then jsonb_array_length(data->'safeItems') else 0 end as safe_items,
  case when jsonb_typeof(data->'factoryLedger') = 'array' then jsonb_array_length(data->'factoryLedger') else 0 end as factory_entries,
  case when jsonb_typeof(data->'metalSafeMovements') = 'array' then jsonb_array_length(data->'metalSafeMovements') else 0 end as metal_entries,
  case when jsonb_typeof(data->'productionNonGoldIssues') = 'array' then jsonb_array_length(data->'productionNonGoldIssues') else 0 end as non_gold_entries
from public.erp_state
where id = 'khushali-jewells-main';
