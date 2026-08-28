-- Admin Dashboard V1 Phase 2A: Live Matches directory (read-only).
-- Staff-only SECURITY DEFINER reader. Does not widen table RLS or GRANT table access.
-- Occupancy (active_match_players) is the live set. Public game_sessions fields only.
-- Does not return table layout, tile ids in hand, boneyard tile ids, or secret engine state.
-- Does not call participant gameplay RPCs, the gameplay Edge Function, or occupancy cleanup.
-- Does not add Realtime publication or spectator UI. Future spectator must use a
-- separate public-session projection and must never reuse participant gameplay views.

CREATE OR REPLACE FUNCTION public.admin_list_live_matches(
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  safe_limit integer;
  safe_offset integer;
  total_count integer;
  rows jsonb;
  stale_before timestamptz;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);
  -- Same 5-minute occupancy grace as stale cleanup. Observational only; this RPC does not cleanup.
  stale_before := now() - interval '5 minutes';

  SELECT COUNT(DISTINCT amp.match_id)::integer INTO total_count
  FROM public.active_match_players amp;

  SELECT COALESCE(jsonb_agg(item ORDER BY last_activity DESC, match_id DESC), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      jsonb_build_object(
        'match_id', m.id,
        'ruleset_id', m.ruleset_id,
        'rated', m.rated,
        'match_kind', m.match_kind,
        'match_status', m.status,
        'created_at', m.created_at,
        'admin_status', CASE
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
        'version', gs.version
      ) AS item,
      COALESCE(gs.updated_at, m.created_at) AS last_activity,
      m.id AS match_id
    FROM (
      SELECT DISTINCT match_id
      FROM public.active_match_players
    ) live
    INNER JOIN public.matches m ON m.id = live.match_id
    LEFT JOIN public.game_sessions gs ON gs.match_id = m.id
    LEFT JOIN public.profiles pa ON pa.id = m.player_a
    LEFT JOIN public.profiles pb ON pb.id = m.player_b
    LEFT JOIN public.player_global_ratings ra ON ra.player_id = m.player_a
    LEFT JOIN public.player_global_ratings rb ON rb.player_id = m.player_b
    LEFT JOIN public.active_match_players occ_a
      ON occ_a.match_id = m.id AND occ_a.player_id = m.player_a
    LEFT JOIN public.active_match_players occ_b
      ON occ_b.match_id = m.id AND occ_b.player_id = m.player_b
    ORDER BY COALESCE(gs.updated_at, m.created_at) DESC, m.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'matches', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_live_matches(integer, integer) IS
  'Staff-only paginated live match directory from active_match_players. Returns public identity, RP, occupancy freshness, and public session score/round/turn. Never returns board, tile ids, or secret state. Does not mutate occupancy.';

REVOKE ALL ON FUNCTION public.admin_list_live_matches(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_live_matches(integer, integer) TO authenticated;
