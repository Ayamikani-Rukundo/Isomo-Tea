begin;

drop policy if exists "Conversation members can read media metadata"
  on public.message_media;

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

commit;
