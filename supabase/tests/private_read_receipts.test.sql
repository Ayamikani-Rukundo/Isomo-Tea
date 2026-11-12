create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(5);

select extensions.ok(
  has_function_privilege('authenticated', 'public.mark_conversation_read(uuid)', 'execute'),
  'authenticated members can mark their own conversation read'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.mark_conversation_read(uuid)', 'execute'),
  'anonymous users cannot mark conversation read state'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.conversation_members', 'update'),
  'members cannot write arbitrary read timestamps directly'
);
select extensions.ok(
  exists (
    select 1
    from pg_proc
    where oid = 'public.mark_conversation_read(uuid)'::regprocedure
      and prosecdef
  ),
  'read-marker changes are constrained by a security-definer function'
);
select extensions.ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_members'
  ),
  'conversation membership read markers are available to Realtime'
);

select * from extensions.finish();
rollback;
