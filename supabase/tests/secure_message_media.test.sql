create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(15);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.message_media'::regclass),
  'media metadata has row-level security enabled'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.view_once_recipients'::regclass),
  'view-once recipient records have row-level security enabled'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.view_once_recipients', 'select')
    and not has_table_privilege('authenticated', 'public.view_once_recipients', 'insert'),
  'clients cannot inspect or modify view-once recipient consumption'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.register_message_media(uuid,uuid,text,uuid,text,text,text,bigint,boolean)',
    'execute'
  ),
  'authenticated conversation members can register their own media message'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.register_message_media(uuid,uuid,text,uuid,text,text,text,bigint,boolean)',
    'execute'
  ),
  'anonymous users cannot register media messages'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.claim_view_once_media(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.claim_view_once_media(uuid,uuid)', 'execute'),
  'only the trusted media endpoint can claim a view-once recipient delivery'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.complete_view_once_media(uuid,uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.complete_view_once_media(uuid,uuid,uuid)', 'execute'),
  'only the trusted media endpoint can complete a view-once consumption'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.get_message_media_cleanup_candidates(integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.get_message_media_cleanup_candidates(integer)', 'execute'),
  'only the cleanup service can list eligible storage objects'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.delete_cleaned_message_media(uuid[])', 'execute')
    and not has_function_privilege('authenticated', 'public.delete_cleaned_message_media(uuid[])', 'execute'),
  'only the cleanup service can delete consumed or expired media metadata'
);
select extensions.ok(
  (select public = false and file_size_limit = 20971520
    from storage.buckets where id = 'isomo-chat-media'),
  'chat media storage is private and enforces the upload size limit'
);
select extensions.ok(
  exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'Conversation members can upload chat media'
      and cmd = 'a'
  ),
  'storage uploads require the uploader to be a conversation member'
);
select extensions.ok(
  exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'Chat media reads require the trusted access function'
      and cmd = 'r'
      and not polpermissive
  ),
  'restrictive storage policy blocks direct client reads even if another permissive policy exists'
);
select extensions.ok(
  exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'Chat media uploads require conversation membership'
      and cmd = 'a'
      and not polpermissive
  ),
  'restrictive storage policy constrains uploads even if another permissive policy exists'
);
select extensions.ok(
  exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'Chat media metadata cannot be changed by clients'
      and cmd = 'w'
      and not polpermissive
  ),
  'restrictive storage policy blocks direct client metadata updates'
);
select extensions.ok(
  exists (
    select 1 from pg_policy
    where polrelid = 'storage.objects'::regclass
      and polname = 'Chat media deletion is limited to unregistered uploads'
      and cmd = 'd'
      and not polpermissive
  ),
  'restrictive storage policy constrains deletes to unregistered uploads'
);

select * from extensions.finish();
rollback;
