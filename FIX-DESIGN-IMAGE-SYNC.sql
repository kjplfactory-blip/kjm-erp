-- KHUSHALI JEWELLS MANUFACTURING ERP
-- Repair Design Master image upload and cross-laptop image sync.
-- Run this complete file once in Supabase Dashboard > SQL Editor.
-- It does not delete ERP data or existing image files.

begin;

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

commit;

notify pgrst, 'reload schema';

-- This result must show design-images / true.
select id, name, public
from storage.buckets
where id = 'design-images';

-- This result must show both Allow design image read and Allow design image write.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in ('Allow design image read', 'Allow design image write')
order by policyname;
