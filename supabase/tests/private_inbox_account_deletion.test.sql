create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(10);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversation_members'
      and column_name = 'hidden_at'
  ),
  'private conversations support per-user hiding'
);

select extensions.ok(
  (select confdeltype = 'n' from pg_constraint
   where conrelid = 'public.conversations'::regclass
     and conname = 'conversations_participant_low_fkey'),
  'deleting one member does not cascade-delete their shared private conversation'
);

select extensions.ok(
  (select confdeltype = 'n' from pg_constraint
   where conrelid = 'public.conversations'::regclass
     and conname = 'conversations_participant_high_fkey'),
  'either private-conversation participant may be removed without deleting the other member history'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.get_private_conversation_list()', 'execute')
    and not has_function_privilege('anon', 'public.get_private_conversation_list()', 'execute'),
  'only authenticated users can list their own private conversations'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.hide_private_conversation(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.hide_private_conversation(uuid)', 'execute'),
  'conversation hiding is an authenticated caller-bound operation'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.open_private_conversation(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.open_private_conversation(uuid)', 'execute'),
  'opening an existing private conversation verifies the current membership'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.purge_account_content(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.purge_account_content(uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.purge_account_content(uuid,uuid)', 'execute'),
  'only the trusted account-deletion function can purge account messages'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.complete_account_deletion(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.complete_account_deletion(uuid)', 'execute'),
  'account deletion audit completion is service-role-only'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.account_deletion_audit'::regclass)
    and not has_table_privilege('authenticated', 'public.account_deletion_audit', 'select'),
  'privacy-preserving deletion audit records are not exposed to clients'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.conversation_members'::regclass
      and tgname = 'remove_empty_private_conversation'
      and not tgisinternal
  ),
  'orphan private conversations are removed only after their final member is gone'
);

select * from extensions.finish();
rollback;
