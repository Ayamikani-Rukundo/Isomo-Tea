create or replace function private.ensure_support_circle()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  support_circle_id uuid;
begin
  insert into public.conversations (id, kind, title)
  values (gen_random_uuid(), 'general', 'Support Circle')
  on conflict (kind) where kind = 'general' do nothing;

  select id into support_circle_id
  from public.conversations
  where kind = 'general';

  if support_circle_id is null then
    raise exception using errcode = 'P0001', message = 'Could not restore the Support Circle.';
  end if;

  return support_circle_id;
end;
$$;

create or replace function private.ensure_user_basics(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  support_circle_id uuid;
  fallback_username text;
begin
  if p_user_id is null or not exists (
    select 1 from auth.users where id = p_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'The account was not found.';
  end if;

  support_circle_id := private.ensure_support_circle();
  fallback_username := 'member_' || left(replace(p_user_id::text, '-', ''), 16);

  insert into public.profiles (id, username)
  values (p_user_id, fallback_username)
  on conflict (id) do nothing;

  insert into public.user_settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  insert into public.conversation_members (conversation_id, user_id)
  values (support_circle_id, p_user_id)
  on conflict (conversation_id, user_id) do nothing;

  insert into public.conversation_members (conversation_id, user_id, role)
  select conversation.id, p_user_id, 'admin'
  from public.conversations conversation
  where conversation.kind = 'group'
    and conversation.created_by = p_user_id
  on conflict (conversation_id, user_id) do nothing;
end;
$$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_user_basics(new.id);
  return new;
end;
$$;

create or replace function public.repair_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  perform private.ensure_user_basics(actor_id);
end;
$$;

create or replace function private.prevent_support_circle_deletion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.kind = 'general' then
    raise exception using errcode = '55000', message = 'The Support Circle is a required system conversation.';
  end if;
  return old;
end;
$$;

drop trigger if exists protect_support_circle_from_deletion on public.conversations;
create trigger protect_support_circle_from_deletion
  before delete on public.conversations
  for each row execute function private.prevent_support_circle_deletion();

revoke all on function private.ensure_support_circle() from public, anon, authenticated;
revoke all on function private.ensure_user_basics(uuid) from public, anon, authenticated;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
revoke all on function private.prevent_support_circle_deletion() from public, anon, authenticated;
revoke all on function public.repair_my_account() from public, anon;
grant execute on function public.repair_my_account() to authenticated;

select private.ensure_support_circle();

do $$
declare
  account record;
begin
  for account in select id from auth.users loop
    perform private.ensure_user_basics(account.id);
  end loop;
end;
$$;
