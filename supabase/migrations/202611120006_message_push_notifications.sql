alter table public.user_settings
  add column if not exists notifications_snoozed_until timestamptz;

create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index web_push_subscriptions_user on public.web_push_subscriptions (user_id);

create table public.native_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index native_push_tokens_user on public.native_push_tokens (user_id);

alter table public.web_push_subscriptions enable row level security;
alter table public.native_push_tokens enable row level security;

revoke all on public.web_push_subscriptions, public.native_push_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.web_push_subscriptions, public.native_push_tokens to authenticated;
grant all on public.web_push_subscriptions, public.native_push_tokens to service_role;

create policy "Members manage only their own web push subscriptions"
  on public.web_push_subscriptions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Members manage only their own native push tokens"
  on public.native_push_tokens for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create trigger web_push_subscriptions_updated_at
  before update on public.web_push_subscriptions
  for each row execute function private.touch_updated_at();

create trigger native_push_tokens_updated_at
  before update on public.native_push_tokens
  for each row execute function private.touch_updated_at();
