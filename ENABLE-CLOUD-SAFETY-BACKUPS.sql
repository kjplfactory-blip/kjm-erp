-- KHUSHALI JEWELLS MANUFACTURING ERP v479
-- One-time setup for automatic, append-only cloud backups.
-- This script NEVER updates, deletes, truncates, or replaces public.erp_state.
-- It creates a protected snapshot of the current live row before finishing setup.

begin;

create table if not exists public.erp_state_backups (
  id text primary key,
  state_id text not null,
  backup_key text not null,
  backup_kind text not null check (backup_kind in ('version-upgrade', 'daily', 'manual')),
  source_version text not null default 'unknown',
  target_version text not null default 'unknown',
  source_updated_at timestamptz,
  profile jsonb not null default '{}'::jsonb,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (state_id, backup_key)
);

create index if not exists erp_state_backups_state_created_idx
on public.erp_state_backups (state_id, created_at desc);

grant usage on schema public to anon, authenticated;
grant select, insert on table public.erp_state_backups to anon, authenticated;
revoke update, delete, truncate on table public.erp_state_backups from anon, authenticated;

alter table public.erp_state_backups enable row level security;

drop policy if exists "Allow ERP backup read" on public.erp_state_backups;
drop policy if exists "Allow ERP backup insert" on public.erp_state_backups;
drop policy if exists "Allow ERP backup update" on public.erp_state_backups;
drop policy if exists "Allow ERP backup delete" on public.erp_state_backups;

create policy "Allow ERP backup read"
on public.erp_state_backups
for select
to anon, authenticated
using (state_id = 'khushali-jewells-main');

create policy "Allow ERP backup insert"
on public.erp_state_backups
for insert
to anon, authenticated
with check (state_id = 'khushali-jewells-main');

-- Preserve the current live ERP row immediately. Re-running this setup creates
-- another uniquely named SQL safety snapshot; public.erp_state remains untouched.
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
  'manual-sql-safety-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
  'manual',
  coalesce(nullif(s.data->>'appVersion', ''), 'unknown'),
  'v592',
  s.updated_at,
  jsonb_build_object(
    'orders', case when jsonb_typeof(s.data->'orders') = 'array' then jsonb_array_length(s.data->'orders') else 0 end,
    'lots', case when jsonb_typeof(s.data->'lots') = 'array' then jsonb_array_length(s.data->'lots') else 0 end,
    'designs', case when jsonb_typeof(s.data->'designs') = 'array' then jsonb_array_length(s.data->'designs') else 0 end,
    'bills', case when jsonb_typeof(s.data->'bills') = 'array' then jsonb_array_length(s.data->'bills') else 0 end,
    'safeItems', case when jsonb_typeof(s.data->'safeItems') = 'array' then jsonb_array_length(s.data->'safeItems') else 0 end
  ),
  s.data,
  clock_timestamp()
from public.erp_state s
where s.id = 'khushali-jewells-main'
  and s.data is not null
on conflict (state_id, backup_key) do nothing;

notify pgrst, 'reload schema';

commit;

-- Both checks must show true.
select
  has_table_privilege('anon', 'public.erp_state_backups', 'select')
    and has_table_privilege('anon', 'public.erp_state_backups', 'insert') as anon_backup_access,
  has_table_privilege('authenticated', 'public.erp_state_backups', 'select')
    and has_table_privilege('authenticated', 'public.erp_state_backups', 'insert') as authenticated_backup_access;

-- The live row summary must remain present after this script.
select
  id,
  updated_at,
  coalesce(nullif(data->>'appVersion', ''), 'unknown') as app_version,
  case when jsonb_typeof(data->'orders') = 'array' then jsonb_array_length(data->'orders') else 0 end as orders,
  case when jsonb_typeof(data->'lots') = 'array' then jsonb_array_length(data->'lots') else 0 end as lots,
  case when jsonb_typeof(data->'designs') = 'array' then jsonb_array_length(data->'designs') else 0 end as designs,
  case when jsonb_typeof(data->'bills') = 'array' then jsonb_array_length(data->'bills') else 0 end as bills,
  case when jsonb_typeof(data->'safeItems') = 'array' then jsonb_array_length(data->'safeItems') else 0 end as safe_items
from public.erp_state
where id = 'khushali-jewells-main';

-- Existing backups, including this run's SQL safety snapshot, appear here.
select backup_kind, backup_key, source_version, target_version, source_updated_at, created_at, profile
from public.erp_state_backups
where state_id = 'khushali-jewells-main'
order by created_at desc;



