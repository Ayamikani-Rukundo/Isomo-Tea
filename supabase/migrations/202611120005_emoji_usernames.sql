create or replace function private.is_valid_username(p_username text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_username is not null
    and char_length(p_username) between 3 and 24
    and (p_username collate "C") ~ U&'^[A-Za-z0-9._#*\+0000A9\+0000AE\+00203C\+002049\+002122\+002139\+002194-\+0021FF\+002300-\+0023FF\+0024C2\+0025AA-\+0025FE\+002600-\+0027BF\+002934-\+002935\+002B00-\+002BFF\+01F000-\+01FAFF\+00200D\+00FE0E-\+00FE0F\+0020E3\+0E0020-\+0E007F]+( [A-Za-z0-9._#*\+0000A9\+0000AE\+00203C\+002049\+002122\+002139\+002194-\+0021FF\+002300-\+0023FF\+0024C2\+0025AA-\+0025FE\+002600-\+0027BF\+002934-\+002935\+002B00-\+002BFF\+01F000-\+01FAFF\+00200D\+00FE0E-\+00FE0F\+0020E3\+0E0020-\+0E007F]+)*$';
$$;

revoke all on function private.is_valid_username(text) from public, anon, authenticated;

alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format
  check (
    char_length(username) between 3 and 24
    and (username collate "C") ~ U&'^[A-Za-z0-9._#*\+0000A9\+0000AE\+00203C\+002049\+002122\+002139\+002194-\+0021FF\+002300-\+0023FF\+0024C2\+0025AA-\+0025FE\+002600-\+0027BF\+002934-\+002935\+002B00-\+002BFF\+01F000-\+01FAFF\+00200D\+00FE0E-\+00FE0F\+0020E3\+0E0020-\+0E007F]+( [A-Za-z0-9._#*\+0000A9\+0000AE\+00203C\+002049\+002122\+002139\+002194-\+0021FF\+002300-\+0023FF\+0024C2\+0025AA-\+0025FE\+002600-\+0027BF\+002934-\+002935\+002B00-\+002BFF\+01F000-\+01FAFF\+00200D\+00FE0E-\+00FE0F\+0020E3\+0E0020-\+0E007F]+)*$'
  );

create or replace function public.username_is_available(p_username text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized text := lower(btrim(p_username));
begin
  if not private.is_valid_username(normalized) then
    return false;
  end if;
  return not exists (
    select 1
    from public.profiles profile
    where profile.username_normalized = normalized
  );
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
  old_mention text;
  updated_mention text;
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
      raise exception using errcode = 'P0002', message = 'The community conversation was not found.';
    end if;

    old_mention := case
      when position(' ' in old_username) > 0 then format('@"%s"', old_username)
      else '@' || old_username
    end;
    updated_mention := case
      when position(' ' in updated_username) > 0 then format('@"%s"', updated_username)
      else '@' || updated_username
    end;
    insert into public.messages (conversation_id, sender_id, body, system_event)
    values (
      general_conversation_id,
      null,
      format('%s changed their username to %s.', old_mention, updated_mention),
      'username_changed'
    );
  end if;

  return updated_username;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'That username is already taken.';
end;
$$;

create or replace function private.notify_message_mentions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.system_event is not null then
    if tg_op = 'UPDATE' then
      delete from public.message_mentions where message_id = new.id;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    delete from public.message_mentions where message_id = new.id;
    if new.deleted_at is not null then
      return new;
    end if;
  end if;

  insert into public.message_mentions (message_id, conversation_id, user_id, mentioned_by)
  select distinct new.id, new.conversation_id, profile.id, new.sender_id
  from regexp_matches(
    new.body,
    U&'@"([A-Za-z0-9._#*\+0000A9\+0000AE\+00203C\+002049\+002122\+002139\+002194-\+0021FF\+002300-\+0023FF\+0024C2\+0025AA-\+0025FE\+002600-\+0027BF\+002934-\+002935\+002B00-\+002BFF\+01F000-\+01FAFF\+00200D\+00FE0E-\+00FE0F\+0020E3\+0E0020-\+0E007F]+(?: [A-Za-z0-9._#*\+0000A9\+0000AE\+00203C\+002049\+002122\+002139\+002194-\+0021FF\+002300-\+0023FF\+0024C2\+0025AA-\+0025FE\+002600-\+0027BF\+002934-\+002935\+002B00-\+002BFF\+01F000-\+01FAFF\+00200D\+00FE0E-\+00FE0F\+0020E3\+0E0020-\+0E007F]+)*)"|@([A-Za-z0-9._#*\+0000A9\+0000AE\+00203C\+002049\+002122\+002139\+002194-\+0021FF\+002300-\+0023FF\+0024C2\+0025AA-\+0025FE\+002600-\+0027BF\+002934-\+002935\+002B00-\+002BFF\+01F000-\+01FAFF\+00200D\+00FE0E-\+00FE0F\+0020E3\+0E0020-\+0E007F]{3,24})',
    'g'
  ) as captures(username)
  join public.profiles profile
    on profile.username_normalized = lower(coalesce(captures.username[1], captures.username[2]))
  join public.conversation_members member
    on member.conversation_id = new.conversation_id
    and member.user_id = profile.id
  where profile.id <> new.sender_id
  on conflict (message_id, user_id) do nothing;
  return new;
end;
$$;
