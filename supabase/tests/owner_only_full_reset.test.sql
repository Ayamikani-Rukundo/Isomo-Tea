create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(4);

select extensions.ok(
  has_function_privilege(
    'service_role',
    'public.admin_reset_application_data(uuid,text,text,integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.admin_reset_application_data(uuid,text,text,integer)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_reset_application_data(uuid,text,text,integer)',
    'execute'
  ),
  'only the trusted administrator function can execute the reset transaction'
);

select extensions.ok(
  position('idp.damn@gmail.com' in pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  )) > 0
  and position('RESET EVERYTHING EXCEPT ADMIN' in pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  )) > 0,
  'the reset is bound to the named owner and exact confirmation phrase'
);

select extensions.ok(
  position('private.ensure_support_circle' in pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  )) > 0
  and position('where kind <> ''general''' in pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  )) > 0,
  'the reset preserves and repairs the required Support Circle'
);

select extensions.ok(
  position('delete from public.messages where true;' in lower(pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  ))) > 0
  and position('delete from public.group_invites where true;' in lower(pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  ))) > 0
  and position('delete from public.conversation_deletion_jobs where true;' in lower(pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  ))) > 0
  and position('delete from public.access_codes where true;' in lower(pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  ))) > 0
  and position('delete from public.web_push_subscriptions where true;' in lower(pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  ))) > 0
  and position('delete from public.native_push_tokens where true;' in lower(pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  ))) > 0
  and position('delete from public.auth_rate_limits where true;' in lower(pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  ))) > 0
  and position('delete from public.account_deletion_audit where true;' in lower(pg_get_functiondef(
    'public.admin_reset_application_data(uuid,text,text,integer)'::regprocedure
  ))) > 0,
  'table-wide reset deletes use explicit predicates'
);

select * from extensions.finish();
rollback;
