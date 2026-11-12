alter table public.message_stickers
  drop constraint if exists message_stickers_sticker_code_check;

alter table public.message_stickers
  add constraint message_stickers_sticker_code_check
  check (
    sticker_code in (
      'tea', 'leaf', 'sparkle', 'frog', 'teapot', 'heart', 'herb', 'coffee',
      'side_eye', 'spill', 'clown', 'awkward', 'receipts', 'plot_twist',
      'caught', 'bruh', 'say_less', 'yapper', 'dramatic', 'sobbing',
      'unbothered', 'bye', 'sus', 'chaos', 'snack', 'broke', 'sleepy',
      'cringe', 'oops', 'slay', 'cap', 'facts'
    )
  ) not valid;

alter table public.message_stickers
  validate constraint message_stickers_sticker_code_check;

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
    or p_sticker_code not in (
      'tea', 'leaf', 'sparkle', 'frog', 'teapot', 'heart', 'herb', 'coffee',
      'side_eye', 'spill', 'clown', 'awkward', 'receipts', 'plot_twist',
      'caught', 'bruh', 'say_less', 'yapper', 'dramatic', 'sobbing',
      'unbothered', 'bye', 'sus', 'chaos', 'snack', 'broke', 'sleepy',
      'cringe', 'oops', 'slay', 'cap', 'facts'
    )
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

revoke all on function public.create_sticker_message(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.create_sticker_message(uuid, uuid, text, uuid) to authenticated;
