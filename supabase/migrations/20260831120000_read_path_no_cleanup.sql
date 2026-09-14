-- WITHDRAWN / NO-OP MARKER
--
-- This migration was withdrawn. The originally intended body (read-path
-- occupancy cleanup removal) was withheld because it used an unsafe lock
-- order (relative to public.commit_online_game_transition and the C2
-- classifier) and, in its get_my_active_match() variant, contained a fatal
-- footgun: a started match past a 5-minute presence grace would incorrectly
-- report no active match. That code must never run against this project.
--
-- This file performs no cleanup, no DELETE, no UPDATE, no row lock, no
-- function creation or replacement, no cron/schedule change, and no other
-- database mutation of any kind. It exists only so this timestamp is
-- occupied by a harmless placeholder instead of being silently absent from
-- supabase/migrations/.
--
-- The dangerous original text is preserved, unexecuted, for reference only,
-- at supabase/held/20260831120000_read_path_no_cleanup.WITHHELD.sql. That
-- file must never be moved into supabase/migrations/ and must never be
-- applied to any hosted database.
--
-- Safe replacement work for the lock-order and classifier concerns lives in:
--   supabase/migrations/20260902210000_sessions_then_matches_lock_order.sql
--   supabase/migrations/20260902220000_shared_stale_occupancy_abort.sql
--
-- Authored 2026-09-14 as a new canonical marker. This is not a historical
-- restoration and does not claim to reproduce any prior file's exact bytes.

DO $$
BEGIN
  -- Intentionally empty. No statement below this line performs any action.
END;
$$;
