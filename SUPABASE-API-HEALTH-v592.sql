-- KHUSHALI JEWELLS ERP v592 - SUPABASE API HEALTH CHECK
-- Run this in Supabase SQL Editor after the project is responding.
-- This script does not insert, update, delete, truncate, or replace ERP data.
-- ANALYZE only refreshes PostgreSQL planner statistics.

analyze public.erp_state;
analyze public.erp_state_backups;

-- 1. Confirm the id lookup and backup de-duplication indexes.
select
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('erp_state', 'erp_state_backups')
order by tablename, indexname;

-- Expected:
-- erp_state has a PRIMARY KEY / UNIQUE btree index on (id).
-- erp_state_backups has a UNIQUE index on (state_id, backup_key).

-- 2. Measure the live JSON row and table sizes.
select
  id,
  updated_at,
  pg_size_pretty(pg_column_size(data)::bigint) as state_json_size,
  coalesce(data ->> 'appVersion', 'unknown') as app_version,
  coalesce(data ->> 'appBuild', '0') as app_build
from public.erp_state
where id = 'khushali-jewells-main';

select
  relname as table_name,
  pg_size_pretty(pg_relation_size(relid)) as table_size,
  pg_size_pretty(pg_indexes_size(relid)) as index_size,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  seq_scan,
  idx_scan,
  n_live_tup,
  n_dead_tup,
  last_analyze,
  last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
  and relname in ('erp_state', 'erp_state_backups')
order by relname;

-- 3. Verify that the main state lookup uses the primary-key index.
explain (analyze, buffers, format text)
select updated_at
from public.erp_state
where id = 'khushali-jewells-main'
limit 1;

-- 4. Show connections and waits involving ERP state operations.
select
  pid,
  usename,
  application_name,
  client_addr,
  state,
  wait_event_type,
  wait_event,
  query_start,
  left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 220) as query
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and query ilike '%erp_state%'
order by query_start;

-- 5. Show blocking relationships, if any are active now.
select
  blocked.pid as blocked_pid,
  blocker.pid as blocker_pid,
  blocked.wait_event_type,
  blocked.wait_event,
  left(regexp_replace(blocked.query, '[[:space:]]+', ' ', 'g'), 180) as blocked_query,
  left(regexp_replace(blocker.query, '[[:space:]]+', ' ', 'g'), 180) as blocker_query
from pg_stat_activity blocked
join pg_stat_activity blocker
  on blocker.pid = any(pg_blocking_pids(blocked.pid))
where blocked.datname = current_database();

-- 6. Check backup volume. v592 writes a duplicate-safe daily/version key.
select
  count(*) as backup_rows,
  pg_size_pretty(coalesce(sum(pg_column_size(data)), 0)::bigint) as backup_json_total,
  min(created_at) as oldest_backup,
  max(created_at) as newest_backup
from public.erp_state_backups
where state_id = 'khushali-jewells-main';

select
  state_id,
  backup_key,
  count(*) as copies
from public.erp_state_backups
group by state_id, backup_key
having count(*) > 1;

-- The final query should return no rows.
