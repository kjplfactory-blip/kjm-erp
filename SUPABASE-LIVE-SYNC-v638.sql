-- KHUSHALI JEWELLS ERP v638 - RELIABLE MULTI-LAPTOP LIVE SYNC
-- Run this file once in Supabase Dashboard > SQL Editor.
-- This setup is non-destructive: it does not reset, delete, or replace ERP data.

alter role anon set statement_timeout = '60s';
alter role authenticated set statement_timeout = '60s';

-- This tiny row is used for polling and Realtime notifications. The full ERP
-- JSON is downloaded only after the revision changes.
create table if not exists public.erp_sync_signal (
  id text primary key,
  updated_at timestamptz not null default clock_timestamp(),
  app_version text not null default 'unknown'
);

grant usage on schema public to anon, authenticated;
grant select on table public.erp_sync_signal to anon, authenticated;
revoke insert, update, delete, truncate on table public.erp_sync_signal from anon, authenticated;

alter table public.erp_sync_signal enable row level security;

drop policy if exists "Allow ERP sync signal read" on public.erp_sync_signal;
create policy "Allow ERP sync signal read"
on public.erp_sync_signal
for select
to anon, authenticated
using (id = 'khushali-jewells-main');

insert into public.erp_sync_signal (id, updated_at, app_version)
select id, updated_at, coalesce(data ->> 'appVersion', 'unknown')
from public.erp_state
where id = 'khushali-jewells-main'
on conflict (id) do update
set updated_at = greatest(public.erp_sync_signal.updated_at, excluded.updated_at),
    app_version = excluded.app_version;

-- Keep revisions strictly increasing even when an older laptop has a slow or
-- inaccurate system clock.
create or replace function public.ensure_erp_state_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := greatest(
      clock_timestamp(),
      coalesce(new.updated_at, clock_timestamp()),
      old.updated_at + interval '1 millisecond'
    );
  else
    new.updated_at := greatest(clock_timestamp(), coalesce(new.updated_at, clock_timestamp()));
  end if;
  return new;
end;
$$;

drop trigger if exists erp_state_ensure_revision on public.erp_state;
create trigger erp_state_ensure_revision
before insert or update of data, updated_at on public.erp_state
for each row execute function public.ensure_erp_state_revision();

-- Every writer, including an older ERP build, now updates the lightweight
-- signal automatically whenever the main ERP row changes.
create or replace function public.touch_erp_sync_signal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.erp_sync_signal (id, updated_at, app_version)
  values (
    new.id,
    new.updated_at,
    coalesce(new.data ->> 'appVersion', 'unknown')
  )
  on conflict (id) do update
  set updated_at = excluded.updated_at,
      app_version = excluded.app_version;
  return new;
end;
$$;

drop trigger if exists erp_state_touch_sync_signal on public.erp_state;
create trigger erp_state_touch_sync_signal
after insert or update of data, updated_at on public.erp_state
for each row execute function public.touch_erp_sync_signal();

-- Postgres Changes now carries only id/version/time instead of the complete
-- ERP JSON record to every connected laptop.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'erp_sync_signal'
  ) then
    alter publication supabase_realtime add table public.erp_sync_signal;
  end if;
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'erp_state'
  ) then
    alter publication supabase_realtime drop table public.erp_state;
  end if;
end;
$$;

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

create unique index if not exists erp_state_backups_state_key_uidx
on public.erp_state_backups (state_id, backup_key);

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

-- The row lock, cloud revision check, backup, and write happen in one
-- transaction. The database chooses a strictly increasing revision time.
create or replace function public.save_erp_state_atomic(
  p_state_id text,
  p_data jsonb,
  p_expected_updated_at timestamptz,
  p_updated_at timestamptz,
  p_backup_key text,
  p_backup_kind text,
  p_source_version text,
  p_target_version text,
  p_profile jsonb
)
returns table (
  saved boolean,
  current_updated_at timestamptz,
  backup_ready boolean
)
language plpgsql
security definer
set search_path = public
set lock_timeout = '8s'
set statement_timeout = '55s'
as $$
declare
  v_current_data jsonb;
  v_current_updated_at timestamptz;
  v_saved_updated_at timestamptz;
  v_saved_rows integer := 0;
begin
  select data, updated_at
  into v_current_data, v_current_updated_at
  from public.erp_state
  where id = p_state_id
  for update;

  if not found then
    return query select false, null::timestamptz, false;
    return;
  end if;

  if p_expected_updated_at is null or v_current_updated_at <> p_expected_updated_at then
    return query select false, v_current_updated_at, false;
    return;
  end if;

  if nullif(trim(p_backup_key), '') is not null then
    insert into public.erp_state_backups (
      id, state_id, backup_key, backup_kind, source_version,
      target_version, source_updated_at, profile, data, created_at
    ) values (
      md5(p_state_id || ':' || p_backup_key),
      p_state_id,
      p_backup_key,
      case when p_backup_kind in ('version-upgrade', 'daily', 'manual') then p_backup_kind else 'daily' end,
      coalesce(nullif(p_source_version, ''), 'unknown'),
      coalesce(nullif(p_target_version, ''), 'unknown'),
      v_current_updated_at,
      coalesce(p_profile, '{}'::jsonb),
      v_current_data,
      clock_timestamp()
    )
    on conflict (state_id, backup_key) do nothing;
  end if;

  v_saved_updated_at := greatest(
    clock_timestamp(),
    coalesce(p_updated_at, clock_timestamp()),
    v_current_updated_at + interval '1 millisecond'
  );

  update public.erp_state
  set data = p_data,
      updated_at = v_saved_updated_at
  where id = p_state_id
    and updated_at = v_current_updated_at
  returning updated_at into v_saved_updated_at;

  get diagnostics v_saved_rows = row_count;
  return query select
    v_saved_rows = 1,
    case when v_saved_rows = 1 then v_saved_updated_at else v_current_updated_at end,
    nullif(trim(p_backup_key), '') is not null;
end;
$$;

revoke all on function public.save_erp_state_atomic(text, jsonb, timestamptz, timestamptz, text, text, text, text, jsonb) from public;
grant execute on function public.save_erp_state_atomic(text, jsonb, timestamptz, timestamptz, text, text, text, text, jsonb) to anon, authenticated;

analyze public.erp_state;
analyze public.erp_sync_signal;
analyze public.erp_state_backups;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- Verification: one small signal row and one live ERP row should be returned.
select id, updated_at, app_version
from public.erp_sync_signal
where id = 'khushali-jewells-main';

select
  id,
  updated_at,
  pg_size_pretty(pg_column_size(data)::bigint) as state_json_size,
  coalesce(data ->> 'appVersion', 'unknown') as app_version
from public.erp_state
where id = 'khushali-jewells-main';
