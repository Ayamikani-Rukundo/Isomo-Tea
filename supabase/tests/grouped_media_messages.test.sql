create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(5);

select extensions.ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'messages'
      and column_name = 'media_group_id'
      and udt_name = 'uuid'
  ),
  'messages stores grouped media IDs as UUIDs'
);
select extensions.ok(
  to_regclass('public.messages_media_group') is not null,
  'grouped messages have a conversation lookup index'
);
select extensions.ok(
  (select prosecdef from pg_proc where oid = 'public.register_grouped_message_media(uuid,uuid,text,uuid,text,text,text,bigint,boolean,uuid)'::regprocedure),
  'grouped media registration runs with its constrained definer privileges'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.register_grouped_message_media(uuid,uuid,text,uuid,text,text,text,bigint,boolean,uuid)',
    'execute'
  ),
  'authenticated clients can register grouped media through the guarded RPC'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.register_grouped_message_media(uuid,uuid,text,uuid,text,text,text,bigint,boolean,uuid)',
    'execute'
  ),
  'anonymous clients cannot register grouped media'
);

select * from extensions.finish();
rollback;
