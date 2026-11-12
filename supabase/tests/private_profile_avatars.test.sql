create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(5);

select extensions.ok(
  (select public = false
    and file_size_limit = 5242880
    and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
    from storage.buckets where id = 'isomo-profile-avatars'),
  'profile avatars use a private bucket with a size and MIME limit'
);
select extensions.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Signed-in members can read profile avatars'
      and cmd = 'SELECT'
      and 'authenticated' = any(roles)
      and qual like '%isomo-profile-avatars%'
      and qual like '%auth.uid()%'
  ),
  'only signed-in users can create avatar download links'
);
select extensions.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Members can upload only their own profile avatars'
      and cmd = 'INSERT'
      and 'authenticated' = any(roles)
      and with_check like '%auth.uid()%'
      and with_check like '%foldername%'
  ),
  'avatar uploads are constrained to the authenticated user folder'
);
select extensions.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Members can delete only their own profile avatars'
      and cmd = 'DELETE'
      and 'authenticated' = any(roles)
      and qual like '%auth.uid()%'
      and qual like '%foldername%'
  ),
  'avatar deletion is constrained to the authenticated user folder'
);
select extensions.ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname ilike '%profile avatar%'
      and cmd = 'UPDATE'
  ),
  'clients cannot overwrite existing profile avatar objects'
);

select * from extensions.finish();
rollback;
