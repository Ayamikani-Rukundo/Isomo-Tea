create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(15);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.message_polls'::regclass),
  'poll metadata uses row-level security'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.poll_options'::regclass),
  'poll options use row-level security'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.poll_votes'::regclass),
  'poll votes use row-level security'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.message_mentions'::regclass),
  'mention notifications use row-level security'
);
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.message_stickers'::regclass),
  'stickers use row-level security'
);
select extensions.ok(
  has_table_privilege('authenticated', 'public.poll_votes', 'select')
    and not has_table_privilege('authenticated', 'public.poll_votes', 'insert')
    and not has_table_privilege('authenticated', 'public.poll_votes', 'update')
    and not has_table_privilege('authenticated', 'public.poll_votes', 'delete'),
  'members can read conversation votes but must cast them through the validated RPC'
);
select extensions.ok(
  has_table_privilege('authenticated', 'public.message_mentions', 'select')
    and not has_table_privilege('authenticated', 'public.message_mentions', 'insert')
    and not has_table_privilege('authenticated', 'public.message_mentions', 'update'),
  'members cannot forge or edit mention notifications'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.create_message_poll(uuid,uuid,text,text[],uuid,timestamp with time zone)',
    'execute'
  ),
  'authenticated users can create polls through the membership-checked RPC'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.create_message_poll(uuid,uuid,text,text[],uuid,timestamp with time zone)',
    'execute'
  ),
  'anonymous users cannot create polls'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.cast_poll_vote(uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.cast_poll_vote(uuid,uuid)', 'execute'),
  'only authenticated users can vote through the validated RPC'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_poll_results(uuid,uuid[])', 'execute')
    and not has_function_privilege('anon', 'public.get_poll_results(uuid,uuid[])', 'execute'),
  'poll results require an authenticated member'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.create_sticker_message(uuid,uuid,text,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.create_sticker_message(uuid,uuid,text,uuid)', 'execute'),
  'sticker messages use an authenticated server-validated operation'
);
with illustrated_codes(code) as (
  values
    ('yewe_sha'), ('mbega'), ('nta_kibazo'), ('yego_rwose'),
    ('oya_sha'), ('amakuru'), ('ndumva'), ('reka_da'),
    ('ngwino'), ('yampayinka'), ('brooo_urabizi'), ('ahubwo_se'),
    ('humura_sha'), ('birakaze'), ('shaaa'), ('dore_ibintu')
),
sticker_definitions as (
  select
    pg_get_constraintdef(constraint_row.oid) as constraint_body,
    pg_get_functiondef('public.create_sticker_message(uuid,uuid,text,uuid)'::regprocedure) as function_body
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.message_stickers'::regclass
    and constraint_row.conname = 'message_stickers_sticker_code_check'
)
select extensions.ok(
  (
    select count(*) = 16
    from illustrated_codes
    cross join sticker_definitions
    where constraint_body like '%' || code || '%'
      and function_body like '%' || code || '%'
  ),
  'all illustrated Kinyarwanda sticker codes pass both database checks'
);
select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.messages'::regclass
      and tgname = 'notify_message_mentions_after_insert'
      and not tgisinternal
  ),
  'mentions are generated server-side from message text'
);
select extensions.ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_mentions'
  ),
  'mention notification changes are available over Realtime'
);

select * from extensions.finish();
rollback;
