-- Admin Dashboard V1: extra staff readers over existing public-safe tables.
-- Users detail (friend count + occupancy last_seen only), feedback inbox, Invite & Win.
-- Does not invent a signed-in census. Does not change referral validation.
-- No GRANT SELECT on tables. No Realtime.

CREATE OR REPLACE FUNCTION public.admin_get_user(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  player_row jsonb;
  recent jsonb;
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

  SELECT jsonb_build_object(
    'player_id', p.id,
    'display_name', p.display_name,
    'username', p.username,
    'country_code', p.country_code,
    'avatar_id', p.avatar_id,
    'created_at', p.created_at,
    'deleted_at', p.deleted_at,
    'rp', COALESCE(r.rp, 1000),
    'wins', COALESCE(r.wins, 0),
    'losses', COALESCE(r.losses, 0),
    'matches_played', COALESCE(r.matches_played, 0),
    'in_active_match', EXISTS (
      SELECT 1 FROM public.active_match_players amp WHERE amp.player_id = p.id
    ),
    'match_last_seen_at', (
      SELECT amp.last_seen_at
      FROM public.active_match_players amp
      WHERE amp.player_id = p.id
      LIMIT 1
    ),
    'friend_count', (
      SELECT COUNT(*)::integer
      FROM public.friendships f
      WHERE f.user_a = p.id OR f.user_b = p.id
    )
  )
  INTO player_row
  FROM public.profiles p
  LEFT JOIN public.player_global_ratings r ON r.player_id = p.id
  WHERE p.id = p_player_id;

  IF player_row IS NULL THEN
    RAISE EXCEPTION 'player not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'settled_at') DESC), '[]'::jsonb)
  INTO recent
  FROM (
    SELECT jsonb_build_object(
      'match_id', mrr.match_id,
      'rated', mrr.rated,
      'result', CASE WHEN mrr.winner_id = p_player_id THEN 'win' ELSE 'loss' END,
      'ruleset_id', mrr.ruleset_id,
      'finish_reason', mrr.finish_reason,
      'settled_at', mrr.settled_at,
      'match_kind', m.match_kind
    ) AS item
    FROM public.match_rp_results mrr
    LEFT JOIN public.matches m ON m.id = mrr.match_id
    WHERE mrr.rated = true
      AND (mrr.winner_id = p_player_id OR mrr.loser_id = p_player_id)
    ORDER BY mrr.settled_at DESC, mrr.match_id DESC
    LIMIT 5
  ) recent_rows;

  RETURN jsonb_build_object(
    'player', player_row,
    'recent_rated_matches', recent
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_user(uuid) IS
  'Staff-only account detail. Friend count from friendships. last_seen is occupancy heartbeat only (null when not in a match). Recent rated ledger summaries only.';

REVOKE ALL ON FUNCTION public.admin_get_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_user(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_feedback(
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

  SELECT COUNT(*)::integer INTO total_count FROM public.player_feedback;

  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'created_at') DESC, item->>'id'), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT jsonb_build_object(
      'id', f.id,
      'player', jsonb_build_object(
        'player_id', p.id,
        'display_name', p.display_name,
        'username', p.username,
        'avatar_id', p.avatar_id
      ),
      'category', f.category,
      'body', f.body,
      'app_version', f.app_version,
      'platform', f.platform,
      'status', f.status,
      'created_at', f.created_at
    ) AS item
    FROM public.player_feedback f
    INNER JOIN public.profiles p ON p.id = f.player_id
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'items', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_feedback(integer, integer) IS
  'Staff-only player feedback inbox. Body is player-submitted text. No Sentry or credentials.';

REVOKE ALL ON FUNCTION public.admin_list_feedback(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_feedback(integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_invite_win()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  season jsonb;
  counts jsonb;
  standings jsonb;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', s.id,
    'slug', s.slug,
    'name', s.name,
    'status', s.status,
    'starts_at', s.starts_at,
    'ends_at', s.ends_at,
    'prize_amount_usd', s.prize_amount_usd,
    'prize_currency', s.prize_currency,
    'prize_label', s.prize_label,
    'winner', CASE
      WHEN w.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'player_id', w.id,
        'display_name', w.display_name,
        'username', w.username,
        'avatar_id', w.avatar_id
      )
    END,
    'finalized_at', s.finalized_at
  )
  INTO season
  FROM public.referral_seasons s
  LEFT JOIN public.profiles w ON w.id = s.winner_player_id
  ORDER BY
    CASE s.status WHEN 'active' THEN 0 WHEN 'under_review' THEN 1 WHEN 'ended' THEN 2 ELSE 3 END,
    s.starts_at DESC
  LIMIT 1;

  SELECT jsonb_build_object(
    'pending', COUNT(*) FILTER (WHERE r.status = 'pending'),
    'validated', COUNT(*) FILTER (WHERE r.status = 'validated'),
    'rejected', COUNT(*) FILTER (WHERE r.status = 'rejected')
  )
  INTO counts
  FROM public.referrals r
  WHERE season IS NOT NULL AND r.season_id = (season->>'id')::uuid;

  SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'validated_count')::integer DESC, item->>'player_id'), '[]'::jsonb)
  INTO standings
  FROM (
    SELECT jsonb_build_object(
      'player_id', p.id,
      'display_name', p.display_name,
      'username', p.username,
      'avatar_id', p.avatar_id,
      'validated_count', COUNT(*) FILTER (WHERE r.status = 'validated'),
      'pending_count', COUNT(*) FILTER (WHERE r.status = 'pending'),
      'rejected_count', COUNT(*) FILTER (WHERE r.status = 'rejected')
    ) AS item
    FROM public.referrals r
    INNER JOIN public.profiles p ON p.id = r.referrer_id
    WHERE season IS NOT NULL AND r.season_id = (season->>'id')::uuid
    GROUP BY p.id, p.display_name, p.username, p.avatar_id
    ORDER BY COUNT(*) FILTER (WHERE r.status = 'validated') DESC, p.id ASC
    LIMIT 25
  ) board;

  RETURN jsonb_build_object(
    'season', season,
    'counts', COALESCE(counts, jsonb_build_object('pending', 0, 'validated', 0, 'rejected', 0)),
    'standings', COALESCE(standings, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_invite_win() IS
  'Staff-only Invite & Win snapshot. Read-only. Does not validate, reject, or finalize referrals.';

REVOKE ALL ON FUNCTION public.admin_get_invite_win() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_invite_win() TO authenticated;
