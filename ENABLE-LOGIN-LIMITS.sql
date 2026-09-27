-- KHUSHALI JEWELLS ERP v605
-- Run in Supabase SQL Editor after the project is healthy.
-- This can also repair a missing or stale v588 login-limit setup.
-- Owner, Manager and Setting Manager: 2 active devices. Every other user: 1 active device.

begin;

create table if not exists public.erp_user_sessions (
  state_id text not null,
  user_id text not null,
  device_id text not null,
  session_id text not null,
  user_name text not null default '',
  role text not null default '',
  app_version text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (state_id, user_id, device_id),
  unique (state_id, session_id)
);

create index if not exists erp_user_sessions_last_seen_idx
  on public.erp_user_sessions (state_id, user_id, last_seen_at);

alter table public.erp_user_sessions enable row level security;
revoke all on table public.erp_user_sessions from anon, authenticated;

-- Recreate only the three login RPCs so their parameter names and the
-- PostgREST schema cache exactly match the current website.
drop function if exists public.acquire_erp_user_session(text, text, text, text, text, text, text, integer);
drop function if exists public.touch_erp_user_session(text, text, text, text, integer);
drop function if exists public.release_erp_user_session(text, text, text, text);

create or replace function public.acquire_erp_user_session(
  p_state_id text,
  p_session_id text,
  p_user_id text,
  p_user_name text default '',
  p_role text default '',
  p_device_id text default '',
  p_app_version text default '',
  p_stale_after_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := case
    when lower(trim(coalesce(p_user_id, ''))) in ('owner', 'manager', 'settingmanager', 'setting-manager') then 2
    when lower(trim(coalesce(p_role, ''))) = 'setting-manager' then 2
    else 1
  end;
  v_active integer := 0;
  v_stale_seconds integer := least(greatest(coalesce(p_stale_after_seconds, 120), 60), 900);
begin
  if nullif(trim(coalesce(p_state_id, '')), '') is null
    or nullif(trim(coalesce(p_session_id, '')), '') is null
    or nullif(trim(coalesce(p_user_id, '')), '') is null
    or nullif(trim(coalesce(p_device_id, '')), '') is null then
    return jsonb_build_object(
      'allowed', false,
      'active_count', 0,
      'limit', v_limit,
      'message', 'Login session details are incomplete.'
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(p_state_id || ':' || lower(p_user_id)));

  delete from public.erp_user_sessions
  where state_id = p_state_id
    and user_id = p_user_id
    and last_seen_at < now() - make_interval(secs => v_stale_seconds);

  if exists (
    select 1
    from public.erp_user_sessions
    where state_id = p_state_id
      and user_id = p_user_id
      and device_id = p_device_id
  ) then
    update public.erp_user_sessions
    set session_id = p_session_id,
        user_name = coalesce(p_user_name, ''),
        role = coalesce(p_role, ''),
        app_version = coalesce(p_app_version, ''),
        last_seen_at = now()
    where state_id = p_state_id
      and user_id = p_user_id
      and device_id = p_device_id;

    select count(*)::integer into v_active
    from public.erp_user_sessions
    where state_id = p_state_id
      and user_id = p_user_id;

    return jsonb_build_object(
      'allowed', true,
      'active_count', v_active,
      'limit', v_limit,
      'message', 'Existing device login refreshed.'
    );
  end if;

  select count(*)::integer into v_active
  from public.erp_user_sessions
  where state_id = p_state_id
    and user_id = p_user_id;

  if v_active >= v_limit then
    return jsonb_build_object(
      'allowed', false,
      'active_count', v_active,
      'limit', v_limit,
      'message',
      case
        when v_limit = 1 then 'This user is already logged in on another device. Logout there or wait 15 minutes.'
        else 'This user is already logged in on 2 devices. Logout from one device or wait 15 minutes.'
      end
    );
  end if;

  insert into public.erp_user_sessions (
    state_id,
    user_id,
    device_id,
    session_id,
    user_name,
    role,
    app_version,
    created_at,
    last_seen_at
  ) values (
    p_state_id,
    p_user_id,
    p_device_id,
    p_session_id,
    coalesce(p_user_name, ''),
    coalesce(p_role, ''),
    coalesce(p_app_version, ''),
    now(),
    now()
  );

  v_active := v_active + 1;
  return jsonb_build_object(
    'allowed', true,
    'active_count', v_active,
    'limit', v_limit,
    'message', 'Login slot reserved.'
  );
end;
$$;

create or replace function public.touch_erp_user_session(
  p_state_id text,
  p_session_id text,
  p_user_id text,
  p_device_id text,
  p_stale_after_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_stale_seconds integer := least(greatest(coalesce(p_stale_after_seconds, 120), 60), 900);
begin
  update public.erp_user_sessions
  set last_seen_at = now()
  where state_id = p_state_id
    and user_id = p_user_id
    and device_id = p_device_id
    and session_id = p_session_id
    and last_seen_at >= now() - make_interval(secs => v_stale_seconds);

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.release_erp_user_session(
  p_state_id text,
  p_session_id text,
  p_user_id text,
  p_device_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.erp_user_sessions
  where state_id = p_state_id
    and user_id = p_user_id
    and device_id = p_device_id
    and session_id = p_session_id;

  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

revoke all on function public.acquire_erp_user_session(text, text, text, text, text, text, text, integer) from public;
revoke all on function public.touch_erp_user_session(text, text, text, text, integer) from public;
revoke all on function public.release_erp_user_session(text, text, text, text) from public;

grant execute on function public.acquire_erp_user_session(text, text, text, text, text, text, text, integer) to anon, authenticated;
grant execute on function public.touch_erp_user_session(text, text, text, text, integer) to anon, authenticated;
grant execute on function public.release_erp_user_session(text, text, text, text) to anon, authenticated;

commit;

notify pgrst, 'reload schema';

select
  'LOGIN LIMITS READY' as status,
  2 as owner_manager_setting_manager_max_devices,
  1 as all_other_users_max_devices,
  900 as stale_session_seconds,
  to_regprocedure('public.acquire_erp_user_session(text,text,text,text,text,text,text,integer)') is not null as acquire_function_ready,
  to_regprocedure('public.touch_erp_user_session(text,text,text,text,integer)') is not null as heartbeat_function_ready,
  to_regprocedure('public.release_erp_user_session(text,text,text,text)') is not null as logout_function_ready;
