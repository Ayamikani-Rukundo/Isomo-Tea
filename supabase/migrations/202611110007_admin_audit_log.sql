create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users (id) on delete set null,
  target_message_id uuid references public.messages (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_at
  on public.admin_audit_log (created_at desc, id desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
grant all on public.admin_audit_log to service_role;

create or replace function public.admin_delete_message(p_message_id uuid, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_id uuid;
begin
  if p_actor_id is null or not exists (
    select 1 from public.administrators where user_id = p_actor_id
  ) then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;

  update public.messages
  set body = 'This message was deleted by an administrator.',
      deleted_at = now()
  where id = p_message_id
    and deleted_at is null
  returning id into deleted_id;
  if deleted_id is null then
    raise exception using errcode = 'P0002', message = 'The message was not found or was already deleted.';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_message_id)
  values (p_actor_id, 'message.deleted_by_admin', deleted_id);
  return deleted_id;
end;
$$;

create or replace function public.admin_clear_message_history(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
  general_conversation_id uuid;
begin
  if p_actor_id is null or not exists (
    select 1 from public.administrators where user_id = p_actor_id
  ) then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if p_start_at is null or p_end_at is null or p_start_at >= p_end_at then
    raise exception using errcode = '22023', message = 'Choose a valid date range.';
  end if;
  select id into general_conversation_id
  from public.conversations
  where kind = 'general';
  if general_conversation_id is null then
    raise exception using errcode = 'P0002', message = 'General Tea was not found.';
  end if;

  update public.messages
  set body = 'This message was removed by an administrator.',
      deleted_at = now()
  where created_at >= p_start_at
    and created_at < p_end_at
    and conversation_id = general_conversation_id
    and deleted_at is null;
  get diagnostics changed_count = row_count;

  insert into public.admin_audit_log (actor_id, action, details)
  values (
    p_actor_id,
    'message.history_cleared',
    jsonb_build_object(
      'start_at', p_start_at,
      'end_at', p_end_at,
      'conversation_id', general_conversation_id,
      'message_count', changed_count
    )
  );
  return changed_count;
end;
$$;

create or replace function public.admin_remove_administrator(p_target_id uuid, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_id uuid;
begin
  if p_actor_id is null or not exists (
    select 1 from public.administrators where user_id = p_actor_id
  ) then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if p_target_id is null or p_target_id = p_actor_id then
    raise exception using errcode = '22023', message = 'Choose another administrator to remove.';
  end if;
  perform pg_advisory_xact_lock(8217043198452712);
  if (select count(*) from public.administrators) <= 1 then
    raise exception using errcode = 'P0001', message = 'The last administrator cannot be removed.';
  end if;

  delete from public.administrators where user_id = p_target_id
  returning user_id into removed_id;
  if removed_id is null then
    raise exception using errcode = 'P0002', message = 'Administrator not found.';
  end if;

  insert into public.admin_audit_log (actor_id, action, target_user_id)
  values (p_actor_id, 'administrator.removed', removed_id);
  return removed_id;
end;
$$;

create or replace function public.admin_record_invitation(p_target_id uuid, p_actor_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null or not exists (
    select 1 from public.administrators where user_id = p_actor_id
  ) then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if p_target_id is null then
    raise exception using errcode = '22023', message = 'Choose a valid administrator invite.';
  end if;

  insert into public.administrators (user_id, created_by)
  values (p_target_id, p_actor_id);
  insert into public.admin_audit_log (actor_id, action, target_user_id)
  values (p_actor_id, 'administrator.invited', p_target_id);
  return p_target_id;
end;
$$;

create or replace function public.admin_create_access_code_audited(
  p_code text,
  p_max_uses integer,
  p_expires_at timestamptz,
  p_deactivate_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_code jsonb;
begin
  created_code := public.admin_create_access_code(
    p_code, p_max_uses, p_expires_at, p_deactivate_id, p_created_by
  );
  insert into public.admin_audit_log (actor_id, action, details)
  values (
    p_created_by,
    'access_code.created',
    jsonb_build_object(
      'access_code_id', created_code ->> 'id',
      'deactivated_access_code_id', p_deactivate_id,
      'max_uses', p_max_uses,
      'expires_at', p_expires_at
    )
  );
  return created_code;
end;
$$;

create or replace function public.admin_set_access_code_active_audited(
  p_id uuid,
  p_active boolean,
  p_changed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_code jsonb;
begin
  changed_code := public.admin_set_access_code_active(p_id, p_active, p_changed_by);
  insert into public.admin_audit_log (actor_id, action, details)
  values (
    p_changed_by,
    case when p_active then 'access_code.activated' else 'access_code.deactivated' end,
    jsonb_build_object('access_code_id', p_id)
  );
  return changed_code;
end;
$$;

revoke all on function public.admin_delete_message(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_message(uuid, uuid) to service_role;
revoke all on function public.admin_clear_message_history(timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.admin_clear_message_history(timestamptz, timestamptz, uuid) to service_role;
revoke all on function public.admin_remove_administrator(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_remove_administrator(uuid, uuid) to service_role;
revoke all on function public.admin_record_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_record_invitation(uuid, uuid) to service_role;
revoke all on function public.admin_create_access_code_audited(text, integer, timestamptz, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_create_access_code_audited(text, integer, timestamptz, uuid, uuid) to service_role;
revoke all on function public.admin_set_access_code_active_audited(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_access_code_active_audited(uuid, boolean, uuid) to service_role;
