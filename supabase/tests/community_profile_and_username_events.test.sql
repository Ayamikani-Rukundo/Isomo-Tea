create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(6);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'system_event'
  ),
  'messages can identify trusted system events'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.admin_update_general_conversation(text,text,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_update_general_conversation(text,text,uuid)', 'execute'),
  'community profile updates are callable only by the server-side service role'
);
select extensions.ok(
  exists (
    select 1 from storage.buckets
    where id = 'isomo-community-assets'
      and not public
      and file_size_limit = 5242880
  ),
  'community photos use a private size-limited storage bucket'
);
select extensions.ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ),
  'community profile changes are available over Realtime'
);
select extensions.ok(
  position('username_changed' in pg_get_functiondef('public.set_my_username(text)'::regprocedure)) > 0,
  'username updates create a community system event'
);
select extensions.ok(
  position('system_event IS NULL' in pg_get_expr(policy.polwithcheck, policy.polrelid)) > 0,
  'authenticated clients cannot spoof system events through message inserts'
)
from pg_policy policy
where policy.polrelid = 'public.messages'::regclass
  and policy.polname = 'Members can send messages to conversations they joined';

select * from extensions.finish();
rollback;
