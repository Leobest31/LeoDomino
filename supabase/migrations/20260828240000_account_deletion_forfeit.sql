-- Account deletion must never be blocked by a live match.
-- Forfeit/close the caller's ready/playing seats first, then tombstone.
-- Auth deletion remains in the Edge Function. Does not rewrite Elo math.

CREATE OR REPLACE FUNCTION public.prepare_my_account_deletion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  live_match uuid;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(caller::text));

  FOR live_match IN
    SELECT id
    FROM public.matches
    WHERE (player_a = caller OR player_b = caller)
      AND status IN ('ready', 'playing')
    UNION
    SELECT match_id
    FROM public.active_match_players
    WHERE player_id = caller
  LOOP
    PERFORM public._forfeit_match_player(live_match, caller);
  END LOOP;

  DELETE FROM public.active_match_players WHERE player_id = caller;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = caller AND deleted_at IS NOT NULL
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_tombstoned', true);
  END IF;

  UPDATE public.match_requests
  SET status = 'cancelled'
  WHERE status = 'open'
    AND (creator_id = caller OR invitee_id = caller);

  DELETE FROM public.friendships
  WHERE user_a = caller OR user_b = caller;

  DELETE FROM public.friend_requests
  WHERE sender_id = caller OR receiver_id = caller;

  DELETE FROM public.friend_conversation_reads
  WHERE player_id = caller;

  DELETE FROM public.player_referral_codes
  WHERE player_id = caller;

  UPDATE public.profiles
  SET
    username = NULL,
    display_name = 'Deleted player',
    avatar_id = 'marcus',
    country_code = '',
    deleted_at = now()
  WHERE id = caller;

  RETURN jsonb_build_object('ok', true, 'already_tombstoned', false);
END;
$$;

COMMENT ON FUNCTION public.prepare_my_account_deletion() IS
  'Tombstone the signed-in player. Forfeits ready/playing seats so deletion is never blocked. Does not delete Auth, matches, RP, or chat history.';

REVOKE ALL ON FUNCTION public.prepare_my_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_my_account_deletion() TO authenticated;
