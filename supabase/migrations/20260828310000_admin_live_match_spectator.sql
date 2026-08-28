-- Admin Dashboard V1 Phase 2B: read-only Live Match Spectator view.
-- Staff-only SECURITY DEFINER reader over public game_sessions columns + roster.
-- Returns played board/spinner (already public) and hand/reserve COUNTS only.
-- Does not join private secret tables. Does not return tile ids in either hand or the reserve.
-- Does not call participant gameplay RPCs, cleanup, or mutate match state.
-- Does not alter RLS or Realtime publication.

CREATE OR REPLACE FUNCTION public.admin_get_live_match_view(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  stale_before timestamptz;
  result jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match required' USING ERRCODE = '22023';
  END IF;

  stale_before := now() - interval '5 minutes';

  SELECT jsonb_build_object(
    'match_id', m.id,
    'ruleset_id', m.ruleset_id,
    'rated', m.rated,
    'match_kind', m.match_kind,
    'match_status', m.status,
    'finish_reason', m.finish_reason,
    'created_at', m.created_at,
    'admin_status', CASE
      WHEN m.status = 'finished' AND m.finish_reason = 'forfeit' THEN 'forfeit'
      WHEN m.status = 'finished' THEN 'finished'
      WHEN m.status = 'aborted' THEN 'aborted'
      WHEN occ_a.last_seen_at IS NULL
        OR occ_a.last_seen_at < stale_before
        OR occ_b.last_seen_at IS NULL
        OR occ_b.last_seen_at < stale_before
      THEN 'disconnected'
      WHEN m.status = 'ready' THEN 'waiting'
      WHEN m.status = 'playing' THEN 'live'
      ELSE m.status
    END,
    'player_a', jsonb_build_object(
      'player_id', m.player_a,
      'display_name', pa.display_name,
      'username', pa.username,
      'avatar_id', pa.avatar_id,
      'rp', COALESCE(ra.rp, 1000),
      'last_seen_at', occ_a.last_seen_at,
      'stale', (occ_a.last_seen_at IS NULL OR occ_a.last_seen_at < stale_before)
    ),
    'player_b', jsonb_build_object(
      'player_id', m.player_b,
      'display_name', pb.display_name,
      'username', pb.username,
      'avatar_id', pb.avatar_id,
      'rp', COALESCE(rb.rp, 1000),
      'last_seen_at', occ_b.last_seen_at,
      'stale', (occ_b.last_seen_at IS NULL OR occ_b.last_seen_at < stale_before)
    ),
    'score_a', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.scores->>0)::integer END,
    'score_b', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.scores->>1)::integer END,
    'round', gs.round,
    'current_seat', gs.current_seat,
    'current_player_id', CASE gs.current_seat
      WHEN 0 THEN m.player_a
      WHEN 1 THEN m.player_b
      ELSE NULL
    END,
    'session_status', gs.status,
    'phase', gs.phase,
    'session_updated_at', gs.updated_at,
    'hand_count_a', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.hand_counts->>0)::integer END,
    'hand_count_b', CASE WHEN gs.match_id IS NULL THEN NULL ELSE (gs.hand_counts->>1)::integer END,
    'reserve_count', gs.reserve_count,
    'version', gs.version,
    'board', COALESCE(gs.board, '[]'::jsonb),
    'spinner', gs.spinner,
    'last_play_points', gs.last_play_points,
    'last_play_score_terminals', COALESCE(gs.last_play_score_terminals, '[]'::jsonb),
    'match_winner_seat', gs.match_winner_seat
  )
  INTO result
  FROM public.matches m
  LEFT JOIN public.game_sessions gs ON gs.match_id = m.id
  LEFT JOIN public.profiles pa ON pa.id = m.player_a
  LEFT JOIN public.profiles pb ON pb.id = m.player_b
  LEFT JOIN public.player_global_ratings ra ON ra.player_id = m.player_a
  LEFT JOIN public.player_global_ratings rb ON rb.player_id = m.player_b
  LEFT JOIN public.active_match_players occ_a
    ON occ_a.match_id = m.id AND occ_a.player_id = m.player_a
  LEFT JOIN public.active_match_players occ_b
    ON occ_b.match_id = m.id AND occ_b.player_id = m.player_b
  WHERE m.id = p_match_id;

  IF result IS NULL THEN
    RAISE EXCEPTION 'match not found' USING ERRCODE = 'P0002';
  END IF;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.admin_get_live_match_view(uuid) IS
  'Staff-only read-only spectator snapshot. Public board/spinner plus hand and reserve counts. Never returns private tile identities or hidden engine state.';

REVOKE ALL ON FUNCTION public.admin_get_live_match_view(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_live_match_view(uuid) TO authenticated;
