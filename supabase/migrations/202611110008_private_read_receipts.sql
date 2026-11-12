create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  read_time timestamptz := now();
begin
  if auth.uid() is null or not private.has_conversation_access(p_conversation_id) then
    raise exception 'Conversation access denied' using errcode = '42501';
  end if;

  update public.conversation_members
  set last_read_at = read_time
  where conversation_id = p_conversation_id
    and user_id = auth.uid();

  if not found then
    raise exception 'Conversation membership not found' using errcode = '42501';
  end if;

  return read_time;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'conversation_members'
    ) then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
end;
$$;
