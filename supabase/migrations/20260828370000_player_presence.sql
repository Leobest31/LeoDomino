-- Global signed-in presence heartbeat for Admin census.
-- Online = fresh 75s player_presence only. Occupancy is never enough for Online.
-- In Match is occupancy only when the signed-in heartbeat is also fresh.
-- Does not change 5-minute occupancy cleanup, Challenge, RP, or match scoring.
-- Fail closed: no table GRANT, no client SELECT, touch uses auth.uid() only.

CREATE TABLE public.player_presence (
  player_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.player_presence IS
  'Authenticated signed-in heartbeat. last_seen_at is written only by touch_my_presence (auth.uid()). Not client-readable.';

COMMENT ON COLUMN public.player_presence.last_seen_at IS
  'Server clock at last successful heartbeat. Admin Online uses a 75-second freshness window.';

CREATE INDEX player_presence_last_seen_at_idx
  ON public.player_presence (last_seen_at DESC);

ALTER TABLE public.player_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_presence FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.player_presence FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.touch_my_presence()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  seen timestamptz;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.player_presence (player_id, last_seen_at, updated_at)
  VALUES (caller, now(), now())
  ON CONFLICT (player_id) DO UPDATE
  SET
    last_seen_at = now(),
    updated_at = now()
  RETURNING last_seen_at INTO seen;

  RETURN jsonb_build_object(
    'ok', true,
    'last_seen_at', seen
  );
END;
$$;

COMMENT ON FUNCTION public.touch_my_presence() IS
  'Authenticated player heartbeat. Upserts only auth.uid(). No client-supplied player id.';

REVOKE ALL ON FUNCTION public.touch_my_presence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_my_presence() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'total_active_accounts', (
      SELECT COUNT(*)::integer
      FROM public.profiles
      WHERE deleted_at IS NULL
    ),
    'total_deleted_accounts', (
      SELECT COUNT(*)::integer
      FROM public.profiles
      WHERE deleted_at IS NOT NULL
    ),
    'accounts_created_today', (
      SELECT COUNT(*)::integer
      FROM public.profiles
      WHERE created_at >= ((now() AT TIME ZONE 'utc')::date::timestamp AT TIME ZONE 'utc')
    ),
    'accounts_created_7d', (
      SELECT COUNT(*)::integer
      FROM public.profiles
      WHERE created_at >= now() - interval '7 days'
    ),
    'accounts_created_30d', (
      SELECT COUNT(*)::integer
      FROM public.profiles
      WHERE created_at >= now() - interval '30 days'
    ),
    'active_match_player_count', (
      SELECT COUNT(*)::integer
      FROM public.active_match_players
    ),
    'active_match_count', (
      SELECT COUNT(DISTINCT match_id)::integer
      FROM public.active_match_players
    ),
    'global_online_user_count', (
      SELECT COUNT(*)::integer
      FROM public.player_presence pr
      INNER JOIN public.profiles p ON p.id = pr.player_id
      WHERE p.deleted_at IS NULL
        AND pr.last_seen_at >= now() - interval '75 seconds'
        AND pr.last_seen_at <= now()
    )
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_overview() IS
  'Staff-only dashboard totals. global_online_user_count is non-deleted players with a fresh 75s signed-in heartbeat. Occupancy is not counted.';

CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
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
  wanted text;
  pattern text;
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

  wanted := btrim(COALESCE(p_search, ''));
  IF char_length(wanted) > 64 THEN
    wanted := left(wanted, 64);
  END IF;

  pattern := '%' || replace(replace(replace(wanted, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  SELECT COUNT(*)::integer INTO total_count
  FROM public.profiles p
  WHERE wanted = ''
     OR p.username ILIKE pattern ESCAPE '\'
     OR p.display_name ILIKE pattern ESCAPE '\';

  SELECT COALESCE(jsonb_agg(item ORDER BY created_at DESC, player_id DESC), '[]'::jsonb)
  INTO rows
  FROM (
    SELECT
      jsonb_build_object(
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
          SELECT 1
          FROM public.active_match_players amp
          WHERE amp.player_id = p.id
        ),
        'match_last_seen_at', (
          SELECT amp.last_seen_at
          FROM public.active_match_players amp
          WHERE amp.player_id = p.id
          LIMIT 1
        ),
        'presence_last_seen_at', (
          SELECT pr.last_seen_at
          FROM public.player_presence pr
          WHERE pr.player_id = p.id
        )
      ) AS item,
      p.created_at,
      p.id AS player_id
    FROM public.profiles p
    LEFT JOIN public.player_global_ratings r ON r.player_id = p.id
    WHERE wanted = ''
       OR p.username ILIKE pattern ESCAPE '\'
       OR p.display_name ILIKE pattern ESCAPE '\'
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT safe_limit
    OFFSET safe_offset
  ) listed;

  RETURN jsonb_build_object(
    'users', rows,
    'total', total_count,
    'limit', safe_limit,
    'offset', safe_offset
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_users(text, integer, integer) IS
  'Staff-only account directory. presence_last_seen_at is signed-in heartbeat. Occupancy alone does not prove Online.';

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
    'presence_last_seen_at', (
      SELECT pr.last_seen_at
      FROM public.player_presence pr
      WHERE pr.player_id = p.id
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
  'Staff-only account detail. presence_last_seen_at is signed-in heartbeat. Occupancy alone does not prove Online.';

REVOKE ALL ON FUNCTION public.admin_get_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_users(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_user(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user(uuid) TO authenticated;
