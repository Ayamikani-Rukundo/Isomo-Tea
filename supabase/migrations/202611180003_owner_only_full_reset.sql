create or replace function public.admin_reset_application_data(
  p_actor_id uuid,
  p_confirmation_email text,
  p_confirmation_phrase text,
  p_deleted_auth_accounts integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  retained_user_id uuid;
  retained_user_created_at timestamptz;
  support_circle_id uuid;
  removed_message_count integer;
  removed_conversation_count integer;
  removed_access_code_count integer;
  removed_profile_count integer;
begin
  if p_actor_id is null
    or lower(btrim(coalesce(p_confirmation_email, ''))) <> 'idp.damn@gmail.com'
    or p_confirmation_phrase is distinct from 'RESET EVERYTHING EXCEPT ADMIN'
    or p_deleted_auth_accounts is null
    or p_deleted_auth_accounts < 0 then
    raise exception using errcode = '22023', message = 'The reset confirmation is invalid.';
  end if;

  select account.id, account.created_at
  into retained_user_id, retained_user_created_at
  from auth.users account
  where lower(account.email) = 'idp.damn@gmail.com'
  for update;

  if retained_user_id is null or retained_user_id <> p_actor_id then
    raise exception using errcode = '42501', message = 'Only the i Fam User administrator can reset application data.';
  end if;
  if not exists (
    select 1 from public.administrators administrator
    where administrator.user_id = retained_user_id
  ) then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;

  lock table auth.users in share row exclusive mode;
  if exists (select 1 from auth.users where id <> retained_user_id) then
    raise exception using errcode = '55000', message = 'Other Auth accounts must be removed before the data reset can finish.';
  end if;

  support_circle_id := private.ensure_support_circle();

  select count(*)::integer into removed_message_count
  from public.messages;
  select count(*)::integer into removed_conversation_count
  from public.conversations
  where kind <> 'general';
  select count(*)::integer into removed_access_code_count
  from public.access_codes;
  select count(*)::integer into removed_profile_count
  from public.profiles
  where id <> retained_user_id;

  delete from public.messages;
  delete from public.group_invites;
  delete from public.conversation_deletion_jobs;
  delete from public.conversations
  where kind <> 'general';
  delete from public.conversation_members
  where conversation_id <> support_circle_id
    or user_id <> retained_user_id;

  delete from public.access_codes;
  delete from public.web_push_subscriptions;
  delete from public.native_push_tokens;
  delete from public.auth_rate_limits;
  delete from public.account_deletion_audit;
  delete from public.admin_audit_log
  where action <> 'application.full_reset';
  delete from public.administrators
  where user_id <> retained_user_id;
  delete from public.profiles
  where id <> retained_user_id;
  delete from public.user_settings
  where user_id <> retained_user_id;

  perform private.ensure_user_basics(retained_user_id);

  update public.profiles
  set username = 'i Fam User',
      avatar_url = null,
      created_at = retained_user_created_at,
      updated_at = now()
  where id = retained_user_id;

  update public.user_settings
  set theme = 'dark',
      notifications_enabled = true,
      notifications_snoozed_until = null
  where user_id = retained_user_id;

  update public.conversations
  set title = 'Support Circle',
      avatar_path = null,
      created_by = null,
      deleting_at = null
  where id = support_circle_id;

  update public.conversation_members
  set joined_at = now(),
      last_read_at = null,
      hidden_at = null,
      role = 'member'
  where conversation_id = support_circle_id
    and user_id = retained_user_id;

  insert into public.admin_audit_log (actor_id, action, details)
  values (
    retained_user_id,
    'application.full_reset',
    jsonb_build_object(
      'deleted_auth_accounts', p_deleted_auth_accounts,
      'deleted_profiles', removed_profile_count,
      'deleted_messages', removed_message_count,
      'deleted_conversations', removed_conversation_count,
      'deleted_access_codes', removed_access_code_count
    )
  );

  return jsonb_build_object(
    'reset', true,
    'retained_user_id', retained_user_id,
    'deleted_auth_accounts', p_deleted_auth_accounts,
    'deleted_profiles', removed_profile_count,
    'deleted_messages', removed_message_count,
    'deleted_conversations', removed_conversation_count,
    'deleted_access_codes', removed_access_code_count
  );
end;
$$;

revoke all on function public.admin_reset_application_data(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.admin_reset_application_data(uuid, text, text, integer)
  to service_role;
