-- KHUSHALI JEWELLS ERP v637 - FASTER, ATOMIC SUPABASE SAVES
-- Run this file once in Supabase Dashboard > SQL Editor.
-- It does not clear, reset, replace, or delete ERP data.

-- Supabase Data API roles normally have short statement limits. The ERP state is
-- a large JSON record, so allow enough time for a safe write to finish.
alter role anon set statement_timeout = '60s';
alter role authenticated set statement_timeout = '60s';

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

grant usage on schema public to anon, authenticated;
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

  update public.erp_state
  set data = p_data,
      updated_at = p_updated_at
  where id = p_state_id
    and updated_at = v_current_updated_at;

  get diagnostics v_saved_rows = row_count;
  return query select v_saved_rows = 1, case when v_saved_rows = 1 then p_updated_at else v_current_updated_at end, nullif(trim(p_backup_key), '') is not null;
end;
$$;

revoke all on function public.save_erp_state_atomic(text, jsonb, timestamptz, timestamptz, text, text, text, text, jsonb) from public;
grant execute on function public.save_erp_state_atomic(text, jsonb, timestamptz, timestamptz, text, text, text, text, jsonb) to anon, authenticated;

analyze public.erp_state;
analyze public.erp_state_backups;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- Verification result: anon/authenticated should show statement_timeout=60s.
select rolname, rolconfig
from pg_roles
where rolname in ('anon', 'authenticated')
order by rolname;

-- Verification result: one row showing current ERP size and version.
select
  id,
  updated_at,
  pg_size_pretty(pg_column_size(data)::bigint) as state_json_size,
  coalesce(data ->> 'appVersion', 'unknown') as app_version
from public.erp_state
where id = 'khushali-jewells-main';
