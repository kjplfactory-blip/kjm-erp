-- KHUSHALI JEWELLS ERP v479 - BACKUP LIST
-- Run only when READ-ONLY-CLOUD-DATA-CHECK.sql shows backup_table_exists = true.
-- This file contains one SELECT statement and cannot change data.

select
  id as backup_id,
  backup_kind,
  backup_key,
  source_version,
  target_version,
  source_updated_at,
  created_at,
  profile
from public.erp_state_backups
where state_id = 'khushali-jewells-main'
order by created_at desc;
