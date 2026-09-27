-- KHUSHALI JEWELLS MANUFACTURING
-- Reset live data to a clean factory start.
-- Keeps master data on existing live setup: customers, office customers, vendors, designs, stones, departments, users, passwords.
-- Clears: job cards, lots, bills, melting/casting history, safe locker stock, and old factory stock.
-- Creates: 4000.000 g of 99.5% gold in Metal Safe and Factory In / Out ledger.

insert into public.erp_state as target (id, data, updated_at)
values (
  'khushali-jewells-main',
  jsonb_build_object(
    'nextOrder', 1001,
    'nextLot', 201,
    'factoryResetAt', now()::text,
    'factoryResetReason', 'Clear job cards + reset factory stock',
    'customers', '[]'::jsonb,
    'officeCustomers', '[]'::jsonb,
    'vendors', '[]'::jsonb,
    'designs', '[]'::jsonb,
    'stones', '[]'::jsonb,
    'karigars', '[]'::jsonb,
    'userPasswords', '{}'::jsonb,
    'customUsers', '[]'::jsonb,
    'userAccessOverrides', '{}'::jsonb,
    'orders', '[]'::jsonb,
    'lots', '[]'::jsonb,
    'bills', '[]'::jsonb,
    'melting', '[]'::jsonb,
    'safeItems', '[]'::jsonb,
    'stoneOptions', jsonb_build_object('stoneType', '[]'::jsonb, 'shape', '[]'::jsonb, 'size', '[]'::jsonb),
    'stoneLibrarySeeded', false,
    'metalSafeSeededFromLedger', true,
    'ledger', jsonb_build_array(jsonb_build_object(
      'id', 'factory-reset-ledger',
      'date', to_char(current_date, 'DD/MM/YYYY'),
      'type', 'In',
      'purity', '99.5%',
      'weight', 4000,
      'reference', 'Factory reset opening stock'
    )),
    'metalSafeMovements', jsonb_build_array(jsonb_build_object(
      'id', 'factory-reset-metal-safe',
      'date', to_char(current_date, 'DD/MM/YYYY'),
      'type', 'Opening Stock',
      'direction', 'in',
      'purity', '99.5%',
      'weight', 4000,
      'reference', 'Factory reset opening stock',
      'sourceType', 'factory-reset',
      'sourceId', 'factory-reset-ledger'
    )),
    'factoryLedger', jsonb_build_array(jsonb_build_object(
      'id', 'factory-reset-factory-ledger',
      'date', to_char(current_date, 'DD/MM/YYYY'),
      'direction', 'in',
      'type', 'Opening Stock',
      'vendorId', '',
      'vendorName', 'Opening Stock',
      'materialType', 'raw-metal',
      'purity', '99.5%',
      'weight', 4000,
      'wstgPercent', 0,
      'wastagePercent', 0,
      'baseFineGold', 3980,
      'wstgFineGold', 0,
      'fineGold', 3980,
      'stockPosting', 'Metal Safe',
      'reference', 'Factory reset opening stock',
      'remarks', '',
      'sourceType', 'factory-reset',
      'sourceId', 'factory-reset-ledger',
      'sourceLine', ''
    ))
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
    'factoryResetReason', 'Clear job cards + reset factory stock',
    'orders', '[]'::jsonb,
    'lots', '[]'::jsonb,
    'bills', '[]'::jsonb,
    'melting', '[]'::jsonb,
    'safeItems', '[]'::jsonb,
    'metalSafeSeededFromLedger', true,
    'ledger', jsonb_build_array(jsonb_build_object(
      'id', 'factory-reset-ledger',
      'date', to_char(current_date, 'DD/MM/YYYY'),
      'type', 'In',
      'purity', '99.5%',
      'weight', 4000,
      'reference', 'Factory reset opening stock'
    )),
    'metalSafeMovements', jsonb_build_array(jsonb_build_object(
      'id', 'factory-reset-metal-safe',
      'date', to_char(current_date, 'DD/MM/YYYY'),
      'type', 'Opening Stock',
      'direction', 'in',
      'purity', '99.5%',
      'weight', 4000,
      'reference', 'Factory reset opening stock',
      'sourceType', 'factory-reset',
      'sourceId', 'factory-reset-ledger'
    )),
    'factoryLedger', jsonb_build_array(jsonb_build_object(
      'id', 'factory-reset-factory-ledger',
      'date', to_char(current_date, 'DD/MM/YYYY'),
      'direction', 'in',
      'type', 'Opening Stock',
      'vendorId', '',
      'vendorName', 'Opening Stock',
      'materialType', 'raw-metal',
      'purity', '99.5%',
      'weight', 4000,
      'wstgPercent', 0,
      'wastagePercent', 0,
      'baseFineGold', 3980,
      'wstgFineGold', 0,
      'fineGold', 3980,
      'stockPosting', 'Metal Safe',
      'reference', 'Factory reset opening stock',
      'remarks', '',
      'sourceType', 'factory-reset',
      'sourceId', 'factory-reset-ledger',
      'sourceLine', ''
    ))
  )
),
updated_at = now();
