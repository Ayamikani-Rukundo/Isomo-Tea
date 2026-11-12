create table public.message_hidden_for_users (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_hidden_for_users enable row level security;
revoke all on public.message_hidden_for_users from public, anon, authenticated;
grant all on public.message_hidden_for_users to service_role;

create or replace function private.is_message_hidden_for_current_user(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.message_hidden_for_users hidden
    where hidden.message_id = p_message_id
      and hidden.user_id = (select auth.uid())
  );
$$;

drop policy if exists "Members can read messages in accessible conversations" on public.messages;
create policy "Members can read messages in accessible conversations"
  on public.messages for select to authenticated
  using (
    private.has_conversation_access(conversation_id)
    and not private.is_message_hidden_for_current_user(id)
  );

grant update (body) on public.messages to authenticated;

create policy "Authors can edit recent messages"
  on public.messages for update to authenticated
  using (
    sender_id = (select auth.uid())
    and deleted_at is null
    and created_at > now() - interval '15 minutes'
    and private.has_conversation_access(conversation_id)
  )
  with check (
    sender_id = (select auth.uid())
    and deleted_at is null
    and created_at > now() - interval '15 minutes'
    and private.has_conversation_access(conversation_id)
  );

create or replace function public.edit_message(p_message_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  updated_message_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if p_body is null or length(btrim(p_body)) not between 1 and 10000 then
    raise exception using errcode = '22023', message = 'Message text must contain 1–10000 characters.';
  end if;

  update public.messages
  set body = btrim(p_body)
  where id = p_message_id
    and sender_id = current_user_id
    and deleted_at is null
    and created_at > now() - interval '15 minutes'
    and private.has_conversation_access(conversation_id)
  returning id into updated_message_id;

  if updated_message_id is null then
    raise exception using errcode = '42501', message = 'This message cannot be edited.';
  end if;
  return updated_message_id;
end;
$$;

create or replace function public.delete_message_for_everyone(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  deleted_message_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  update public.messages
  set body = 'This message was deleted.',
      deleted_at = now()
  where id = p_message_id
    and sender_id = current_user_id
    and deleted_at is null
    and private.has_conversation_access(conversation_id)
  returning id into deleted_message_id;

  if deleted_message_id is null then
    raise exception using errcode = '42501', message = 'This message cannot be deleted for everyone.';
  end if;
  return deleted_message_id;
end;
$$;

create or replace function public.delete_message_for_me(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  hidden_message_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  if not exists (
    select 1 from public.messages m
    where m.id = p_message_id
      and private.has_conversation_access(m.conversation_id)
  ) then
    raise exception using errcode = '42501', message = 'This message is unavailable.';
  end if;

  insert into public.message_hidden_for_users (message_id, user_id)
  values (p_message_id, current_user_id)
  on conflict (message_id, user_id) do nothing
  returning message_id into hidden_message_id;

  return coalesce(hidden_message_id, p_message_id);
end;
$$;

revoke all on function private.is_message_hidden_for_current_user(uuid) from public, anon, authenticated;
grant execute on function private.is_message_hidden_for_current_user(uuid) to authenticated;
revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;
revoke all on function public.delete_message_for_everyone(uuid) from public, anon;
grant execute on function public.delete_message_for_everyone(uuid) to authenticated;
revoke all on function public.delete_message_for_me(uuid) from public, anon;
grant execute on function public.delete_message_for_me(uuid) to authenticated;
