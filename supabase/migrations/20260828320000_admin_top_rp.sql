-- Admin Dashboard V1 Phase 3: Top RP ranking + rated RP history.
-- Staff-only SECURITY DEFINER readers over player_global_ratings + match_rp_results.
-- Ranked activity is rated ledger rows only (friend/unrated matches are excluded).
-- settled_at is the authoritative RP-change timestamp. Does not invent history.
-- Does not mutate RP, wins, losses, matches, or gameplay state.
-- Does not widen table RLS or GRANT table access.

CREATE OR REPLACE FUNCTION public.admin_list_top_rp(
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
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT COUNT(*)::integer
  INTO total_count
  FROM public.player_global_ratings r
  INNER JOIN public.profiles p ON p.id = r.player_id
  WHERE p.deleted_at IS NULL
    AND r.matches_played > 0;

  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'rp')::integer DESC, item->>'player_id'), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT jsonb_build_object(
      'player_id', r.player_id,
      'display_name', p.display_name,
      'username', p.username,
      'avatar_id', p.avatar_id,
      'rp', r.rp,
      'wins', r.wins,
      'losses', r.losses,
      'matches_played', r.matches_played,
      'rank', 1 + (
        SELECT COUNT(*)::integer
        FROM public.player_global_ratings r2
        INNER JOIN public.profiles p2 ON p2.id = r2.player_id
        WHERE p2.deleted_at IS NULL
          AND r2.matches_played > 0
          AND r2.rp > r.rp
      )
    ) AS item
    FROM public.player_global_ratings r
    INNER JOIN public.profiles p ON p.id = r.player_id
    WHERE p.deleted_at IS NULL
      AND r.matches_played > 0
    ORDER BY r.rp DESC, r.player_id ASC
    LIMIT safe_limit
    OFFSET safe_offset
  ) ranked;

  RETURN jsonb_build_object(
    'players', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_top_rp(integer, integer) IS
  'Staff-only Top RP list. Active accounts with at least one rated match. Rank is 1 + count of active rated players with strictly greater RP.';

CREATE OR REPLACE FUNCTION public.admin_list_player_rp_history(
  p_player_id uuid,
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
  player_row jsonb;
  events jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'player required' USING ERRCODE = '22023';
  END IF;

  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT jsonb_build_object(
    'player_id', p.id,
    'display_name', p.display_name,
    'username', p.username,
    'avatar_id', p.avatar_id,
    'deleted_at', p.deleted_at,
    'rp', COALESCE(r.rp, 1000),
    'wins', COALESCE(r.wins, 0),
    'losses', COALESCE(r.losses, 0),
    'matches_played', COALESCE(r.matches_played, 0),
    'rank', CASE
      WHEN p.deleted_at IS NOT NULL OR COALESCE(r.matches_played, 0) = 0 THEN NULL
      ELSE 1 + (
        SELECT COUNT(*)::integer
        FROM public.player_global_ratings r2
        INNER JOIN public.profiles p2 ON p2.id = r2.player_id
        WHERE p2.deleted_at IS NULL
          AND r2.matches_played > 0
          AND r2.rp > COALESCE(r.rp, 1000)
      )
    END
  )
  INTO player_row
  FROM public.profiles p
  LEFT JOIN public.player_global_ratings r ON r.player_id = p.id
  WHERE p.id = p_player_id;

  IF player_row IS NULL THEN
    RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*)::integer
  INTO total_count
  FROM public.match_rp_results mrr
  WHERE mrr.rated = true
    AND (mrr.winner_id = p_player_id OR mrr.loser_id = p_player_id);

  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'settled_at') DESC, item->>'match_id'), '[]'::jsonb)
  INTO events
  FROM (
    SELECT jsonb_build_object(
      'match_id', mrr.match_id,
      'opponent', jsonb_build_object(
        'player_id', opp.id,
        'display_name', opp.display_name,
        'username', opp.username,
        'avatar_id', opp.avatar_id
      ),
      'result', CASE WHEN mrr.winner_id = p_player_id THEN 'win' ELSE 'loss' END,
      'rp_before', CASE WHEN mrr.winner_id = p_player_id THEN mrr.winner_old_rp ELSE mrr.loser_old_rp END,
      'rp_delta', CASE WHEN mrr.winner_id = p_player_id THEN mrr.winner_delta ELSE mrr.loser_delta END,
      'rp_after', CASE WHEN mrr.winner_id = p_player_id THEN mrr.winner_new_rp ELSE mrr.loser_new_rp END,
      'settled_at', mrr.settled_at,
      'finished_at', m.finished_at,
      'rated', mrr.rated,
      'ruleset_id', mrr.ruleset_id,
      'finish_reason', mrr.finish_reason,
      'match_kind', m.match_kind
    ) AS item
    FROM public.match_rp_results mrr
    INNER JOIN public.profiles opp
      ON opp.id = CASE WHEN mrr.winner_id = p_player_id THEN mrr.loser_id ELSE mrr.winner_id END
    LEFT JOIN public.matches m ON m.id = mrr.match_id
    WHERE mrr.rated = true
      AND (mrr.winner_id = p_player_id OR mrr.loser_id = p_player_id)
    ORDER BY mrr.settled_at DESC, mrr.match_id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) history;

  RETURN jsonb_build_object(
    'player', player_row,
    'events', events,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_player_rp_history(uuid, integer, integer) IS
  'Staff-only rated RP ledger for one player. settled_at is the exact RP-change time. Unrated and friend matches are excluded.';

REVOKE ALL ON FUNCTION public.admin_list_top_rp(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_top_rp(integer, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_list_player_rp_history(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_player_rp_history(uuid, integer, integer) TO authenticated;
