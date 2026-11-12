alter table public.conversations
  add column if not exists participant_low uuid references auth.users (id) on delete cascade,
  add column if not exists participant_high uuid references auth.users (id) on delete cascade;

do $$
begin
  if exists (
    select 1
    from public.conversations c
    left join public.conversation_members cm on cm.conversation_id = c.id
    where c.kind = 'private'
    group by c.id
    having count(cm.user_id) <> 2
  ) then
    raise exception 'Every existing private conversation must have exactly two members before this migration.';
  end if;

  update public.conversations c
  set participant_low = members.low_id,
      participant_high = members.high_id
  from (
    select
      conversation_id,
      (array_agg(user_id order by user_id))[1] as low_id,
      (array_agg(user_id order by user_id))[2] as high_id
    from public.conversation_members
    group by conversation_id
  ) members
  where c.id = members.conversation_id
    and c.kind = 'private'
    and c.participant_low is null
    and c.participant_high is null;

  if not exists (
    select 1 from pg_constraint
    where conname = 'conversations_private_participants_check'
      and conrelid = 'public.conversations'::regclass
  ) then
    alter table public.conversations
      add constraint conversations_private_participants_check
      check (
        (kind = 'general' and participant_low is null and participant_high is null)
        or (
          kind = 'private'
          and participant_low is not null
          and participant_high is not null
          and participant_low < participant_high
        )
      );
  end if;
end;
$$;

create unique index if not exists conversations_private_pair_unique
  on public.conversations (participant_low, participant_high)
  where kind = 'private';

drop policy if exists "Members can send messages to conversations they joined" on public.messages;
create policy "Members can send messages to conversations they joined"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.has_conversation_access(conversation_id)
    and (
      reply_to_id is null
      or exists (
        select 1
        from public.messages parent
        where parent.id = messages.reply_to_id
          and parent.conversation_id = messages.conversation_id
          and private.has_conversation_access(parent.conversation_id)
      )
    )
  );

create or replace function private.has_conversation_access(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id = p_conversation_id
        and cm.user_id = (select auth.uid())
    );
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

  insert into public.conversations (
    kind, created_by, participant_low, participant_high
  )
  values (
    'private', current_user_id, low_user_id, high_user_id
  )
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

  return private_conversation_id;
end;
$$;

revoke all on function public.get_or_create_private_conversation(uuid) from public, anon;
grant execute on function public.get_or_create_private_conversation(uuid) to authenticated;
revoke all on function private.has_conversation_access(uuid) from public, anon, authenticated;
grant execute on function private.has_conversation_access(uuid) to authenticated;

revoke select on public.administrators from authenticated;
grant select (user_id) on public.administrators to authenticated;
drop policy if exists "Administrators can read their own role" on public.administrators;
create policy "Members can read administrator indicators"
  on public.administrators for select to authenticated
  using ((select auth.uid()) is not null);
