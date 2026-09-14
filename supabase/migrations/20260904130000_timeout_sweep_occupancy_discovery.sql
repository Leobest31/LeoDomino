-- Timeout sweeper discovery: require both occupancy seats.
-- Do NOT apply to hosted Supabase until explicitly approved.
-- Does not change gameplay rules, wallets, or player Edge.
-- Does not enable cron.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_due_timeout_matches(
  p_limit integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  safe_limit integer;
BEGIN
  PERFORM public.require_service_role();
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 8);

  RETURN COALESCE((
    SELECT jsonb_agg(item)
    FROM (
      SELECT jsonb_build_object(
        'match_id', s.match_id,
        'version', s.version,
        'turn_deadline_at', s.turn_deadline_at
      ) AS item
      FROM public.game_sessions s
      INNER JOIN public.matches m ON m.id = s.match_id
      WHERE m.status = 'playing'
        AND m.player_a IS NOT NULL
        AND m.player_b IS NOT NULL
        AND m.ruleset_id IN ('legacy', 'haitian', 'american')
        AND s.status = 'playing'
        AND s.phase = 'playing'
        AND s.turn_deadline_at IS NOT NULL
        AND s.turn_deadline_at <= now()
        AND EXISTS (
          SELECT 1
          FROM public.active_match_players a
          WHERE a.match_id = s.match_id
            AND a.player_id = m.player_a
        )
        AND EXISTS (
          SELECT 1
          FROM public.active_match_players b
          WHERE b.match_id = s.match_id
            AND b.player_id = m.player_b
        )
      ORDER BY s.turn_deadline_at ASC
      LIMIT safe_limit
    ) listed
  ), '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.list_due_timeout_matches(integer) IS
  'Service-role overdue timeout discovery for occupied live tables only. No game-rule logic. Batch max 8.';

REVOKE ALL ON FUNCTION public.list_due_timeout_matches(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_due_timeout_matches(integer)
  TO service_role;

COMMIT;
