-- Timeout sweeper discovery (local only).
-- Do NOT apply to hosted Supabase until explicitly approved.
-- Does not change gameplay rules, wallets, or player Edge.
--
-- A. Discovery + security (required to activate the sweeper Edge)
-- B. Optional deadline index
-- C. Cron activation lives in:
--    supabase/held/20260904121000_online_timeout_sweep_cron.WITHHELD.sql

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
      ORDER BY s.turn_deadline_at ASC
      LIMIT safe_limit
    ) listed
  ), '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.list_due_timeout_matches(integer) IS
  'Service-role overdue timeout discovery. No game-rule logic. Batch max 8.';

REVOKE ALL ON FUNCTION public.list_due_timeout_matches(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_due_timeout_matches(integer)
  TO service_role;

-- B. Optional performance index. Safe to apply with A; not required for correctness.
CREATE INDEX IF NOT EXISTS game_sessions_due_turn_deadline_idx
  ON public.game_sessions (turn_deadline_at)
  WHERE status = 'playing'
    AND phase = 'playing'
    AND turn_deadline_at IS NOT NULL;

COMMIT;
