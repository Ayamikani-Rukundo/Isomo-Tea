create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(14);

select extensions.ok(
  position('group' in pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and conname = 'conversations_kind_check'
  ))) > 0,
  'conversations support member-created groups'
);

select extensions.ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'conversation_members'
      and column_name = 'role'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversation_members'::regclass
      and pg_get_constraintdef(oid) like '%admin%'
  ),
  'conversation membership includes a constrained group-admin role'
);

select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'public.group_invites'::regclass)
    and not has_table_privilege('authenticated', 'public.group_invites', 'select'),
  'invite tokens remain private from client queries'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.create_group_conversation(text)', 'execute')
    and not has_function_privilege('anon', 'public.create_group_conversation(text)', 'execute'),
  'only authenticated users can create groups'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.get_group_conversation_list()', 'execute')
    and not has_function_privilege('anon', 'public.get_group_conversation_list()', 'execute'),
  'group lists are restricted to authenticated callers'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.join_group_by_invite(text)', 'execute')
    and not has_function_privilege('anon', 'public.join_group_by_invite(text)', 'execute'),
  'invite links can only be used by authenticated users'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.change_group_member_role(uuid,uuid,text)', 'execute')
    and has_function_privilege('authenticated', 'public.leave_group(uuid)', 'execute'),
  'group admins can manage roles and members can leave groups through checked functions'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.delete_group_message(uuid)', 'execute')
    and position('is_group_admin' in pg_get_functiondef('public.delete_group_message(uuid)'::regprocedure)) > 0,
  'group message moderation is enforced by group-admin authorization'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.start_conversation_deletion(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.start_conversation_deletion(uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'public.start_conversation_deletion(uuid,uuid)', 'execute'),
  'conversation deletion can only be initiated through the trusted cleanup endpoint'
);

select extensions.ok(
  has_function_privilege('service_role', 'public.complete_conversation_deletion(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.complete_conversation_deletion(uuid,uuid)', 'execute'),
  'conversation deletion completion is service-role-only'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.messages'::regclass
      and tgname = 'require_active_conversation_before_message'
      and not tgisinternal
  ),
  'messages cannot be added once a conversation deletion is pending'
);

select extensions.ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'remove_general_messages_before_user_deletion'
      and not tgisinternal
  ),
  'deleted accounts are removed from the Support Circle history'
);

select extensions.ok(
  position('User deleted' in pg_get_functiondef('public.get_private_conversation_list()'::regprocedure)) > 0,
  'deleted private-chat peers receive the requested deleted-user label'
);

select extensions.ok(
  position('sender_id' in pg_get_functiondef('public.set_my_username(text)'::regprocedure)) > 0
    and position('changed their username to' in pg_get_functiondef('public.set_my_username(text)'::regprocedure)) = 0,
  'username notices do not reveal the new username'
);

select * from extensions.finish();
rollback;
