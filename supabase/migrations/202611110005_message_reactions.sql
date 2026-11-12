create table public.message_reactions (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index message_reactions_by_conversation
  on public.message_reactions (conversation_id, message_id);

alter table public.message_reactions enable row level security;
alter table public.message_reactions replica identity full;
revoke all on public.message_reactions from public, anon, authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
grant all on public.message_reactions to service_role;

create policy "Members can read reactions in accessible conversations"
  on public.message_reactions for select to authenticated
  using (private.has_conversation_access(conversation_id));

create policy "Members can react in accessible conversations"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.has_conversation_access(conversation_id)
    and exists (
      select 1
      from public.messages m
      where m.id = message_reactions.message_id
        and m.conversation_id = message_reactions.conversation_id
    )
  );

create policy "Members can remove their own reactions"
  on public.message_reactions for delete to authenticated
  using (
    user_id = (select auth.uid())
    and private.has_conversation_access(conversation_id)
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'message_reactions'
    ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end;
$$;
