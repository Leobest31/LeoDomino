-- Timeout sweeper cron activation.
-- Do NOT apply to hosted Supabase until explicitly approved.
-- Scheduler only. Frequency: 10 seconds. Not 5 seconds.
-- Does not contain secrets. Vault names are placeholders only.
-- Requires hosted vault secrets: project_url, timeout_sweep_secret
-- Requires public.list_due_timeout_matches already applied.
-- Does not change gameplay rules, wallets, or player Edge.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'online-timeout-sweep',
  '10 seconds',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
           || '/functions/v1/online-timeout-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'timeout_sweep_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $$
);

COMMIT;
