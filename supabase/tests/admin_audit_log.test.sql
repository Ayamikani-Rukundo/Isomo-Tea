create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(9);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.admin_audit_log'::regclass),
  'administrator audit history has row-level security enabled'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.admin_audit_log', 'select')
    and not has_table_privilege('anon', 'public.admin_audit_log', 'select'),
  'only the server-side administrator service can read audit history'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.admin_delete_message(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_delete_message(uuid,uuid)', 'execute'),
  'administrator message deletion is server-only'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.admin_clear_message_history(timestamptz,timestamptz,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_clear_message_history(timestamptz,timestamptz,uuid)', 'execute'),
  'date-range history clearing is server-only'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.admin_remove_administrator(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_remove_administrator(uuid,uuid)', 'execute'),
  'administrator role removal is server-only'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.admin_record_invitation(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_record_invitation(uuid,uuid)', 'execute'),
  'administrator invitations and their audit records are server-only'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.admin_create_access_code_audited(text,integer,timestamptz,uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_create_access_code_audited(text,integer,timestamptz,uuid,uuid)', 'execute'),
  'audited access-code management is server-only'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.admin_set_access_code_active_audited(uuid,boolean,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_set_access_code_active_audited(uuid,boolean,uuid)', 'execute'),
  'audited access-code activation is server-only'
);
select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'admin_audit_log_created_at'
  ),
  'audit history supports newest-first review'
);

select * from extensions.finish();
rollback;
