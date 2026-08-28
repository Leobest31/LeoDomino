-- Admin Dashboard V1 Phase 1 RPCs: Overview + Users/Accounts.
-- Staff-only SECURITY DEFINER readers. Does not widen table RLS or GRANT table access.
-- Does not add a live signed-in census, Top RP, Live Matches UI, spectating, sanctions, or gameplay changes.
-- Global online-user count is not available; returned as JSON null (do not invent).

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
    'global_online_user_count', NULL
  );
END;
$$;

COMMENT ON FUNCTION public.admin_get_overview() IS
  'Staff-only dashboard totals. Occupancy counts come from active_match_players. global_online_user_count is always null because a live signed-in census is not available.';

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
  'Staff-only paginated account directory. Returns public profile + Global RP fields only. Newest accounts first. In-match means an active_match_players row exists.';

REVOKE ALL ON FUNCTION public.admin_get_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_users(text, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, integer, integer) TO authenticated;
