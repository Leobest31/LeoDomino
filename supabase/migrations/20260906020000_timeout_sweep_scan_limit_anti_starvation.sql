-- Anti-starvation: discover more overdue rows than one processing batch so a
-- permanently failing oldest match cannot hide newer overdue matches forever.
-- Processing stays bounded in the Edge sweeper (scan 24, resolve budget 8).
-- Does not change timeout rules, CAS, or LeoPips economics.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_due_timeout_matches(
  p_limit integer DEFAULT 24
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
  safe_limit := LEAST(GREATEST(COALESCE(p_limit, 24), 1), 24);

  RETURN COALESCE((
    SELECT jsonb_agg(item)
    FROM (
      SELECT jsonb_build_object(
        'match_id', s.match_id,
        'version', s.version,
        'turn_deadline_at', s.turn_deadline_at,
        'occupancy_seats', (
          SELECT COUNT(*)::integer
          FROM public.active_match_players amp
          WHERE amp.match_id = s.match_id
            AND amp.player_id IN (m.player_a, m.player_b)
        )
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
      ORDER BY s.turn_deadline_at ASC, s.match_id ASC
      LIMIT safe_limit
    ) listed
  ), '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.list_due_timeout_matches(integer) IS
  'Service-role overdue timeout discovery. occupancy_seats informational. Batch max 24 for anti-starvation scan; Edge applies a smaller resolve budget.';

REVOKE ALL ON FUNCTION public.list_due_timeout_matches(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_due_timeout_matches(integer)
  TO service_role;

COMMIT;
