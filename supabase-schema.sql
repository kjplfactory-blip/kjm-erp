create table if not exists public.erp_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.erp_state enable row level security;

drop policy if exists "Allow ERP read" on public.erp_state;
drop policy if exists "Allow ERP write" on public.erp_state;

create policy "Allow ERP read"
on public.erp_state
for select
to anon, authenticated
using (true);

create policy "Allow ERP write"
on public.erp_state
for all
to anon, authenticated
using (true)
with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.erp_state to anon, authenticated;

alter table public.erp_state replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'erp_state'
  ) then
    alter publication supabase_realtime add table public.erp_state;
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('design-images', 'design-images', true)
on conflict (id) do nothing;

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

-- Automatic version and daily ERP backups. Website roles can append and read,
-- but cannot alter or delete an existing backup.
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

notify pgrst, 'reload schema';
