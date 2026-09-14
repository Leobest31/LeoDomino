-- Phase 1: pin search_path on LeoDomino-owned functions that Security Advisor
-- flags as function_search_path_mutable.
--
-- Hosted catalog (cfgzemstlutsmexqmngg) confirmed these 21 public functions
-- have proconfig NULL. Bodies are not replaced. Grants, owners, and
-- SECURITY INVOKER/DEFINER are unchanged.
--
-- Search path is chosen per body:
--   pg_catalog  — NEW/OLD / builtin-only helpers (no schema objects)
--   public      — reads public tables and/or calls auth.* helpers
--
-- Intentionally NOT altered:
--   public.rls_auto_enable()          -- Supabase event-trigger helper
--   auth / storage / extensions / vault / graphql functions
--   every other public RPC that already has search_path set
--
-- Rollback (do not run as part of this file):
--   ALTER FUNCTION public._matchmaking_lock_player(p_player uuid) RESET search_path;
--   ALTER FUNCTION public.set_updated_at() RESET search_path;
--   ALTER FUNCTION public.uuid_pair_low(a uuid, b uuid) RESET search_path;
--   ALTER FUNCTION public.uuid_pair_high(a uuid, b uuid) RESET search_path;
--   ALTER FUNCTION public.prevent_profile_id_change() RESET search_path;
--   ALTER FUNCTION public.friend_conversations_protect_identity() RESET search_path;
--   ALTER FUNCTION public.matches_stamp_terminal() RESET search_path;
--   ALTER FUNCTION public.referral_seasons_protect_immutable() RESET search_path;
--   ALTER FUNCTION public.player_referral_codes_protect_immutable() RESET search_path;
--   ALTER FUNCTION public.referrals_protect_lifecycle() RESET search_path;
--   ALTER FUNCTION public.matches_protect_ruleset() RESET search_path;
--   ALTER FUNCTION public.match_requests_protect_immutable() RESET search_path;
--   ALTER FUNCTION public.match_rp_results_protect_immutable() RESET search_path;
--   ALTER FUNCTION public.game_sessions_protect_immutable() RESET search_path;
--   ALTER FUNCTION public.game_actions_append_only() RESET search_path;
--   ALTER FUNCTION public.friend_messages_before_insert() RESET search_path;
--   ALTER FUNCTION public.friend_messages_protect_immutable() RESET search_path;
--   ALTER FUNCTION public.require_service_role() RESET search_path;
--   ALTER FUNCTION public.matches_reject_deleted_players() RESET search_path;
--   ALTER FUNCTION public.profiles_protect_deleted() RESET search_path;
--   ALTER FUNCTION public.assert_caller_not_deleted() RESET search_path;

BEGIN;

-- Builtin / NEW/OLD only ---------------------------------------------------
ALTER FUNCTION public._matchmaking_lock_player(p_player uuid)
  SET search_path = pg_catalog;

ALTER FUNCTION public.set_updated_at()
  SET search_path = pg_catalog;

ALTER FUNCTION public.uuid_pair_low(a uuid, b uuid)
  SET search_path = pg_catalog;

ALTER FUNCTION public.uuid_pair_high(a uuid, b uuid)
  SET search_path = pg_catalog;

ALTER FUNCTION public.prevent_profile_id_change()
  SET search_path = pg_catalog;

ALTER FUNCTION public.friend_conversations_protect_identity()
  SET search_path = pg_catalog;

ALTER FUNCTION public.matches_stamp_terminal()
  SET search_path = pg_catalog;

ALTER FUNCTION public.referral_seasons_protect_immutable()
  SET search_path = pg_catalog;

ALTER FUNCTION public.player_referral_codes_protect_immutable()
  SET search_path = pg_catalog;

ALTER FUNCTION public.referrals_protect_lifecycle()
  SET search_path = pg_catalog;

ALTER FUNCTION public.matches_protect_ruleset()
  SET search_path = pg_catalog;

ALTER FUNCTION public.match_requests_protect_immutable()
  SET search_path = pg_catalog;

ALTER FUNCTION public.match_rp_results_protect_immutable()
  SET search_path = pg_catalog;

ALTER FUNCTION public.game_sessions_protect_immutable()
  SET search_path = pg_catalog;

ALTER FUNCTION public.game_actions_append_only()
  SET search_path = pg_catalog;

-- public tables and/or auth.* (already schema-qualified in the body) ------
ALTER FUNCTION public.friend_messages_before_insert()
  SET search_path = public;

ALTER FUNCTION public.friend_messages_protect_immutable()
  SET search_path = public;

ALTER FUNCTION public.require_service_role()
  SET search_path = public;

ALTER FUNCTION public.matches_reject_deleted_players()
  SET search_path = public;

ALTER FUNCTION public.profiles_protect_deleted()
  SET search_path = public;

ALTER FUNCTION public.assert_caller_not_deleted()
  SET search_path = public;

COMMIT;
