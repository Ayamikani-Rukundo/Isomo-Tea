do $$
declare
  cleanup_job_name constant text := 'isomo-media-cleanup-hourly';
  cleanup_endpoint constant text :=
    'https://vfvjnrekjdoqxohziolq.supabase.co/functions/v1/media-cleanup';
  cleanup_command constant text := $command$
    select net.http_post(
      url := 'https://vfvjnrekjdoqxohziolq.supabase.co/functions/v1/media-cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-media-cleanup-secret',
        (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'media_cleanup_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $command$;
  cleanup_job_id bigint;
  duplicate_job_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'Enable pg_cron before applying this scheduler migration.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception 'Enable pg_net before applying this scheduler migration.';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault is unavailable; store the cleanup secret in Vault first.';
  end if;
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'media_cleanup_secret'
  ) then
    raise exception 'Add the media_cleanup_secret value to Supabase Vault before scheduling.';
  end if;

  select jobid
  into cleanup_job_id
  from cron.job
  where command like '%' || cleanup_endpoint || '%'
  order by (jobname = cleanup_job_name) desc, jobid
  limit 1;

  if cleanup_job_id is null then
    if exists (select 1 from cron.job where jobname = cleanup_job_name) then
      raise exception 'Cron job name % is already used by a different command.', cleanup_job_name;
    end if;

    select cron.schedule(cleanup_job_name, '0 * * * *', cleanup_command)
    into cleanup_job_id;
  else
    perform cron.alter_job(
      cleanup_job_id,
      schedule := '0 * * * *',
      command := cleanup_command,
      active := true
    );
  end if;

  for duplicate_job_id in
    select jobid
    from cron.job
    where jobid <> cleanup_job_id
      and command like '%' || cleanup_endpoint || '%'
  loop
    perform cron.alter_job(duplicate_job_id, active := false);
  end loop;
end;
$$;
