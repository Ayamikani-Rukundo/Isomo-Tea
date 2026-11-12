create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(8);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.message_hidden_for_users'::regclass),
  'per-user message hiding has row-level security enabled'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.message_hidden_for_users', 'select')
    and not has_table_privilege('authenticated', 'public.message_hidden_for_users', 'insert'),
  'clients cannot bypass the caller-bound per-user hide function'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.edit_message(uuid,text)', 'execute')
    and not has_function_privilege('anon', 'public.edit_message(uuid,text)', 'execute'),
  'only authenticated users can request message edits'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.delete_message_for_everyone(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.delete_message_for_everyone(uuid)', 'execute'),
  'only authenticated users can request their message deletion'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.delete_message_for_me(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.delete_message_for_me(uuid)', 'execute'),
  'per-user message hiding is caller-bound'
);
select extensions.ok(
  has_column_privilege('authenticated', 'public.messages', 'body', 'update')
    and not has_table_privilege('authenticated', 'public.messages', 'update'),
  'direct edits are restricted to the body column and still require author RLS'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.messages', 'delete'),
  'clients cannot hard-delete shared message rows'
);
select extensions.ok(
  exists (
    select 1
    from pg_policy
    where polrelid = 'public.messages'::regclass
      and polname = 'Authors can edit recent messages'
  ),
  'message edits are limited by an author-specific RLS policy'
);

select * from extensions.finish();
rollback;
