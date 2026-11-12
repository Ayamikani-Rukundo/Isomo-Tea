create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(9);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversations'
      and column_name = 'participant_low'
  ),
  'private conversations record their canonical first participant'
);
select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversations'
      and column_name = 'participant_high'
  ),
  'private conversations record their canonical second participant'
);
select extensions.ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'conversations_private_pair_unique'
  ),
  'a participant pair can have only one private conversation'
);
select extensions.ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and conname = 'conversations_private_participants_check'
  ),
  'private participant IDs are required and consistently ordered'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_or_create_private_conversation(uuid)', 'execute'),
  'authenticated users can request their pair conversation'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.get_or_create_private_conversation(uuid)', 'execute'),
  'anonymous users cannot create private conversations'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.conversations', 'insert'),
  'authenticated users cannot bypass the conversation-creation RPC'
);
select extensions.ok(
  has_column_privilege('authenticated', 'public.administrators', 'user_id', 'select')
    and not has_column_privilege('authenticated', 'public.administrators', 'created_by', 'select'),
  'members can read administrator indicators without role-management metadata'
);
select extensions.ok(
  exists (
    select 1
    from pg_policy
    where polrelid = 'public.messages'::regclass
      and polname = 'Members can send messages to conversations they joined'
  ),
  'message insertion remains governed by conversation membership policy'
);

select * from extensions.finish();
rollback;
