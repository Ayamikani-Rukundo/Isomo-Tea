create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(6);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.message_reactions'::regclass),
  'message reactions have row-level security enabled'
);
select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.message_reactions'::regclass
      and contype = 'p'
  ),
  'a member cannot create duplicate identical reactions for one message'
);
select extensions.ok(
  has_table_privilege('authenticated', 'public.message_reactions', 'select')
    and has_table_privilege('authenticated', 'public.message_reactions', 'insert')
    and has_table_privilege('authenticated', 'public.message_reactions', 'delete')
    and not has_table_privilege('authenticated', 'public.message_reactions', 'update'),
  'members can read, add, and remove reactions but cannot edit rows'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.message_reactions', 'select'),
  'anonymous users cannot read reactions'
);
select extensions.ok(
  (
    select count(*) = 3
    from pg_policy
    where polrelid = 'public.message_reactions'::regclass
  ),
  'reaction reads and writes are all governed by explicit membership policies'
);
select extensions.ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_reactions'
  ),
  'reaction changes are included in Supabase Realtime'
);

select * from extensions.finish();
rollback;
