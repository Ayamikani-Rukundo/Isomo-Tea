create extension if not exists pgtap with schema extensions;

begin;

select extensions.plan(7);

select extensions.ok(
  public.username_is_available('new phrase username 7z'),
  'username availability accepts a valid phrase'
);
select extensions.ok(
  not public.username_is_available('two  spaces'),
  'username availability rejects consecutive spaces'
);
select extensions.ok(
  public.username_is_available('😎 emoji name 7z'),
  'username availability accepts emoji in a phrase'
);
select extensions.ok(
  not public.username_is_available('😎  emoji name'),
  'emoji usernames still reject consecutive spaces'
);
select extensions.ok(
  position('emoji' in pg_get_functiondef('public.set_my_username(text)'::regprocedure)) > 0
    and position('U&' in pg_get_functiondef('private.is_valid_username(text)'::regprocedure)) > 0,
  'username updates and availability validate emoji usernames'
);
select extensions.ok(
  position('single-spaced words' in pg_get_functiondef('public.set_my_username(text)'::regprocedure)) > 0
    and position('@"%s"' in pg_get_functiondef('public.set_my_username(text)'::regprocedure)) > 0
    and position('username_changed' in pg_get_functiondef('public.set_my_username(text)'::regprocedure)) > 0,
  'username changes retain their group announcement and quote phrase handles'
);
select extensions.ok(
  position('@"(' in pg_get_functiondef('private.notify_message_mentions()'::regprocedure)) > 0
    and position('coalesce(captures.username[1], captures.username[2])' in pg_get_functiondef('private.notify_message_mentions()'::regprocedure)) > 0
    and position('U&' in pg_get_functiondef('private.notify_message_mentions()'::regprocedure)) > 0,
  'server-side mentions recognize quoted phrases and emoji usernames'
);

select * from extensions.finish();
rollback;
