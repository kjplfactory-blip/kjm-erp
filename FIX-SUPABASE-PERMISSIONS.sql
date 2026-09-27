-- KHUSHALI JEWELLS MANUFACTURING ERP v475
-- Safe live-sync permission repair.
-- Run the complete file in Supabase Dashboard > SQL Editor.
-- This script does not delete or replace the saved ERP data row.

begin;

create table if not exists public.erp_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.erp_state to anon, authenticated;

alter table public.erp_state enable row level security;

drop policy if exists "Allow ERP read" on public.erp_state;
drop policy if exists "Allow ERP write" on public.erp_state;
drop policy if exists "Allow ERP state access" on public.erp_state;

create policy "Allow ERP state access"
on public.erp_state
for all
to anon, authenticated
using (id = 'khushali-jewells-main' or id like 'khushali-jewells-main-safety-%')
with check (id = 'khushali-jewells-main' or id like 'khushali-jewells-main-safety-%');

alter table public.erp_state replica identity full;

-- Automatic version and daily backups are stored separately and are append-only.
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

-- Design, stone-chart, and catalogue images are stored separately from ERP data.
insert into storage.buckets (id, name, public)
values ('design-images', 'design-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Allow design image read" on storage.objects;
drop policy if exists "Allow design image write" on storage.objects;

create policy "Allow design image read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'design-images');

create policy "Allow design image write"
on storage.objects
for all
to anon, authenticated
using (bucket_id = 'design-images')
with check (bucket_id = 'design-images');

notify pgrst, 'reload schema';

commit;

-- All six result columns must show true.
select
  has_schema_privilege('anon', 'public', 'usage') as anon_schema_usage,
  has_table_privilege('anon', 'public.erp_state', 'select')
    and has_table_privilege('anon', 'public.erp_state', 'insert')
    and has_table_privilege('anon', 'public.erp_state', 'update')
    and has_table_privilege('anon', 'public.erp_state', 'delete') as anon_table_access,
  has_schema_privilege('authenticated', 'public', 'usage') as authenticated_schema_usage,
  has_table_privilege('authenticated', 'public.erp_state', 'select')
    and has_table_privilege('authenticated', 'public.erp_state', 'insert')
    and has_table_privilege('authenticated', 'public.erp_state', 'update')
    and has_table_privilege('authenticated', 'public.erp_state', 'delete') as authenticated_table_access,
  has_table_privilege('anon', 'public.erp_state_backups', 'select')
    and has_table_privilege('anon', 'public.erp_state_backups', 'insert') as anon_backup_access,
  has_table_privilege('authenticated', 'public.erp_state_backups', 'select')
    and has_table_privilege('authenticated', 'public.erp_state_backups', 'insert') as authenticated_backup_access;
