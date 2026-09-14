-- Admin player rankings reader.
-- Level/XP columns are reserved NULL: the XP/Level formula is not finalized
-- and must not be derived from LeoPips balance, stake, or ledger.
-- Wins/losses reuse existing rated stats only:
--   all styles: player_global_ratings (rated public matches, including rated
--   forfeit/timeout settlements; friend/unrated matches are excluded)
--   one style: match_rp_results.rated = true AND ruleset_id
-- Do NOT apply to hosted Supabase until explicitly approved.
-- Does not change matchmaking, wallets, XP/Level writers, or gameplay.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_player_rankings(
  p_search text DEFAULT NULL,
  p_ruleset_id text DEFAULT NULL,
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
  style_id text;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_staff('moderator') THEN
    RAISE EXCEPTION 'staff required' USING ERRCODE = '42501';
  END IF;

  IF p_ruleset_id IS NOT NULL
     AND p_ruleset_id IS DISTINCT FROM 'legacy'
     AND p_ruleset_id IS DISTINCT FROM 'haitian'
     AND p_ruleset_id IS DISTINCT FROM 'american' THEN
    RAISE EXCEPTION 'unsupported ruleset' USING ERRCODE = '22023';
  END IF;
  style_id := p_ruleset_id;

  wanted := btrim(COALESCE(p_search, ''));
  IF char_length(wanted) > 64 THEN
    wanted := left(wanted, 64);
  END IF;
  pattern := '%' || replace(replace(replace(wanted, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  safe_offset := GREATEST(COALESCE(p_offset, 0), 0);

  IF style_id IS NULL THEN
    SELECT COUNT(*)::integer INTO total_count
    FROM public.profiles p
    WHERE p.deleted_at IS NULL
      AND (
        wanted = ''
        OR p.username ILIKE pattern ESCAPE '\'
        OR p.display_name ILIKE pattern ESCAPE '\'
      );

    SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'rank')::integer), '[]'::jsonb)
    INTO rows
    FROM (
      SELECT jsonb_build_object(
        'player_id', ranked.player_id,
        'display_name', ranked.display_name,
        'username', ranked.username,
        'avatar_id', ranked.avatar_id,
        'level', NULL,
        'xp', NULL,
        'leopips_balance', ranked.leopips_balance,
        'wins', ranked.wins,
        'losses', ranked.losses,
        'matches_played', ranked.matches_played,
        'rp', ranked.rp,
        'rank', ranked.rank
      ) AS item
      FROM (
        SELECT
          p.id AS player_id,
          p.display_name,
          p.username,
          p.avatar_id,
          COALESCE(r.wins, 0) AS wins,
          COALESCE(r.losses, 0) AS losses,
          COALESCE(r.matches_played, 0) AS matches_played,
          COALESCE(r.rp, 1000) AS rp,
          w.balance AS leopips_balance,
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(r.wins, 0) DESC,
              lower(COALESCE(p.username, '')),
              lower(COALESCE(p.display_name, '')),
              p.id
          ) AS rank
        FROM public.profiles p
        LEFT JOIN public.player_global_ratings r ON r.player_id = p.id
        LEFT JOIN public.player_leopips_wallets w ON w.player_id = p.id
        WHERE p.deleted_at IS NULL
          AND (
            wanted = ''
            OR p.username ILIKE pattern ESCAPE '\'
            OR p.display_name ILIKE pattern ESCAPE '\'
          )
      ) ranked
      ORDER BY ranked.rank
      LIMIT safe_limit
      OFFSET safe_offset
    ) listed;
  ELSE
    SELECT COUNT(*)::integer INTO total_count
    FROM (
      SELECT mrr.winner_id AS player_id
      FROM public.match_rp_results mrr
      WHERE mrr.rated = true AND mrr.ruleset_id = style_id
      UNION
      SELECT mrr.loser_id AS player_id
      FROM public.match_rp_results mrr
      WHERE mrr.rated = true AND mrr.ruleset_id = style_id
    ) played
    INNER JOIN public.profiles p ON p.id = played.player_id
    WHERE p.deleted_at IS NULL
      AND (
        wanted = ''
        OR p.username ILIKE pattern ESCAPE '\'
        OR p.display_name ILIKE pattern ESCAPE '\'
      );

    SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'rank')::integer), '[]'::jsonb)
    INTO rows
    FROM (
      SELECT jsonb_build_object(
        'player_id', ranked.player_id,
        'display_name', ranked.display_name,
        'username', ranked.username,
        'avatar_id', ranked.avatar_id,
        'level', NULL,
        'xp', NULL,
        'leopips_balance', ranked.leopips_balance,
        'wins', ranked.wins,
        'losses', ranked.losses,
        'matches_played', ranked.matches_played,
        'rp', ranked.rp,
        'rank', ranked.rank
      ) AS item
      FROM (
        SELECT
          p.id AS player_id,
          p.display_name,
          p.username,
          p.avatar_id,
          COALESCE(stats.wins, 0) AS wins,
          COALESCE(stats.losses, 0) AS losses,
          COALESCE(stats.wins, 0) + COALESCE(stats.losses, 0) AS matches_played,
          COALESCE(r.rp, 1000) AS rp,
          w.balance AS leopips_balance,
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(stats.wins, 0) DESC,
              lower(COALESCE(p.username, '')),
              lower(COALESCE(p.display_name, '')),
              p.id
          ) AS rank
        FROM (
          SELECT
            player_id,
            SUM(is_win)::integer AS wins,
            SUM(1 - is_win)::integer AS losses
          FROM (
            SELECT mrr.winner_id AS player_id, 1 AS is_win
            FROM public.match_rp_results mrr
            WHERE mrr.rated = true
              AND mrr.ruleset_id = style_id
            UNION ALL
            SELECT mrr.loser_id AS player_id, 0 AS is_win
            FROM public.match_rp_results mrr
            WHERE mrr.rated = true
              AND mrr.ruleset_id = style_id
          ) scored
          GROUP BY player_id
        ) stats
        INNER JOIN public.profiles p ON p.id = stats.player_id
        LEFT JOIN public.player_global_ratings r ON r.player_id = p.id
        LEFT JOIN public.player_leopips_wallets w ON w.player_id = p.id
        WHERE p.deleted_at IS NULL
          AND (
            wanted = ''
            OR p.username ILIKE pattern ESCAPE '\'
            OR p.display_name ILIKE pattern ESCAPE '\'
          )
      ) ranked
      ORDER BY ranked.rank
      LIMIT safe_limit
      OFFSET safe_offset
    ) listed;
  END IF;

  RETURN jsonb_build_object(
    'players', COALESCE(rows, '[]'::jsonb),
    'total', COALESCE(total_count, 0),
    'limit', safe_limit,
    'offset', safe_offset,
    'ruleset_id', style_id,
    'order', jsonb_build_array('level', 'xp', 'wins', 'name'),
    'level_xp_available', false
  );
END;
$$;

COMMENT ON FUNCTION public.admin_list_player_rankings(text, text, integer, integer) IS
  'Staff-only ranking. Order reserved as Level, XP, wins, name. Level/XP are NULL until the formula exists. LeoPips is displayed and never used to sort. Rated stats only.';

REVOKE ALL ON FUNCTION public.admin_list_player_rankings(text, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_player_rankings(text, text, integer, integer)
  TO authenticated;

COMMIT;
