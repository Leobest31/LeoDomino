-- Ranked Find Match pair limit: count only genuinely completed games.
-- Before: any public rated accept/create in 24h counted (timeout/forfeit/aborted included).
-- After: only finish_reason = 'completed' public rated matches count.
-- Does not change list/count/accept pair-limit call sites, heartbeat, LeoPips, or settlement.

BEGIN;

CREATE OR REPLACE FUNCTION public.ranked_find_match_qualifying_count(p_a uuid, p_b uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN 0
    ELSE (
      SELECT COUNT(*)::integer
      FROM public.matches m
      WHERE m.rated = true
        AND m.match_kind = 'public'
        AND m.finish_reason = 'completed'
        AND public.uuid_pair_low(m.player_a, m.player_b) = public.uuid_pair_low(p_a, p_b)
        AND public.uuid_pair_high(m.player_a, m.player_b) = public.uuid_pair_high(p_a, p_b)
        AND m.created_at >= now() - interval '24 hours'
    )
  END;
$$;

COMMENT ON FUNCTION public.ranked_find_match_qualifying_count(uuid, uuid) IS
  'Count of genuinely completed public rated Find Match games this unordered pair created in the rolling previous 24 hours. Requires finish_reason = completed. Uses matches.created_at. Excludes timeout, forfeit, aborted, unfinished, friend, private, and unrated. Friend exemption is enforced by ranked_find_match_pair_limit_reached.';

-- Keep blocked-opponent discovery aligned with the same completed-only rule.
CREATE OR REPLACE FUNCTION public.list_ranked_find_match_blocked_opponents()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RETURN ARRAY[]::uuid[];
  END IF;
  RETURN ARRAY(
    SELECT other_id
    FROM (
      SELECT
        CASE WHEN m.player_a = caller THEN m.player_b ELSE m.player_a END AS other_id
      FROM public.matches m
      WHERE m.rated = true
        AND m.match_kind = 'public'
        AND m.finish_reason = 'completed'
        AND (m.player_a = caller OR m.player_b = caller)
        AND m.created_at >= now() - interval '24 hours'
    ) pairs
    WHERE NOT public._players_are_friends(caller, other_id)
    GROUP BY other_id
    HAVING COUNT(*) >= 3
  );
END;
$$;

COMMENT ON FUNCTION public.list_ranked_find_match_blocked_opponents() IS
  'Read-only. Opponent ids the caller cannot public-rate-pair with right now (3+ completed public rated games in rolling 24h). Friends exempt. Does not run cleanup.';

COMMENT ON FUNCTION public.ranked_find_match_pair_limit_reached(uuid, uuid) IS
  'True when a public rated Find Match between these two non-friends would be a 4th genuinely completed game in 24 hours. Friends and non-completed terminals never increment the cap.';

COMMIT;
