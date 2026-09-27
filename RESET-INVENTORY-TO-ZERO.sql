-- KHUSHALI JEWELLS MANUFACTURING
-- Reset live working inventory to zero before entering actual stock.
-- Keeps masters: customers, office customers, vendors, designs, catalogue, stones, departments, users, passwords.
-- Clears: job cards, lots, bills, melting/casting, XRF, safe lockers, metal safe, factory ledger, and non-gold movements.
-- Creates no opening stock. After running this, add real stock from Factory In.

insert into public.erp_state as target (id, data, updated_at)
values (
  'khushali-jewells-main',
  jsonb_build_object(
    'nextOrder', 1001,
    'nextLot', 201,
    'factoryResetAt', now()::text,
    'factoryResetReason', 'Reset gold and non-gold inventory to zero',
    'orders', '[]'::jsonb,
    'lots', '[]'::jsonb,
    'bills', '[]'::jsonb,
    'melting', '[]'::jsonb,
    'xrfTests', '[]'::jsonb,
    'safeItems', '[]'::jsonb,
    'safeDepartmentIssues', '[]'::jsonb,
    'productionNonGoldIssues', '[]'::jsonb,
    'ledger', '[]'::jsonb,
    'metalSafeMovements', '[]'::jsonb,
    'factoryLedger', '[]'::jsonb,
    'metalSafeSeededFromLedger', true
  ),
  now()
)
on conflict (id) do update
set data = (
  target.data
  || jsonb_build_object(
    'nextOrder', 1001,
    'nextLot', 201,
    'factoryResetAt', now()::text,
    'factoryResetReason', 'Reset gold and non-gold inventory to zero',
    'orders', '[]'::jsonb,
    'lots', '[]'::jsonb,
    'bills', '[]'::jsonb,
    'melting', '[]'::jsonb,
    'xrfTests', '[]'::jsonb,
    'safeItems', '[]'::jsonb,
    'safeDepartmentIssues', '[]'::jsonb,
    'productionNonGoldIssues', '[]'::jsonb,
    'ledger', '[]'::jsonb,
    'metalSafeMovements', '[]'::jsonb,
    'factoryLedger', '[]'::jsonb,
    'metalSafeSeededFromLedger', true
  )
),
updated_at = now();
