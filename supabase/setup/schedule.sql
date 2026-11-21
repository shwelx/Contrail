-- Run once in the SQL editor, after deploying the function.
-- Puts the project URL and cron secret in Vault, then has pg_cron call the
-- function every minute via pg_net.

-- Replace both values. The second one must match the CRON_SECRET you set
-- with `supabase secrets set`.
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
select vault.create_secret('YOUR-CRON-SECRET', 'cron_secret');

select cron.schedule(
  'ingest-flights',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
               || '/functions/v1/ingest-flights',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);

-- Debugging:
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select id, status_code, content::text, error_msg from net._http_response order by id desc limit 10;
--   select cron.unschedule('ingest-flights');
