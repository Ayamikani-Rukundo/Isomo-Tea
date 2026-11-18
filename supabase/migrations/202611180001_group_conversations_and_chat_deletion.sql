alter table public.conversations
  drop constraint if exists conversations_kind_check;

alter table public.conversations
  add constraint conversations_kind_check
  check (kind in ('general', 'private', 'group'));

alter table public.conversations
  drop constraint if exists conversations_private_participants_check;
alter table public.conversations
  add constraint conversations_private_participants_check
  check (
    (kind in ('general', 'group') and participant_low is null and participant_high is null)
    or (
      kind = 'private'
      and (
        participant_low is null
        or participant_high is null
        or participant_low < participant_high
      )
    )
  );

alter table public.conversations
  add column if not exists deleting_at timestamptz;

alter table public.conversation_members
  add column if not exists role text not null default 'member'
  check (role in ('member', 'admin'));

create table public.group_invites (
  token_hash text primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  max_uses integer not null check (max_uses between 1 and 500),
  uses integer not null default 0 check (uses >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index group_invites_by_conversation on public.group_invites (conversation_id, expires_at);

alter table public.group_invites enable row level security;
revoke all on public.group_invites from public, anon, authenticated;
grant all on public.group_invites to service_role;

create table public.conversation_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null unique,
  kind text not null check (kind in ('private', 'group')),
  actor_id uuid references auth.users (id) on delete set null,
  avatar_path text,
  created_at timestamptz not null default now()
);

create table public.conversation_deletion_media (
  job_id uuid not null references public.conversation_deletion_jobs (id) on delete cascade,
  object_path text not null,
  primary key (job_id, object_path)
);

alter table public.conversation_deletion_jobs enable row level security;
alter table public.conversation_deletion_media enable row level security;
revoke all on public.conversation_deletion_jobs, public.conversation_deletion_media
  from public, anon, authenticated;
grant all on public.conversation_deletion_jobs, public.conversation_deletion_media
  to service_role;

create or replace function private.is_group_admin(p_conversation_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id
    where member.conversation_id = p_conversation_id
      and member.user_id = p_user_id
      and member.role = 'admin'
      and conversation.kind = 'group'
  );
$$;

revoke all on function private.is_group_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_group_admin(uuid, uuid) to authenticated, service_role;

create or replace function private.require_active_conversation_for_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation_deleting_at timestamptz;
begin
  select conversation.deleting_at
  into conversation_deleting_at
  from public.conversations conversation
  where conversation.id = new.conversation_id
  for share;

  if not found or conversation_deleting_at is not null then
    raise exception using errcode = '55000', message = 'This conversation is being deleted.';
  end if;
  return new;
end;
$$;

create trigger require_active_conversation_before_message
  before insert on public.messages
  for each row execute function private.require_active_conversation_for_message();

revoke all on function private.require_active_conversation_for_message() from public, anon, authenticated;

create or replace function private.promote_group_admin_after_member_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'
    and exists (
      select 1 from public.conversations conversation
      where conversation.id = old.conversation_id
        and conversation.kind = 'group'
    )
    and not exists (
      select 1 from public.conversation_members member
      where member.conversation_id = old.conversation_id
        and member.role = 'admin'
    )
  then
    update public.conversation_members member
    set role = 'admin'
    where member.conversation_id = old.conversation_id
      and member.user_id = (
        select candidate.user_id
        from public.conversation_members candidate
        where candidate.conversation_id = old.conversation_id
        order by candidate.joined_at, candidate.user_id
        limit 1
      );
  end if;
  return old;
end;
$$;

create trigger promote_group_admin_after_member_deletion
  after delete on public.conversation_members
  for each row execute function private.promote_group_admin_after_member_deletion();

revoke all on function private.promote_group_admin_after_member_deletion() from public, anon, authenticated;

create or replace function private.remove_general_messages_for_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.messages message
  using public.conversations conversation
  where message.conversation_id = conversation.id
    and conversation.kind = 'general'
    and message.sender_id = old.id;
  return old;
end;
$$;

create trigger remove_general_messages_before_user_deletion
  before delete on auth.users
  for each row execute function private.remove_general_messages_for_deleted_user();

revoke all on function private.remove_general_messages_for_deleted_user() from public, anon, authenticated;

create or replace function public.create_group_conversation(p_title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  conversation_id uuid;
  group_title text := btrim(p_title);
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if group_title is null or char_length(group_title) not between 1 and 40 then
    raise exception using errcode = '22023', message = 'The group name must be 1-40 characters.';
  end if;

  insert into public.conversations (kind, title, created_by)
  values ('group', group_title, actor_id)
  returning id into conversation_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (conversation_id, actor_id, 'admin');
  return conversation_id;
end;
$$;

create or replace function public.get_group_conversation_list()
returns table (
  conversation_id uuid,
  title text,
  avatar_path text,
  latest_message text,
  latest_message_at timestamptz,
  unread_count integer,
  member_count integer,
  my_role text,
  deletion_pending boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.id,
    conversation.title,
    conversation.avatar_path,
    latest.body,
    latest.created_at,
    (
      select count(*)::integer
      from public.messages unread
      where unread.conversation_id = conversation.id
        and unread.deleted_at is null
        and unread.sender_id is distinct from (select auth.uid())
        and (membership.last_read_at is null or unread.created_at > membership.last_read_at)
        and not private.is_message_hidden_for_current_user(unread.id)
    ),
    (
      select count(*)::integer
      from public.conversation_members members
      where members.conversation_id = conversation.id
    ),
    membership.role,
    conversation.deleting_at is not null
  from public.conversations conversation
  join public.conversation_members membership
    on membership.conversation_id = conversation.id
    and membership.user_id = (select auth.uid())
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
    and conversation.kind = 'group'
  order by latest.created_at desc nulls last, conversation.id;
$$;

create or replace function public.get_group_members(p_conversation_id uuid)
returns table (user_id uuid, username text, avatar_url text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if not exists (
    select 1
    from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id
    where member.conversation_id = p_conversation_id
      and member.user_id = (select auth.uid())
      and conversation.kind = 'group'
      and conversation.deleting_at is null
  ) and not public.is_administrator() then
    raise exception using errcode = '42501', message = 'You are not a member of this group.';
  end if;

  return query
    select member.user_id, profile.username, profile.avatar_url, member.role
    from public.conversation_members member
    join public.profiles profile on profile.id = member.user_id
    where member.conversation_id = p_conversation_id
    order by member.role desc, profile.username;
end;
$$;

create or replace function public.open_group_conversation(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if not exists (
    select 1
    from public.conversation_members member
    join public.conversations conversation on conversation.id = member.conversation_id
    where member.conversation_id = p_conversation_id
      and member.user_id = (select auth.uid())
      and conversation.kind = 'group'
      and conversation.deleting_at is null
  ) then
    raise exception using errcode = '42501', message = 'This group is unavailable.';
  end if;
  return p_conversation_id;
end;
$$;

create or replace function public.create_group_invite(p_conversation_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  perform 1
  from public.conversations conversation
  where conversation.id = p_conversation_id
    and conversation.kind = 'group'
    and conversation.deleting_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'This group is unavailable.';
  end if;
  if not private.is_group_admin(p_conversation_id, actor_id) then
    raise exception using errcode = '42501', message = 'Only group admins can create invite links.';
  end if;

  update public.group_invites invite
  set revoked_at = now()
  where invite.conversation_id = p_conversation_id
    and invite.revoked_at is null;

  insert into public.group_invites (
    token_hash, conversation_id, created_by, expires_at, max_uses
  )
  values (
    encode(extensions.digest(token, 'sha256'), 'hex'),
    p_conversation_id,
    actor_id,
    now() + interval '7 days',
    50
  );
  return token;
end;
$$;

create or replace function public.join_group_by_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  invite public.group_invites%rowtype;
  invite_conversation_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'This group invite link is invalid or expired.';
  end if;

  select candidate.conversation_id into invite_conversation_id
  from public.group_invites candidate
  where candidate.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if invite_conversation_id is null then
    raise exception using errcode = 'P0002', message = 'This group invite link is invalid or expired.';
  end if;

  perform 1
  from public.conversations conversation
  where conversation.id = invite_conversation_id
    and conversation.kind = 'group'
    and conversation.deleting_at is null
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'This group invite link is invalid or expired.';
  end if;

  select * into invite
  from public.group_invites candidate
  where candidate.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  for update;

  if not found
    or invite.revoked_at is not null
    or invite.expires_at <= now()
    or invite.uses >= invite.max_uses
    or invite.conversation_id <> invite_conversation_id
  then
    raise exception using errcode = 'P0002', message = 'This group invite link is invalid or expired.';
  end if;

  if exists (
    select 1 from public.conversation_members member
    where member.conversation_id = invite.conversation_id
      and member.user_id = actor_id
  ) then
    return invite.conversation_id;
  end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (invite.conversation_id, actor_id, 'member')
  on conflict (conversation_id, user_id) do nothing;
  if not found then
    return invite.conversation_id;
  end if;
  update public.group_invites
  set uses = uses + 1
  where token_hash = invite.token_hash;
  return invite.conversation_id;
end;
$$;

create or replace function public.change_group_member_role(
  p_conversation_id uuid,
  p_user_id uuid,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_role text;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if p_role not in ('member', 'admin') then
    raise exception using errcode = '22023', message = 'Choose a valid group role.';
  end if;
  perform 1
  from public.conversations conversation
  where conversation.id = p_conversation_id
    and conversation.kind = 'group'
    and conversation.deleting_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'This group is unavailable.';
  end if;
  if not private.is_group_admin(p_conversation_id, actor_id) then
    raise exception using errcode = '42501', message = 'Only group admins can change group roles.';
  end if;

  select member.role into current_role
  from public.conversation_members member
  where member.conversation_id = p_conversation_id
    and member.user_id = p_user_id
  for update;
  if current_role is null then
    raise exception using errcode = 'P0002', message = 'That group member is unavailable.';
  end if;
  if current_role = 'admin'
    and p_role = 'member'
    and (
      select count(*) from public.conversation_members member
      where member.conversation_id = p_conversation_id
        and member.role = 'admin'
    ) <= 1
  then
    raise exception using errcode = '23514', message = 'A group must keep at least one admin.';
  end if;

  update public.conversation_members
  set role = p_role
  where conversation_id = p_conversation_id
    and user_id = p_user_id;
  return p_user_id;
end;
$$;

create or replace function public.update_group_settings(
  p_conversation_id uuid,
  p_title text,
  p_avatar_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  group_title text := btrim(p_title);
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if group_title is null or char_length(group_title) not between 1 and 40 then
    raise exception using errcode = '22023', message = 'The group name must be 1-40 characters.';
  end if;
  if not private.is_group_admin(p_conversation_id, actor_id) then
    raise exception using errcode = '42501', message = 'Only group admins can edit group details.';
  end if;
  if p_avatar_path is not null and (
    split_part(p_avatar_path, '/', 1) <> p_conversation_id::text
    or split_part(p_avatar_path, '/', 2) !~ '^[0-9a-f-]{36}\.(jpg|png|webp)$'
    or split_part(p_avatar_path, '/', 3) <> ''
  ) then
    raise exception using errcode = '22023', message = 'The group photo path is invalid.';
  end if;

  update public.conversations
  set title = group_title,
      avatar_path = p_avatar_path,
      updated_at = now()
  where id = p_conversation_id
    and kind = 'group'
    and deleting_at is null;
  if not found then
    raise exception using errcode = 'P0002', message = 'This group is unavailable.';
  end if;
  return p_conversation_id;
end;
$$;

create or replace function public.leave_group(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  perform 1
  from public.conversations conversation
  where conversation.id = p_conversation_id
    and conversation.kind = 'group'
    and conversation.deleting_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'This group is unavailable.';
  end if;

  select member.role into actor_role
  from public.conversation_members member
  join public.conversations conversation on conversation.id = member.conversation_id
  where member.conversation_id = p_conversation_id
    and member.user_id = actor_id
    and conversation.kind = 'group'
    and conversation.deleting_at is null
  for update of member;
  if actor_role is null then
    raise exception using errcode = '42501', message = 'You are not a member of this group.';
  end if;
  if actor_role = 'admin'
    and (
      select count(*) from public.conversation_members member
      where member.conversation_id = p_conversation_id
        and member.role = 'admin'
    ) <= 1
  then
    raise exception using errcode = '23514', message = 'Promote another group admin before leaving.';
  end if;

  delete from public.conversation_members
  where conversation_id = p_conversation_id
    and user_id = actor_id;
  return p_conversation_id;
end;
$$;

create or replace function public.get_all_groups_for_administrator()
returns table (conversation_id uuid, title text, avatar_path text, member_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_administrator() then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  return query
    select conversation.id, conversation.title, conversation.avatar_path,
      (select count(*)::integer from public.conversation_members member
       where member.conversation_id = conversation.id)
    from public.conversations conversation
    where conversation.kind = 'group'
    order by conversation.created_at desc;
end;
$$;

drop function if exists public.get_private_conversation_list();

create function public.get_private_conversation_list()
returns table (
  conversation_id uuid,
  peer_id uuid,
  peer_username text,
  peer_avatar_url text,
  latest_message text,
  latest_message_at timestamptz,
  unread_count integer,
  last_read_at timestamptz,
  deletion_pending boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    conversation.id,
    peer.user_id,
    coalesce(profile.username, 'User deleted'),
    profile.avatar_url,
    latest.body,
    latest.created_at,
    (
      select count(*)::integer
      from public.messages unread
      where unread.conversation_id = conversation.id
        and unread.deleted_at is null
        and unread.sender_id is distinct from (select auth.uid())
        and (membership.last_read_at is null or unread.created_at > membership.last_read_at)
        and not private.is_message_hidden_for_current_user(unread.id)
    ),
    membership.last_read_at,
    conversation.deleting_at is not null
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
    and conversation.kind = 'private'
    and conversation.deleting_at is null;
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
  if exists (
    select 1 from public.conversations conversation
    where conversation.id = private_conversation_id
      and conversation.deleting_at is not null
  ) then
    raise exception using errcode = '55000', message = 'This conversation is being deleted. Try again shortly.';
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (private_conversation_id, low_user_id), (private_conversation_id, high_user_id)
  on conflict (conversation_id, user_id) do nothing;
  update public.conversation_members
  set hidden_at = null
  where conversation_id = private_conversation_id
    and user_id = current_user_id;
  return private_conversation_id;
end;
$$;

create or replace function public.delete_group_message(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  message_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  update public.messages message
  set body = 'This message was deleted by a group admin.',
      deleted_at = now()
  from public.conversations conversation
  where message.id = p_message_id
    and conversation.id = message.conversation_id
    and conversation.kind = 'group'
    and conversation.deleting_at is null
    and message.system_event is null
    and message.deleted_at is null
    and private.has_conversation_access(conversation.id)
    and (
      private.is_group_admin(conversation.id, actor_id)
      or exists (
        select 1 from public.administrators administrator
        where administrator.user_id = actor_id
      )
    )
  returning message.id into message_id;
  if message_id is null then
    raise exception using errcode = '42501', message = 'This group message cannot be deleted.';
  end if;
  return message_id;
end;
$$;

create or replace function public.start_conversation_deletion(p_conversation_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  conversation public.conversations%rowtype;
  job public.conversation_deletion_jobs%rowtype;
begin
  if p_actor_id is null then
    raise exception using errcode = '22023', message = 'Invalid conversation deletion request.';
  end if;

  select * into conversation
  from public.conversations candidate
  where candidate.id = p_conversation_id
  for update;
  if not found then
    return null;
  end if;
  if conversation.kind = 'general' then
    raise exception using errcode = '42501', message = 'The Support Circle cannot be deleted.';
  end if;

  if conversation.kind = 'private' then
    if not exists (
      select 1 from public.conversation_members member
      where member.conversation_id = p_conversation_id
        and member.user_id = p_actor_id
    ) then
      raise exception using errcode = '42501', message = 'You are not a member of this private conversation.';
    end if;
  elsif conversation.kind = 'group' then
    if not exists (
      select 1 from public.administrators administrator
      where administrator.user_id = p_actor_id
    )
      and not private.is_group_admin(p_conversation_id, p_actor_id)
    then
      raise exception using errcode = '42501', message = 'Only a group admin can delete this group.';
    end if;
  else
    raise exception using errcode = '22023', message = 'This conversation cannot be deleted.';
  end if;

  select * into job
  from public.conversation_deletion_jobs candidate
  where candidate.conversation_id = p_conversation_id
  for update;

  if job.id is null then
    insert into public.conversation_deletion_jobs (
      conversation_id, kind, actor_id, avatar_path
    )
    values (
      p_conversation_id, conversation.kind, p_actor_id, conversation.avatar_path
    )
    returning * into job;

    insert into public.conversation_deletion_media (job_id, object_path)
    select job.id, media.object_path
    from public.message_media media
    where media.conversation_id = p_conversation_id
    on conflict do nothing;

    update public.conversations
    set deleting_at = now()
    where id = p_conversation_id;
    update public.conversation_members
    set hidden_at = null
    where conversation_id = p_conversation_id;
  end if;
  return jsonb_build_object('job_id', job.id, 'kind', job.kind);
end;
$$;

create or replace function public.complete_conversation_deletion(p_job_id uuid, p_actor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.conversation_deletion_jobs%rowtype;
begin
  select * into job
  from public.conversation_deletion_jobs candidate
  where candidate.id = p_job_id
  for update;
  if not found then
    return true;
  end if;

  if job.kind = 'private' then
    if not exists (
      select 1 from public.conversation_members member
      where member.conversation_id = job.conversation_id
        and member.user_id = p_actor_id
    ) then
      raise exception using errcode = '42501', message = 'You are not a member of this private conversation.';
    end if;
  elsif job.kind = 'group'
    and not exists (
      select 1 from public.administrators administrator
      where administrator.user_id = p_actor_id
    )
    and not private.is_group_admin(job.conversation_id, p_actor_id)
  then
    raise exception using errcode = '42501', message = 'Only a group admin can delete this group.';
  end if;

  if not exists (
    select 1 from public.conversations conversation
    where conversation.id = job.conversation_id
      and conversation.kind = job.kind
  ) then
    delete from public.conversation_deletion_jobs where id = job.id;
    return true;
  end if;

  delete from public.conversations
  where id = job.conversation_id
    and kind = job.kind
    and deleting_at is not null;
  if not found then
    raise exception using errcode = 'P0002', message = 'The conversation deletion could not be completed.';
  end if;
  delete from public.conversation_deletion_jobs where id = job.id;
  return true;
end;
$$;

create or replace function public.set_my_username(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized text := lower(btrim(p_username));
  old_username text;
  updated_username text;
  general_conversation_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if not private.is_valid_username(normalized) then
    raise exception using errcode = '22023', message = 'Username must be 3-24 letters, numbers, periods, underscores, emoji, or single-spaced words.';
  end if;

  select profile.username into old_username
  from public.profiles profile
  where profile.id = actor_id
  for update;
  if old_username is null then
    raise exception using errcode = 'P0002', message = 'Profile not found.';
  end if;

  update public.profiles
  set username = btrim(p_username), updated_at = now()
  where id = actor_id
  returning username into updated_username;

  if old_username is distinct from updated_username then
    select conversation.id into general_conversation_id
    from public.conversations conversation
    where conversation.kind = 'general'
    limit 1;
    if general_conversation_id is null then
      raise exception using errcode = 'P0002', message = 'The Support Circle conversation was not found.';
    end if;

    insert into public.messages (conversation_id, sender_id, body, system_event)
    values (
      general_conversation_id,
      actor_id,
      format('@%s changed their username.', old_username),
      'username_changed'
    );
  end if;
  return updated_username;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'That username is already taken.';
end;
$$;

update public.messages message
set sender_id = profile.id
from public.conversations conversation, public.profiles profile
where message.conversation_id = conversation.id
  and conversation.kind = 'general'
  and message.system_event = 'username_changed'
  and message.sender_id is null
  and right(message.body, length(format(' to @%s.', profile.username))) = format(' to @%s.', profile.username);

update public.messages
set body = regexp_replace(body, ' changed their username to @.*\.$', ' changed their username.')
where system_event = 'username_changed'
  and sender_id is not null;

update public.messages
set body = 'A community member changed their username.'
where system_event = 'username_changed'
  and sender_id is null;

delete from public.messages message
using public.conversations conversation
where message.conversation_id = conversation.id
  and conversation.kind = 'general'
  and message.sender_id is null
  and message.system_event is null;

drop policy if exists "Group admins can upload group avatars" on storage.objects;
create policy "Group admins can upload group avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'isomo-community-assets'
    and split_part(name, '/', 1) ~ '^[0-9a-f-]{36}$'
    and split_part(name, '/', 2) ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$'
    and split_part(name, '/', 3) = ''
    and exists (
      select 1 from public.conversations conversation
      where conversation.id::text = split_part(name, '/', 1)
        and conversation.kind = 'group'
        and conversation.deleting_at is null
        and (
          private.is_group_admin(conversation.id, (select auth.uid()))
          or public.is_administrator()
        )
    )
  );

drop policy if exists "Group admins can delete group avatars" on storage.objects;
create policy "Group admins can delete group avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'isomo-community-assets'
    and exists (
      select 1 from public.conversations conversation
      where conversation.id::text = split_part(name, '/', 1)
        and conversation.kind = 'group'
        and (
          private.is_group_admin(conversation.id, (select auth.uid()))
          or public.is_administrator()
        )
    )
  );

revoke all on function public.create_group_conversation(text) from public, anon;
grant execute on function public.create_group_conversation(text) to authenticated;
revoke all on function public.get_group_conversation_list() from public, anon;
grant execute on function public.get_group_conversation_list() to authenticated;
revoke all on function public.get_group_members(uuid) from public, anon;
grant execute on function public.get_group_members(uuid) to authenticated;
revoke all on function public.open_group_conversation(uuid) from public, anon;
grant execute on function public.open_group_conversation(uuid) to authenticated;
revoke all on function public.create_group_invite(uuid) from public, anon;
grant execute on function public.create_group_invite(uuid) to authenticated;
revoke all on function public.join_group_by_invite(text) from public, anon;
grant execute on function public.join_group_by_invite(text) to authenticated;
revoke all on function public.change_group_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.change_group_member_role(uuid, uuid, text) to authenticated;
revoke all on function public.update_group_settings(uuid, text, text) from public, anon;
grant execute on function public.update_group_settings(uuid, text, text) to authenticated;
revoke all on function public.leave_group(uuid) from public, anon;
grant execute on function public.leave_group(uuid) to authenticated;
revoke all on function public.get_all_groups_for_administrator() from public, anon;
grant execute on function public.get_all_groups_for_administrator() to authenticated;
revoke all on function public.delete_group_message(uuid) from public, anon;
grant execute on function public.delete_group_message(uuid) to authenticated;
revoke all on function public.start_conversation_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_conversation_deletion(uuid, uuid) to service_role;
revoke all on function public.complete_conversation_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_conversation_deletion(uuid, uuid) to service_role;
revoke all on function public.get_private_conversation_list() from public, anon;
grant execute on function public.get_private_conversation_list() to authenticated;
revoke all on function public.open_private_conversation(uuid) from public, anon;
grant execute on function public.open_private_conversation(uuid) to authenticated;
revoke all on function public.get_or_create_private_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_private_conversation(uuid) to authenticated;
revoke all on function public.set_my_username(text) from public, anon;
grant execute on function public.set_my_username(text) to authenticated;
