create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  username_normalized text generated always as (lower(username)) stored,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9._]{3,24}$'),
  constraint profiles_username_normalized_unique unique (username_normalized)
);

create table public.administrators (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create table public.access_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  active boolean not null default true,
  expires_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  uses integer not null default 0 check (uses >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('general', 'private')),
  title text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index conversations_one_general_room
  on public.conversations (kind) where kind = 'general';

create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create index conversation_members_by_user
  on public.conversation_members (user_id, conversation_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references auth.users (id) on delete set null,
  body text not null check (length(body) between 1 and 10000),
  reply_to_id uuid references public.messages (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index messages_conversation_timeline
  on public.messages (conversation_id, created_at desc, id desc);
create index messages_sender on public.messages (sender_id, created_at desc);

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark', 'light')),
  notifications_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.auth_rate_limits (
  identifier_hash text not null,
  action text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null check (attempt_count > 0),
  primary key (identifier_hash, action)
);

insert into public.conversations (id, kind, title)
values ('00000000-0000-4000-8000-000000000001', 'general', 'General Tea');

create or replace function private.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.administrators a
    where a.user_id = (select auth.uid())
  );
$$;

create or replace function private.has_conversation_access(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      private.is_administrator()
      or exists (
        select 1
        from public.conversation_members cm
        where cm.conversation_id = p_conversation_id
          and cm.user_id = (select auth.uid())
      )
    );
$$;

create or replace function public.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_administrator();
$$;

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
  if normalized !~ '^[a-z0-9._]{3,24}$' then
    return false;
  end if;
  return not exists (
    select 1
    from public.profiles p
    where p.username_normalized = normalized
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
  normalized text := lower(btrim(p_username));
  updated_username text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;
  if normalized !~ '^[a-z0-9._]{3,24}$' then
    raise exception using errcode = '22023', message = 'Username must be 3–24 letters, numbers, periods, or underscores.';
  end if;

  update public.profiles
  set username = btrim(p_username), updated_at = now()
  where id = (select auth.uid())
  returning username into updated_username;

  if updated_username is null then
    raise exception using errcode = 'P0002', message = 'Profile not found.';
  end if;
  return updated_username;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'That username is already taken.';
end;
$$;

create or replace function public.consume_access_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  matching_code_id uuid;
begin
  if p_code is null or length(p_code) < 1 or length(p_code) > 256 then
    return false;
  end if;

  select ac.id into matching_code_id
  from public.access_codes ac
  where ac.active
    and (ac.expires_at is null or ac.expires_at > now())
    and (ac.max_uses is null or ac.uses < ac.max_uses)
    and extensions.crypt(p_code, ac.code_hash) = ac.code_hash
  order by ac.created_at
  limit 1
  for update;

  if matching_code_id is null then
    return false;
  end if;

  update public.access_codes
  set uses = uses + 1
  where id = matching_code_id;
  return true;
end;
$$;

create or replace function public.consume_auth_rate_limit(
  p_identifier_hash text,
  p_action text,
  p_window_seconds integer,
  p_max_attempts integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempt_count integer;
begin
  if p_identifier_hash !~ '^[a-f0-9]{64}$'
    or p_action !~ '^[a-z-]{1,40}$'
    or p_window_seconds < 1 or p_window_seconds > 3600
    or p_max_attempts < 1 or p_max_attempts > 100 then
    raise exception using errcode = '22023', message = 'Invalid rate limit parameters.';
  end if;

  insert into public.auth_rate_limits (identifier_hash, action, window_started_at, attempt_count)
  values (p_identifier_hash, p_action, now(), 1)
  on conflict (identifier_hash, action) do update
  set window_started_at = case
        when public.auth_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
          then now()
        else public.auth_rate_limits.window_started_at
      end,
      attempt_count = case
        when public.auth_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
          then 1
        else public.auth_rate_limits.attempt_count + 1
      end
  returning attempt_count into current_attempt_count;

  return current_attempt_count <= p_max_attempts;
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fallback_username text := 'member_' || left(replace(new.id::text, '-', ''), 16);
begin
  insert into public.profiles (id, username)
  values (new.id, fallback_username)
  on conflict (id) do nothing;
  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  insert into public.conversation_members (conversation_id, user_id)
  select c.id, new.id
  from public.conversations c
  where c.kind = 'general'
  on conflict do nothing;
  return new;
end;
$$;

create trigger auth_user_created_profile
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function private.touch_updated_at();

create trigger messages_updated_at
  before update on public.messages
  for each row execute function private.touch_updated_at();

create trigger user_settings_updated_at
  before update on public.user_settings
  for each row execute function private.touch_updated_at();

alter table public.profiles enable row level security;
alter table public.administrators enable row level security;
alter table public.access_codes enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.user_settings enable row level security;
alter table public.auth_rate_limits enable row level security;

revoke all on public.profiles, public.administrators, public.access_codes,
  public.conversations, public.conversation_members, public.messages,
  public.user_settings from public, anon, authenticated;
revoke all on public.auth_rate_limits from public, anon, authenticated;

grant select (id, username, avatar_url, created_at, updated_at)
  on public.profiles to authenticated;
grant update (avatar_url)
  on public.profiles to authenticated;
grant select on public.administrators to authenticated;
grant select on public.conversations, public.conversation_members to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert, update on public.user_settings to authenticated;
grant all on public.profiles, public.administrators, public.access_codes,
  public.conversations, public.conversation_members, public.messages,
  public.user_settings to service_role;
grant all on public.auth_rate_limits to service_role;

create policy "Profiles are visible to signed-in community members"
  on public.profiles for select to authenticated
  using (auth.uid() is not null);
create policy "Members can update their own avatar only"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Administrators can read their own role"
  on public.administrators for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Members can read accessible conversations"
  on public.conversations for select to authenticated
  using (private.has_conversation_access(id));

create policy "Members can read memberships in accessible conversations"
  on public.conversation_members for select to authenticated
  using (private.has_conversation_access(conversation_id));

create policy "Members can read messages in accessible conversations"
  on public.messages for select to authenticated
  using (private.has_conversation_access(conversation_id));
create policy "Members can send messages to conversations they joined"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.has_conversation_access(conversation_id)
  );

create policy "Members can read their own settings"
  on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Members can create their own settings"
  on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Members can update their own settings"
  on public.user_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on function private.is_administrator() from public, anon, authenticated;
revoke all on function private.has_conversation_access(uuid) from public, anon, authenticated;
revoke all on function private.touch_updated_at() from public, anon, authenticated;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.has_conversation_access(uuid) to authenticated;
revoke all on function public.is_administrator() from public, anon, authenticated;
grant execute on function public.is_administrator() to authenticated;

revoke all on function public.username_is_available(text) from public;
grant execute on function public.username_is_available(text) to anon, authenticated;
revoke all on function public.set_my_username(text) from public, anon;
grant execute on function public.set_my_username(text) to authenticated;
revoke all on function public.consume_access_code(text) from public, anon, authenticated;
grant execute on function public.consume_access_code(text) to service_role;
revoke all on function public.consume_auth_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text, text, integer, integer) to service_role;
