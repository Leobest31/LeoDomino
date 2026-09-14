-- Incident: CASS509 vs Lelao / pozinx / Theodule / petion timeout freezes.
-- Root cause: online-timeout-sweep loads public.matches via PostgREST as
-- service_role. Foundation GRANTed SELECT only to authenticated; service_role
-- never received SELECT (has_table_privilege … SELECT = false).
-- Discovery RPC list_due_timeout_matches is SECURITY DEFINER (reads matches as
-- owner) so candidates appear, then Edge loadMatch fails with Postgres 42501
-- every 10s and the turn never advances.
-- Approved for hosted apply as the definitive privilege fix (SELECT only).

BEGIN;

GRANT SELECT ON TABLE public.matches TO service_role;

COMMENT ON TABLE public.matches IS
  'Online matches. Authenticated players may SELECT rows they play; service_role SELECT is required for the timeout sweeper Edge loadMatch path.';

COMMIT;
