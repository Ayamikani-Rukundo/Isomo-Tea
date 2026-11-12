create or replace function public.admin_create_access_code(
  p_code text,
  p_max_uses integer,
  p_expires_at timestamptz,
  p_deactivate_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_code public.access_codes%rowtype;
begin
  if p_created_by is null or not exists (
    select 1 from public.administrators a where a.user_id = p_created_by
  ) then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if p_code is null
    or length(p_code) < 8
    or length(p_code) > 128
    or p_code <> btrim(p_code)
    or p_code ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'Access codes must be 8–128 characters without surrounding whitespace or control characters.';
  end if;
  if p_max_uses is null or p_max_uses < 1 then
    raise exception using errcode = '22023', message = 'Maximum registrations must be at least one.';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'Expiration must be in the future.';
  end if;

  perform pg_advisory_xact_lock(8217043198452711);
  if exists (
    select 1 from public.access_codes ac
    where extensions.crypt(p_code, ac.code_hash) = ac.code_hash
  ) then
    raise exception using errcode = '23505', message = 'An access code with that value already exists.';
  end if;

  if p_deactivate_id is not null then
    update public.access_codes
    set active = false
    where id = p_deactivate_id and active;
    if not found then
      raise exception using errcode = 'P0002', message = 'The selected active code was not found.';
    end if;
  end if;

  insert into public.access_codes (
    code_hash, active, expires_at, max_uses, created_by
  )
  values (
    extensions.crypt(p_code, extensions.gen_salt('bf')),
    true,
    p_expires_at,
    p_max_uses,
    p_created_by
  )
  returning * into created_code;

  return jsonb_build_object(
    'id', created_code.id,
    'active', created_code.active,
    'expires_at', created_code.expires_at,
    'max_uses', created_code.max_uses,
    'uses', created_code.uses,
    'created_at', created_code.created_at
  );
end;
$$;

create or replace function public.admin_set_access_code_active(
  p_id uuid,
  p_active boolean,
  p_changed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_code public.access_codes%rowtype;
begin
  if p_changed_by is null or not exists (
    select 1 from public.administrators a where a.user_id = p_changed_by
  ) then
    raise exception using errcode = '42501', message = 'Administrator access is required.';
  end if;
  if p_id is null or p_active is null then
    raise exception using errcode = '22023', message = 'A code and status are required.';
  end if;

  update public.access_codes ac
  set active = p_active
  where ac.id = p_id
    and (
      not p_active
      or (
        (ac.expires_at is null or ac.expires_at > now())
        and (ac.max_uses is null or ac.uses < ac.max_uses)
      )
    )
  returning * into changed_code;

  if not found then
    if not exists (select 1 from public.access_codes ac where ac.id = p_id) then
      raise exception using errcode = 'P0002', message = 'Access code not found.';
    end if;
    raise exception using errcode = 'P0001', message = 'Expired or exhausted codes cannot be reactivated.';
  end if;

  return jsonb_build_object(
    'id', changed_code.id,
    'active', changed_code.active,
    'expires_at', changed_code.expires_at,
    'max_uses', changed_code.max_uses,
    'uses', changed_code.uses,
    'created_at', changed_code.created_at
  );
end;
$$;

revoke all on function public.admin_create_access_code(text, integer, timestamptz, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_create_access_code(text, integer, timestamptz, uuid, uuid)
  to service_role;

revoke all on function public.admin_set_access_code_active(uuid, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_set_access_code_active(uuid, boolean, uuid)
  to service_role;
