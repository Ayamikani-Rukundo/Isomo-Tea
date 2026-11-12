create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(8);

select extensions.ok(
  not has_table_privilege('anon', 'public.access_codes', 'select'),
  'anonymous clients cannot list registration codes'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.access_codes', 'select'),
  'authenticated clients cannot list registration codes or hashes'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.admin_create_access_code(text,integer,timestamp with time zone,uuid,uuid)', 'execute'),
  'anonymous clients cannot create registration codes'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.admin_create_access_code(text,integer,timestamp with time zone,uuid,uuid)', 'execute'),
  'authenticated clients cannot create registration codes directly'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.admin_create_access_code(text,integer,timestamp with time zone,uuid,uuid)', 'execute'),
  'the trusted Edge Function can create registration codes'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.admin_set_access_code_active(uuid,boolean,uuid)', 'execute'),
  'anonymous clients cannot change registration code status'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.admin_set_access_code_active(uuid,boolean,uuid)', 'execute'),
  'authenticated clients cannot change registration code status directly'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.admin_set_access_code_active(uuid,boolean,uuid)', 'execute'),
  'the trusted Edge Function can change registration code status'
);

select * from extensions.finish();
rollback;
