alter table public.messages
  add column if not exists media_group_id uuid;

create index if not exists messages_media_group
  on public.messages (conversation_id, media_group_id, created_at)
  where media_group_id is not null;

create or replace function public.register_grouped_message_media(
  p_message_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_reply_to_id uuid,
  p_object_path text,
  p_media_kind text,
  p_mime_type text,
  p_byte_size bigint,
  p_view_once boolean,
  p_media_group_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  registered_message_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_media_group_id is null or p_media_kind <> 'image' then
    raise exception 'Only grouped images are supported' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_media_group_id::text, 0));
  if exists (
    select 1
    from public.messages grouped
    where grouped.media_group_id = p_media_group_id
      and (
        grouped.conversation_id <> p_conversation_id
        or grouped.sender_id is distinct from caller_id
        or grouped.reply_to_id is distinct from p_reply_to_id
      )
  ) then
    raise exception 'Media group access denied' using errcode = '42501';
  end if;

  registered_message_id := public.register_message_media(
    p_message_id,
    p_conversation_id,
    p_body,
    p_reply_to_id,
    p_object_path,
    p_media_kind,
    p_mime_type,
    p_byte_size,
    p_view_once
  );

  update public.messages message
  set media_group_id = p_media_group_id
  where message.id = registered_message_id
    and message.conversation_id = p_conversation_id
    and message.sender_id = caller_id
    and message.deleted_at is null
    and exists (
      select 1
      from public.message_media media
      where media.message_id = message.id
        and media.media_kind = 'image'
    );
  if not found then
    raise exception 'Image message could not be grouped' using errcode = '42501';
  end if;

  return registered_message_id;
end;
$$;

revoke all on function public.register_grouped_message_media(uuid, uuid, text, uuid, text, text, text, bigint, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.register_grouped_message_media(uuid, uuid, text, uuid, text, text, text, bigint, boolean, uuid)
  to authenticated;
