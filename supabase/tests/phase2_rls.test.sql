create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(31);

select extensions.has_table('public', 'profiles', 'profiles table exists');
select extensions.has_table('public', 'administrators', 'administrator roles table exists');
select extensions.has_table('public', 'access_codes', 'access codes table exists');
select extensions.has_table('public', 'conversations', 'conversations table exists');
select extensions.has_table('public', 'conversation_members', 'conversation members table exists');
select extensions.has_table('public', 'messages', 'messages table exists');
select extensions.has_table('public', 'user_settings', 'user settings table exists');
select extensions.has_table('public', 'auth_rate_limits', 'auth rate-limit table exists');

select extensions.rls_enabled('public', 'profiles', 'profiles has RLS enabled');
select extensions.rls_enabled('public', 'administrators', 'administrators has RLS enabled');
select extensions.rls_enabled('public', 'access_codes', 'access codes has RLS enabled');
select extensions.rls_enabled('public', 'conversations', 'conversations has RLS enabled');
select extensions.rls_enabled('public', 'conversation_members', 'conversation members has RLS enabled');
select extensions.rls_enabled('public', 'messages', 'messages has RLS enabled');
select extensions.rls_enabled('public', 'user_settings', 'user settings has RLS enabled');
select extensions.rls_enabled('public', 'auth_rate_limits', 'auth rate limits have RLS enabled');

select extensions.ok(
  not has_table_privilege('anon', 'public.profiles', 'select'),
  'anonymous clients cannot read profiles'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.access_codes', 'select'),
  'anonymous clients cannot read access-code hashes'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.access_codes', 'select'),
  'authenticated clients cannot read access-code hashes'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.administrators', 'insert'),
  'authenticated clients cannot grant administrator roles'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.profiles', 'update'),
  'authenticated clients do not have table-wide profile update rights'
);
select extensions.ok(
  has_column_privilege('authenticated', 'public.profiles', 'avatar_url', 'update'),
  'a member can update their avatar column, subject to owner RLS'
);
select extensions.ok(
  not has_column_privilege('authenticated', 'public.profiles', 'username', 'update'),
  'username changes must use the caller-bound function'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.consume_access_code(text)', 'execute'),
  'anonymous clients cannot test or consume access codes'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.consume_access_code(text)', 'execute'),
  'scholars cannot test or consume access codes directly'
);
select extensions.ok(
  has_function_privilege('service_role', 'public.consume_access_code(text)', 'execute'),
  'the trusted backend can consume access codes'
);
select extensions.ok(
  has_function_privilege('anon', 'public.username_is_available(text)', 'execute'),
  'registration can check username availability without revealing auth data'
);
select extensions.ok(
  not has_function_privilege('anon', 'public.set_my_username(text)', 'execute'),
  'anonymous clients cannot change usernames'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.set_my_username(text)', 'execute'),
  'authenticated members can request a caller-bound username change'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'public.consume_auth_rate_limit(text,text,integer,integer)', 'execute'),
  'clients cannot alter authentication rate limits'
);
select extensions.ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ),
  'messages are included in the Supabase Realtime publication'
);

select * from extensions.finish();
rollback;
