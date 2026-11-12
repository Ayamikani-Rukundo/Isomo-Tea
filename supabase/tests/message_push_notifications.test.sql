create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(5);

select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_settings'
      and column_name = 'notifications_snoozed_until'
      and data_type = 'timestamp with time zone'
  ),
  'notification snooze expiry is stored in account settings'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.web_push_subscriptions'::regclass),
  'web push subscriptions have row-level security enabled'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.native_push_tokens'::regclass),
  'native push tokens have row-level security enabled'
);

select extensions.ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'web_push_subscriptions'
      and policyname = 'Members manage only their own web push subscriptions'
      and qual like '%auth.uid()%'
      and with_check like '%auth.uid()%'
  )
  and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'native_push_tokens'
      and policyname = 'Members manage only their own native push tokens'
      and qual like '%auth.uid()%'
      and with_check like '%auth.uid()%'
  ),
  'push credentials can only be managed by their owning account'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.web_push_subscriptions', 'select')
  and not has_table_privilege('anon', 'public.native_push_tokens', 'select')
  and has_table_privilege('authenticated', 'public.web_push_subscriptions', 'insert')
  and has_table_privilege('authenticated', 'public.native_push_tokens', 'insert'),
  'anonymous users cannot read subscriptions, while signed-in devices can register theirs'
);

select * from extensions.finish();
rollback;
