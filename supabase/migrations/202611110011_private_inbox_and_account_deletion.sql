alter table public.conversation_members
  add column if not exists hidden_at timestamptz;

alter table public.conversations
  drop constraint if exists conversations_private_participants_check,
  drop constraint if exists conversations_participant_low_fkey,
  drop constraint if exists conversations_participant_high_fkey;

alter table public.conversations
  add constraint conversations_participant_low_fkey
    foreign key (participant_low) references auth.users (id) on delete set null,
  add constraint conversations_participant_high_fkey
    foreign key (participant_high) references auth.users (id) on delete set null,
  add constraint conversations_private_participants_check
    check (
      (kind = 'general' and participant_low is null and participant_high is null)
      or (
        kind = 'private'
        and (
          participant_low is null
          or participant_high is null
          or participant_low < participant_high
        )
      )
    );

create table public.account_deletion_audit (
  request_id uuid primary key,
  status text not null check (status in ('content_purged', 'completed')),
  messages_removed integer not null check (messages_removed >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.account_deletion_audit enable row level security;
revoke all on public.account_deletion_audit from public, anon, authenticated;
grant all on public.account_deletion_audit to service_role;

create or replace function public.get_private_conversation_list()
returns table (
  conversation_id uuid,
  peer_id uuid,
  peer_username text,
  peer_avatar_url text,
  latest_message text,
  latest_message_at timestamptz,
  unread_count integer,
  last_read_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.id,
    peer.user_id,
    coalesce(profile.username, 'former member'),
    profile.avatar_url,
    latest.body,
    latest.created_at,
    (
      select count(*)::integer
      from public.messages unread
      where unread.conversation_id = conversation.id
        and unread.deleted_at is null
        and unread.sender_id is distinct from (select auth.uid())
        and (
          membership.last_read_at is null
          or unread.created_at > membership.last_read_at
        )
        and not private.is_message_hidden_for_current_user(unread.id)
    ),
    membership.last_read_at
  from public.conversations conversation
  join public.conversation_members membership
    on membership.conversation_id = conversation.id
    and membership.user_id = (select auth.uid())
  left join lateral (
    select candidate.user_id
    from unnest(array[conversation.participant_low, conversation.participant_high]) candidate(user_id)
    where candidate.user_id is distinct from (select auth.uid())
    limit 1
  ) peer on true
  left join public.profiles profile on profile.id = peer.user_id
  left join lateral (
    select message.body, message.created_at
    from public.messages message
    where message.conversation_id = conversation.id
      and message.deleted_at is null
      and not private.is_message_hidden_for_current_user(message.id)
    order by message.created_at desc, message.id desc
    limit 1
  ) latest on true
  where (select auth.uid()) is not null
    and conversation.kind = 'private'
    and (
      membership.hidden_at is null
      or exists (
        select 1
        from public.messages incoming
        where incoming.conversation_id = conversation.id
          and incoming.deleted_at is null
          and incoming.sender_id is distinct from (select auth.uid())
          and incoming.created_at > membership.hidden_at
      )
    )
  order by latest.created_at desc nulls last, conversation.id;
$$;

create or replace function public.hide_private_conversation(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  hidden_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  update public.conversation_members membership
  set hidden_at = now()
  from public.conversations conversation
  where membership.conversation_id = p_conversation_id
    and membership.user_id = (select auth.uid())
    and conversation.id = membership.conversation_id
    and conversation.kind = 'private'
  returning membership.conversation_id into hidden_id;

  if hidden_id is null then
    raise exception using errcode = '42501', message = 'This private conversation is unavailable.';
  end if;
  return hidden_id;
end;
$$;

create or replace function public.open_private_conversation(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  update public.conversation_members membership
  set hidden_at = null
  from public.conversations conversation
  where membership.conversation_id = p_conversation_id
    and membership.user_id = current_user_id
    and conversation.id = membership.conversation_id
    and conversation.kind = 'private';

  if not found then
    raise exception using errcode = '42501', message = 'This private conversation is unavailable.';
  end if;
  return p_conversation_id;
end;
$$;

create or replace function public.get_or_create_private_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  low_user_id uuid;
  high_user_id uuid;
  private_conversation_id uuid;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if p_other_user_id is null or p_other_user_id = current_user_id then
    raise exception using errcode = '22023', message = 'Choose another community member.';
  end if;
  if not exists (select 1 from public.profiles where id = p_other_user_id) then
    raise exception using errcode = 'P0002', message = 'That community member is unavailable.';
  end if;

  low_user_id := least(current_user_id, p_other_user_id);
  high_user_id := greatest(current_user_id, p_other_user_id);

  insert into public.conversations (kind, created_by, participant_low, participant_high)
  values ('private', current_user_id, low_user_id, high_user_id)
  on conflict (participant_low, participant_high) where kind = 'private'
  do nothing
  returning id into private_conversation_id;

  if private_conversation_id is null then
    select id into private_conversation_id
    from public.conversations
    where kind = 'private'
      and participant_low = low_user_id
      and participant_high = high_user_id;
  end if;

  if private_conversation_id is null then
    raise exception using errcode = 'P0001', message = 'Could not create the private conversation.';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values
    (private_conversation_id, low_user_id),
    (private_conversation_id, high_user_id)
  on conflict (conversation_id, user_id) do nothing;

  update public.conversation_members
  set hidden_at = null
  where conversation_id = private_conversation_id
    and user_id = current_user_id;

  return private_conversation_id;
end;
$$;

create or replace function private.delete_empty_private_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.conversations conversation
  where conversation.id = old.conversation_id
    and conversation.kind = 'private'
    and not exists (
      select 1
      from public.conversation_members membership
      where membership.conversation_id = old.conversation_id
    );
  return old;
end;
$$;

create trigger remove_empty_private_conversation
  after delete on public.conversation_members
  for each row execute function private.delete_empty_private_conversation();

revoke all on function private.delete_empty_private_conversation() from public, anon, authenticated;

create or replace function public.purge_account_content(p_user_id uuid, p_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer;
begin
  if p_user_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'Invalid account deletion request.';
  end if;
  if exists (select 1 from public.administrators where user_id = p_user_id) then
    raise exception using errcode = '42501', message = 'Administrator accounts cannot be deleted here.';
  end if;

  delete from public.messages where sender_id = p_user_id;
  get diagnostics removed_count = row_count;

  insert into public.account_deletion_audit (request_id, status, messages_removed)
  values (p_request_id, 'content_purged', removed_count);
  return removed_count;
end;
$$;

create or replace function public.complete_account_deletion(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  completed_count integer;
begin
  update public.account_deletion_audit
  set status = 'completed', completed_at = now()
  where request_id = p_request_id
    and status = 'content_purged';
  get diagnostics completed_count = row_count;
  if completed_count <> 1 then
    raise exception using errcode = 'P0002', message = 'Account deletion audit record is unavailable.';
  end if;
end;
$$;

revoke all on function public.get_private_conversation_list() from public, anon;
grant execute on function public.get_private_conversation_list() to authenticated;
revoke all on function public.hide_private_conversation(uuid) from public, anon;
grant execute on function public.hide_private_conversation(uuid) to authenticated;
revoke all on function public.open_private_conversation(uuid) from public, anon;
grant execute on function public.open_private_conversation(uuid) to authenticated;
revoke all on function public.get_or_create_private_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_private_conversation(uuid) to authenticated;
revoke all on function public.purge_account_content(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_account_content(uuid, uuid) to service_role;
revoke all on function public.complete_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.complete_account_deletion(uuid) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_members'
  ) then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
end;
$$;
