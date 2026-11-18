create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(5);

select extensions.is(
  (select count(*)::integer from public.conversations where kind = 'general'),
  1,
  'exactly one Support Circle conversation exists'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.repair_my_account()', 'execute')
    and not has_function_privilege('anon', 'public.repair_my_account()', 'execute'),
  'signed-in users can repair only their own account basics'
);

select extensions.ok(
  not has_function_privilege('authenticated', 'private.ensure_user_basics(uuid)', 'execute')
    and not has_function_privilege('anon', 'private.ensure_user_basics(uuid)', 'execute'),
  'clients cannot invoke the internal account repair helper'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.conversations'::regclass
      and tgname = 'protect_support_circle_from_deletion'
      and not tgisinternal
  ),
  'the required Support Circle conversation is protected from deletion'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'auth_user_created_profile'
      and not tgisinternal
  )
  and position('ensure_user_basics' in pg_get_functiondef('private.handle_new_auth_user()'::regprocedure)) > 0,
  'new accounts use the same repair path as existing accounts'
);

select * from extensions.finish();
rollback;
