create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(3);

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

select * from extensions.finish();
rollback;
