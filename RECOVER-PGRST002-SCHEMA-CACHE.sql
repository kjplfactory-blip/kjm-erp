-- KHUSHALI JEWELLS ERP v499
-- NON-DESTRUCTIVE SUPABASE PGRST002 SCHEMA-CACHE RECOVERY
-- Run in Supabase Dashboard > SQL Editor.
-- This file does not insert, update, delete, truncate, or replace ERP data.

-- Reading notification usage can refresh a stuck PostgREST notification path.
select pg_notification_queue_usage() as notification_queue_usage;

-- Confirm that the ERP's required public schema and tables still exist.
select
  to_regnamespace('public') is not null as public_schema_exists,
  to_regclass('public.erp_state') is not null as erp_state_exists,
  to_regclass('public.erp_state_backups') is not null as backup_table_exists;

-- Ask Supabase Data API to reload its configuration and schema cache.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- Read-only confirmation. This must return the live ERP row without changing it.
select id, updated_at
from public.erp_state
where id = 'khushali-jewells-main';
