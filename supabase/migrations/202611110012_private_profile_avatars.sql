insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'isomo-profile-avatars',
  'isomo-profile-avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Signed-in members can read profile avatars" on storage.objects;
create policy "Signed-in members can read profile avatars"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'isomo-profile-avatars'
    and (select auth.uid()) is not null
  );

drop policy if exists "Members can upload only their own profile avatars" on storage.objects;
create policy "Members can upload only their own profile avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'isomo-profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Members can delete only their own profile avatars" on storage.objects;
create policy "Members can delete only their own profile avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'isomo-profile-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
