insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'isomo-chat-media',
  'isomo-chat-media',
  false,
  20971520,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg',
    'video/mp4', 'video/webm'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table public.message_media (
  message_id uuid primary key references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references auth.users (id) on delete set null,
  object_path text not null unique,
  media_kind text not null check (media_kind in ('image', 'audio', 'video')),
  mime_type text not null,
  byte_size bigint not null check (byte_size between 1 and 20971520),
  view_once boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint message_media_expiry_check check (
    (view_once and expires_at is not null)
    or (not view_once and expires_at is null)
  )
);

create index message_media_cleanup on public.message_media (expires_at)
  where view_once;

create table public.view_once_recipients (
  message_id uuid not null references public.message_media (message_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  claim_id uuid,
  claimed_at timestamptz,
  consumed_at timestamptz,
  primary key (message_id, user_id)
);

alter table public.message_media enable row level security;
alter table public.view_once_recipients enable row level security;
revoke all on public.message_media from anon, authenticated;
revoke all on public.view_once_recipients from anon, authenticated;
grant select on public.message_media to authenticated;

create policy "Conversation members can read media metadata"
  on public.message_media for select to authenticated
  using (
    private.has_conversation_access(conversation_id)
    and exists (
      select 1
      from public.messages message
      where message.id = message_media.message_id
        and message.deleted_at is null
        and not private.is_message_hidden_for_current_user(message.id)
    )
  );

drop policy if exists "Conversation members can upload chat media" on storage.objects;
create policy "Conversation members can upload chat media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'isomo-chat-media'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id::text = split_part(name, '/', 1)
        and cm.user_id = (select auth.uid())
    )
    and split_part(name, '/', 3) ~ '^[0-9a-f-]{36}\.(jpg|png|webp|gif|webm|m4a|ogg|mp3|mp4)$'
  );

drop policy if exists "Members can remove their own unregistered upload" on storage.objects;
create policy "Members can remove their own unregistered upload"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'isomo-chat-media'
    and split_part(name, '/', 2) = (select auth.uid())::text
    and exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id::text = split_part(name, '/', 1)
        and cm.user_id = (select auth.uid())
    )
    and not exists (
      select 1
      from public.message_media media
      where media.object_path = name
    )
  );

drop policy if exists "Conversation members can directly read chat media" on storage.objects;
drop policy if exists "Conversation members can update chat media" on storage.objects;
drop policy if exists "Conversation members can delete chat media" on storage.objects;

drop policy if exists "Chat media reads require the trusted access function" on storage.objects;
create policy "Chat media reads require the trusted access function"
  on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id <> 'isomo-chat-media');

drop policy if exists "Chat media uploads require conversation membership" on storage.objects;
create policy "Chat media uploads require conversation membership"
  on storage.objects as restrictive for insert to authenticated
  with check (
    bucket_id <> 'isomo-chat-media'
    or (
      split_part(name, '/', 2) = (select auth.uid())::text
      and exists (
        select 1
        from public.conversation_members cm
        where cm.conversation_id::text = split_part(name, '/', 1)
          and cm.user_id = (select auth.uid())
      )
      and split_part(name, '/', 3) ~ '^[0-9a-f-]{36}\.(jpg|png|webp|gif|webm|m4a|ogg|mp3|mp4)$'
    )
  );

drop policy if exists "Chat media metadata cannot be changed by clients" on storage.objects;
create policy "Chat media metadata cannot be changed by clients"
  on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'isomo-chat-media')
  with check (bucket_id <> 'isomo-chat-media');

drop policy if exists "Chat media deletion is limited to unregistered uploads" on storage.objects;
create policy "Chat media deletion is limited to unregistered uploads"
  on storage.objects as restrictive for delete to anon, authenticated
  using (
    bucket_id <> 'isomo-chat-media'
    or (
      split_part(name, '/', 2) = (select auth.uid())::text
      and exists (
        select 1
        from public.conversation_members cm
        where cm.conversation_id::text = split_part(name, '/', 1)
          and cm.user_id = (select auth.uid())
      )
      and not exists (
        select 1
        from public.message_media media
        where media.object_path = name
      )
    )
  );

create or replace function public.register_message_media(
  p_message_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_reply_to_id uuid,
  p_object_path text,
  p_media_kind text,
  p_mime_type text,
  p_byte_size bigint,
  p_view_once boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, private, storage, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  conversation_kind text;
  extension text;
  stored_byte_size bigint;
  stored_mime_type text;
  media_message_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_message_id is null or p_conversation_id is null
    or p_media_kind is null or p_view_once is null or p_mime_type is null
    or p_media_kind not in ('image', 'audio', 'video')
    or p_byte_size is null or p_byte_size < 1 or p_byte_size > 20971520 then
    raise exception 'Invalid media message' using errcode = '22023';
  end if;
  if not private.has_conversation_access(p_conversation_id) then
    raise exception 'Conversation access denied' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.message_media media
    where media.message_id = p_message_id
      and media.conversation_id = p_conversation_id
      and media.sender_id = caller_id
      and media.object_path = p_object_path
      and media.mime_type = p_mime_type
      and media.byte_size = p_byte_size
      and media.view_once = p_view_once
  ) then
    return p_message_id;
  end if;
  if p_reply_to_id is not null and not exists (
    select 1 from public.messages parent
    where parent.id = p_reply_to_id
      and parent.conversation_id = p_conversation_id
      and parent.deleted_at is null
  ) then
    raise exception 'Reply target is unavailable' using errcode = '22023';
  end if;

  extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/gif' then 'gif'
    when 'audio/webm' then 'webm'
    when 'audio/mp4' then 'm4a'
    when 'audio/ogg' then 'ogg'
    when 'audio/mpeg' then 'mp3'
    when 'video/mp4' then 'mp4'
    when 'video/webm' then 'webm'
    else null
  end;
  if extension is null or p_object_path <> p_conversation_id::text || '/'
      || caller_id::text || '/' || p_message_id::text || '.' || extension then
    raise exception 'Unsupported media type or storage path' using errcode = '22023';
  end if;
  if (p_media_kind = 'image' and p_mime_type not like 'image/%')
    or (p_media_kind = 'audio' and p_mime_type not like 'audio/%')
    or (p_media_kind = 'video' and p_mime_type not like 'video/%') then
    raise exception 'Media type does not match the content type' using errcode = '22023';
  end if;

  select kind into conversation_kind
  from public.conversations
  where id = p_conversation_id;

  select nullif(metadata->>'size', '')::bigint, metadata->>'mimetype'
  into stored_byte_size, stored_mime_type
  from storage.objects
  where bucket_id = 'isomo-chat-media'
    and name = p_object_path;
  if not found then
    raise exception 'Uploaded media object was not found' using errcode = 'P0002';
  end if;
  if stored_byte_size is distinct from p_byte_size or stored_mime_type is distinct from p_mime_type then
    raise exception 'Uploaded media metadata does not match the file' using errcode = '22023';
  end if;

  insert into public.messages (id, conversation_id, sender_id, body, reply_to_id)
  values (
    p_message_id,
    p_conversation_id,
    caller_id,
    coalesce(nullif(btrim(p_body), ''), case p_media_kind
      when 'image' then 'Photo'
      when 'audio' then 'Audio message'
      else 'Video'
    end),
    p_reply_to_id
  )
  returning id into media_message_id;

  insert into public.message_media (
    message_id, conversation_id, sender_id, object_path, media_kind,
    mime_type, byte_size, view_once, expires_at
  )
  values (
    media_message_id, p_conversation_id, caller_id, p_object_path, p_media_kind,
    p_mime_type, p_byte_size, p_view_once,
    case when p_view_once then now() + interval '24 hours' else null end
  );

  if p_view_once then
    if conversation_kind = 'general' then
      insert into public.view_once_recipients (message_id, user_id)
      select media_message_id, cm.user_id
      from public.conversation_members cm
      where cm.conversation_id = p_conversation_id
        and cm.user_id <> caller_id;
    else
      insert into public.view_once_recipients (message_id, user_id)
      select media_message_id, cm.user_id
      from public.conversation_members cm
      where cm.conversation_id = p_conversation_id
        and cm.user_id <> caller_id;
      if not found then
        raise exception 'Private conversation recipient not found' using errcode = '42501';
      end if;
    end if;
  end if;

  return media_message_id;
end;
$$;

create or replace function public.claim_view_once_media(p_message_id uuid, p_user_id uuid)
returns table (object_path text, mime_type text, claim_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_claim_id uuid := gen_random_uuid();
begin
  return query
  update public.view_once_recipients recipient
  set claimed_at = now(), claim_id = current_claim_id
  from public.message_media media
  where recipient.message_id = p_message_id
    and recipient.user_id = p_user_id
    and recipient.consumed_at is null
    and (recipient.claimed_at is null or recipient.claimed_at < now() - interval '10 minutes')
    and media.message_id = recipient.message_id
    and media.view_once
    and media.expires_at > now()
  returning media.object_path, media.mime_type, recipient.claim_id;
end;
$$;

create or replace function public.complete_view_once_media(p_message_id uuid, p_user_id uuid, p_claim_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_count integer;
begin
  update public.view_once_recipients
  set consumed_at = now()
  where message_id = p_message_id
    and user_id = p_user_id
    and claim_id = p_claim_id
    and claimed_at > now() - interval '10 minutes'
    and consumed_at is null;
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.get_message_media_cleanup_candidates(p_limit integer default 100)
returns table (message_id uuid, object_path text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select media.message_id, media.object_path
  from public.message_media media
  where (
      media.view_once
      and (
        media.expires_at <= now()
        or not exists (
          select 1
          from public.view_once_recipients recipient
          where recipient.message_id = media.message_id
            and recipient.consumed_at is null
        )
      )
    )
    or exists (
      select 1 from public.messages message
      where message.id = media.message_id
        and message.deleted_at is not null
    )
  order by media.expires_at
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

create or replace function public.delete_cleaned_message_media(p_message_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.message_media media
  where media.message_id = any(p_message_ids)
    and (
      (
        media.view_once
        and (
          media.expires_at <= now()
          or not exists (
            select 1
            from public.view_once_recipients recipient
            where recipient.message_id = media.message_id
              and recipient.consumed_at is null
          )
        )
      )
      or exists (
        select 1 from public.messages message
        where message.id = media.message_id
          and message.deleted_at is not null
      )
    );
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.register_message_media(uuid, uuid, text, uuid, text, text, text, bigint, boolean)
  from public, anon;
grant execute on function public.register_message_media(uuid, uuid, text, uuid, text, text, text, bigint, boolean)
  to authenticated;
revoke all on function public.claim_view_once_media(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_view_once_media(uuid, uuid) to service_role;
revoke all on function public.complete_view_once_media(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_view_once_media(uuid, uuid, uuid) to service_role;
revoke all on function public.get_message_media_cleanup_candidates(integer) from public, anon, authenticated;
grant execute on function public.get_message_media_cleanup_candidates(integer) to service_role;
revoke all on function public.delete_cleaned_message_media(uuid[]) from public, anon, authenticated;
grant execute on function public.delete_cleaned_message_media(uuid[]) to service_role;
