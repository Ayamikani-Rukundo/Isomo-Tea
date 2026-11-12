alter table public.conversations
  add column if not exists avatar_path text;

alter table public.messages
  add column if not exists system_event text;

alter table public.messages
  drop constraint if exists messages_system_event_check;
alter table public.messages
  add constraint messages_system_event_check
  check (system_event is null or system_event = 'username_changed');

update public.conversations
set title = 'Delta Tea'
where kind = 'general'
  and title = 'General Tea';

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
  if normalized !~ '^[a-z0-9._]{3,24}$' then
    raise exception using errcode = '22023', message = 'Username must be 3-24 letters, numbers, periods, or underscores.';
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

    insert into public.messages (conversation_id, sender_id, body, system_event)
    values (
      general_conversation_id,
      null,
      format('@%s changed their username to @%s.', old_username, updated_username),
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

drop policy if exists "Members can send messages to conversations they joined" on public.messages;
create policy "Members can send messages to conversations they joined"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and system_event is null
    and private.has_conversation_access(conversation_id)
  );

create or replace function public.admin_update_general_conversation(
  p_title text,
  p_avatar_path text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  general_conversation_id uuid;
  previous_title text;
  previous_avatar_path text;
  normalized_title text := btrim(p_title);
begin
  if p_actor_id is null or not exists (
    select 1 from public.administrators where user_id = p_actor_id
  ) then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if normalized_title is null or length(normalized_title) < 1 or length(normalized_title) > 40 then
    raise exception using errcode = '22023', message = 'The group name must be 1-40 characters.';
  end if;
  select conversation.id, conversation.title, conversation.avatar_path
  into general_conversation_id, previous_title, previous_avatar_path
  from public.conversations conversation
  where conversation.kind = 'general'
  for update;
  if general_conversation_id is null then
    raise exception using errcode = 'P0002', message = 'The community conversation was not found.';
  end if;
  if p_avatar_path is distinct from previous_avatar_path
    and p_avatar_path is not null
    and p_avatar_path !~ (
      '^' || p_actor_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
    ) then
    raise exception using errcode = '22023', message = 'Choose a valid uploaded group photo.';
  end if;

  update public.conversations
  set title = normalized_title,
      avatar_path = p_avatar_path
  where id = general_conversation_id;

  insert into public.admin_audit_log (actor_id, action, details)
  values (
    p_actor_id,
    'community.settings_updated',
    jsonb_build_object(
      'name_changed', previous_title is distinct from normalized_title,
      'photo_changed', previous_avatar_path is distinct from p_avatar_path
    )
  );

  return jsonb_build_object('previous_avatar_path', previous_avatar_path);
end;
$$;

revoke all on function public.admin_update_general_conversation(text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_update_general_conversation(text, text, uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'isomo-community-assets',
  'isomo-community-assets',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Signed-in members can read community avatars" on storage.objects;
create policy "Signed-in members can read community avatars"
  on storage.objects for select to authenticated
  using (bucket_id = 'isomo-community-assets');

drop policy if exists "Administrators can upload community avatars" on storage.objects;
create policy "Administrators can upload community avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'isomo-community-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_administrator())
  );

drop policy if exists "Administrators can delete community avatars" on storage.objects;
create policy "Administrators can delete community avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'isomo-community-assets'
    and (select public.is_administrator())
  );

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication is required for community profile updates.';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end;
$$;
