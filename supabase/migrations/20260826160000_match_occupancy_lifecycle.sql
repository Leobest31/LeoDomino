-- Occupancy lifecycle: leave/abort must free the seat.
-- Does not weaken accept_match_request, FOR UPDATE, PLAYER_BUSY, or sibling cancel.
-- player_in_active_match follows occupancy only. Zombie matches.status
-- rows that were never finished/aborted must not independently block Find Match.

CREATE OR REPLACE FUNCTION public.player_in_active_match(p_player uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.active_match_players
    WHERE player_id = p_player
  );
$$;

COMMENT ON FUNCTION public.player_in_active_match(uuid) IS
  'True when the player occupies active_match_players. Occupancy is maintained by matches status ready/playing via sync_active_match_players.';

CREATE OR REPLACE FUNCTION public.expire_stale_open_match_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.match_requests
  SET status = 'expired'
  WHERE status = 'open'
    AND expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_open_match_requests() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.match_requests_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  UPDATE public.match_requests
  SET status = 'expired'
  WHERE creator_id = caller
    AND status = 'open'
    AND expires_at <= now();

  NEW.creator_id := caller;
  NEW.status := 'open';
  NEW.acceptor_id := NULL;
  NEW.accepted_at := NULL;
  NEW.match_id := NULL;
  NEW.created_at := now();
  NEW.expires_at := now() + interval '10 minutes';
  IF NEW.ruleset_id IS NULL OR NEW.ruleset_id NOT IN ('legacy', 'haitian', 'american') THEN
    RAISE EXCEPTION 'invalid ruleset_id' USING ERRCODE = '22023';
  END IF;
  IF public.player_in_active_match(NEW.creator_id) THEN
    RAISE EXCEPTION 'PLAYER_BUSY' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.abort_online_match(p_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  updated integer;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'match id required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.matches
  SET status = 'aborted'
  WHERE id = p_match_id
    AND status IN ('ready', 'playing')
    AND (player_a = caller OR player_b = caller);

  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated = 0 THEN
    RAISE EXCEPTION 'cannot abort match' USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.abort_online_match(uuid) IS
  'Seated player leaves a live match. Sets aborted so sync_active_match_players frees occupancy. Does not change accept_match_request.';

REVOKE ALL ON FUNCTION public.abort_online_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.abort_online_match(uuid) TO authenticated;

-- TTL correction: expired OPEN rows still blocked the unique one-open-per-creator index.
SELECT public.expire_stale_open_match_requests();

-- One-time repair: occupancy backfill locked players to abandoned ready/playing
-- matches because leave never set aborted. Idle occupancy matches are aborted so
-- the trigger frees the seat. Does not delete requests, profiles, or sessions.
-- Does not touch matches with recent game_session activity (last 30 minutes).
UPDATE public.matches m
SET status = 'aborted'
WHERE m.status IN ('ready', 'playing')
  AND EXISTS (
    SELECT 1 FROM public.active_match_players a WHERE a.match_id = m.id
  )
  AND COALESCE(
    (SELECT s.updated_at FROM public.game_sessions s WHERE s.match_id = m.id),
    m.created_at
  ) < now() - interval '30 minutes';
