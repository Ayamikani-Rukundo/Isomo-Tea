create table public.message_polls (
  message_id uuid primary key references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  question text not null check (length(btrim(question)) between 3 and 300),
  closes_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.message_polls (message_id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 120),
  position smallint not null check (position between 0 and 5),
  unique (message_id, position),
  unique (message_id, id)
);

create table public.poll_votes (
  message_id uuid not null references public.message_polls (message_id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  option_id uuid not null,
  cast_at timestamptz not null default now(),
  primary key (message_id, user_id),
  foreign key (message_id, option_id)
    references public.poll_options (message_id, id) on delete cascade
);

create table public.message_stickers (
  message_id uuid primary key references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sticker_code text not null check (
    sticker_code in ('tea', 'leaf', 'sparkle', 'frog', 'teapot', 'heart', 'herb', 'coffee')
  )
);

create table public.message_mentions (
  message_id uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  mentioned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (message_id, user_id)
);

create index message_mentions_unread on public.message_mentions (user_id, created_at desc)
  where read_at is null;

alter table public.message_polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.message_stickers enable row level security;
alter table public.message_mentions enable row level security;

revoke all on public.message_polls, public.poll_options, public.poll_votes,
  public.message_stickers, public.message_mentions from anon, authenticated;
grant select on public.message_polls, public.poll_options, public.poll_votes, public.message_stickers to authenticated;
grant select on public.message_mentions to authenticated;

create policy "Conversation members can read polls"
  on public.message_polls for select to authenticated
  using (private.has_conversation_access(conversation_id));
create policy "Conversation members can read poll options"
  on public.poll_options for select to authenticated
  using (exists (
    select 1 from public.message_polls poll
    where poll.message_id = poll_options.message_id
      and private.has_conversation_access(poll.conversation_id)
  ));
create policy "Members can read votes in their conversations"
  on public.poll_votes for select to authenticated
  using (private.has_conversation_access(conversation_id));
create policy "Conversation members can read stickers"
  on public.message_stickers for select to authenticated
  using (private.has_conversation_access(conversation_id));
create policy "Members can read their own mention notifications"
  on public.message_mentions for select to authenticated
  using (
    user_id = (select auth.uid())
    and private.has_conversation_access(conversation_id)
  );

create or replace function public.create_message_poll(
  p_message_id uuid,
  p_conversation_id uuid,
  p_question text,
  p_options text[],
  p_reply_to_id uuid default null,
  p_closes_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_message_id is null or p_conversation_id is null
    or p_question is null or length(btrim(p_question)) not between 3 and 300
    or p_options is null or cardinality(p_options) not between 2 and 6
    or (p_closes_at is not null and p_closes_at <= now()) then
    raise exception 'Invalid poll data' using errcode = '22023';
  end if;
  if not private.has_conversation_access(p_conversation_id) then
    raise exception 'Conversation access denied' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(p_options) option_label
    where length(btrim(option_label)) not between 1 and 120
  ) or (
    select count(distinct lower(btrim(option_label))) from unnest(p_options) option_label
  ) <> cardinality(p_options) then
    raise exception 'Poll options must be non-empty and unique' using errcode = '22023';
  end if;
  if p_reply_to_id is not null and not exists (
    select 1 from public.messages
    where id = p_reply_to_id
      and conversation_id = p_conversation_id
      and deleted_at is null
  ) then
    raise exception 'Reply target is unavailable' using errcode = '22023';
  end if;

  insert into public.messages (id, conversation_id, sender_id, body, reply_to_id)
  values (p_message_id, p_conversation_id, caller_id, btrim(p_question), p_reply_to_id);
  insert into public.message_polls (message_id, conversation_id, created_by, question, closes_at)
  values (p_message_id, p_conversation_id, caller_id, btrim(p_question), p_closes_at);
  insert into public.poll_options (message_id, label, position)
  select p_message_id, btrim(option_label), (ordinality - 1)::smallint
  from unnest(p_options) with ordinality as options(option_label, ordinality);

  return p_message_id;
end;
$$;

create or replace function public.cast_poll_vote(p_message_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  room_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select conversation_id into room_id
  from public.message_polls
  where message_id = p_message_id
    and (closes_at is null or closes_at > now());
  if room_id is null or not private.has_conversation_access(room_id) then
    raise exception 'Poll is unavailable or closed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.poll_options
    where message_id = p_message_id and id = p_option_id
  ) then
    raise exception 'Choose an option from this poll' using errcode = '22023';
  end if;
  insert into public.poll_votes (message_id, conversation_id, user_id, option_id)
  values (p_message_id, room_id, caller_id, p_option_id)
  on conflict (message_id, user_id)
  do update set option_id = excluded.option_id, cast_at = now();
end;
$$;

create or replace function public.get_poll_results(p_conversation_id uuid, p_message_ids uuid[])
returns table (message_id uuid, option_id uuid, vote_count bigint, my_vote boolean)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select option.message_id,
         option.id,
         count(vote.user_id),
         coalesce(bool_or(vote.user_id = auth.uid()), false)
  from public.poll_options option
  join public.message_polls poll on poll.message_id = option.message_id
  left join public.poll_votes vote
    on vote.message_id = option.message_id
    and vote.option_id = option.id
  where poll.conversation_id = p_conversation_id
    and option.message_id = any(p_message_ids)
    and private.has_conversation_access(p_conversation_id)
  group by option.message_id, option.id, option.position
  order by option.message_id, option.position;
$$;

create or replace function public.create_sticker_message(
  p_message_id uuid,
  p_conversation_id uuid,
  p_sticker_code text,
  p_reply_to_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_sticker_code is null
    or p_sticker_code not in ('tea', 'leaf', 'sparkle', 'frog', 'teapot', 'heart', 'herb', 'coffee')
    or not private.has_conversation_access(p_conversation_id) then
    raise exception 'Sticker or conversation is unavailable' using errcode = '42501';
  end if;
  if p_reply_to_id is not null and not exists (
    select 1 from public.messages
    where id = p_reply_to_id
      and conversation_id = p_conversation_id
      and deleted_at is null
  ) then
    raise exception 'Reply target is unavailable' using errcode = '22023';
  end if;
  insert into public.messages (id, conversation_id, sender_id, body, reply_to_id)
  values (p_message_id, p_conversation_id, caller_id, 'Sticker', p_reply_to_id);
  insert into public.message_stickers (message_id, conversation_id, sticker_code)
  values (p_message_id, p_conversation_id, p_sticker_code);
  return p_message_id;
end;
$$;

create or replace function public.mark_mentions_read(p_message_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  updated_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  update public.message_mentions mention
  set read_at = now()
  where mention.user_id = auth.uid()
    and mention.message_id = any(p_message_ids)
    and mention.read_at is null
    and private.has_conversation_access(mention.conversation_id);
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create or replace function private.notify_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    delete from public.message_mentions where message_id = new.id;
    if new.deleted_at is not null then
      return new;
    end if;
  end if;

  insert into public.message_mentions (message_id, conversation_id, user_id, mentioned_by)
  select distinct new.id, new.conversation_id, profile.id, new.sender_id
  from regexp_matches(new.body, '@([A-Za-z0-9._]{3,24})', 'g') as captures(username)
  join public.profiles profile on profile.username_normalized = lower(captures.username[1])
  join public.conversation_members member
    on member.conversation_id = new.conversation_id
    and member.user_id = profile.id
  where profile.id <> new.sender_id
  on conflict (message_id, user_id) do nothing;
  return new;
end;
$$;

create trigger notify_message_mentions_after_insert
  after insert or update of body, deleted_at on public.messages
  for each row execute function private.notify_message_mentions();

revoke all on function private.notify_message_mentions() from public, anon, authenticated;
revoke all on function public.create_message_poll(uuid, uuid, text, text[], uuid, timestamptz) from public, anon;
grant execute on function public.create_message_poll(uuid, uuid, text, text[], uuid, timestamptz) to authenticated;
revoke all on function public.cast_poll_vote(uuid, uuid) from public, anon;
grant execute on function public.cast_poll_vote(uuid, uuid) to authenticated;
revoke all on function public.get_poll_results(uuid, uuid[]) from public, anon;
grant execute on function public.get_poll_results(uuid, uuid[]) to authenticated;
revoke all on function public.create_sticker_message(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.create_sticker_message(uuid, uuid, text, uuid) to authenticated;
revoke all on function public.mark_mentions_read(uuid[]) from public, anon;
grant execute on function public.mark_mentions_read(uuid[]) to authenticated;

do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication is required for community interactions.';
  end if;
  foreach table_name in array array['message_polls', 'poll_votes', 'message_mentions']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
